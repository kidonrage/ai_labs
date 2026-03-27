import { inferApiMode, requiresAuthorization } from "./api-profiles.js";
import { normalizeInvariants } from "./invariants.store.js";
import { TaskStageWorkflow } from "./task-stage-workflow.js";
import { ContextBuilderRouter } from "./agent/context-builders.js";
import {
  extractAnswerText,
  extractDurationSeconds,
  extractToolCallNames,
  extractUserVisibleAnswer,
} from "./agent/answer-extractors.js";
import { InvariantGuard } from "./agent/invariant-guard.js";
import { extractJsonObject } from "./json-extraction.js";
import { MemoryUpdateService } from "./agent/memory-update-service.js";
import { ModelGateway } from "./agent/model-gateway.js";
import { RagAnswerService } from "./agent/rag-answer-service.js";
import { AgentStateSerializer } from "./agent/state-serializer.js";
import {
  makeDefaultContextPolicy,
  makeDefaultLastRagResult,
  makeDefaultLongTermMemory,
  makeDefaultRagConfig,
  makeDefaultSummaryTotals,
  makeDefaultWorkingMemory,
  normalizeLongTermMemory,
  normalizeWorkingMemory,
} from "./agent/state-shapes.js";
import { buildProfilePriorityInstructions, normalizeUserProfile } from "./agent/user-profile.js";

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export class Agent {
  static makeDefaultInvariants() { return normalizeInvariants(null); }
  static makeDefaultLongTermMemory() { return makeDefaultLongTermMemory(); }
  static makeDefaultWorkingMemory() { return makeDefaultWorkingMemory(); }
  static normalizeLongTermMemory(value) { return normalizeLongTermMemory(value); }
  static normalizeWorkingMemory(value) { return normalizeWorkingMemory(value); }
  static makeDefaultTaskState() { return TaskStageWorkflow.makeDefaultTaskState(); }
  static normalizeTaskState(value) { return TaskStageWorkflow.normalizeTaskState(value); }
  static extractAnswerText(dto, apiMode) { return extractAnswerText(dto, apiMode); }
  static extractToolCallNames(dto) { return extractToolCallNames(dto); }
  static extractUserVisibleAnswer(dto, apiMode) { return extractUserVisibleAnswer(dto, apiMode); }
  static extractDurationSeconds(dto, apiMode) { return extractDurationSeconds(dto, apiMode); }

  constructor({ apiMode, baseUrl, apiKey, model, temperature }) {
    Object.assign(this, {
      apiMode: inferApiMode(apiMode, baseUrl),
      baseUrl, apiKey, model, temperature,
      history: [],
      longTermMemory: makeDefaultLongTermMemory(),
      workingMemory: makeDefaultWorkingMemory(),
      taskState: Agent.makeDefaultTaskState(),
      invariants: Agent.makeDefaultInvariants(),
      lastInvariantCheck: null,
      userProfile: normalizeUserProfile(null),
      ragConfig: makeDefaultRagConfig(),
      lastRagResult: makeDefaultLastRagResult(),
      summaryTotals: makeDefaultSummaryTotals(),
      contextPolicy: makeDefaultContextPolicy(),
      systemPreamble: "Ты полезный ассистент. Отвечай кратко и по делу, если не просят иначе.",
      testModeConfig: null,
      plannerPrompt: "Собери короткий draft-план ответа на запрос, учитывая memory/task state/invariants. Переход между этапами задачи возможен только после явной команды пользователя approve.",
      invariantCheckerPrompt: "Проверь draft-план и запрос на конфликты с инвариантами. Любой конфликт означает отказ.",
      finalResponderPrompt: "Сформируй финальный ответ только в рамках инвариантов и активного профиля пользователя. Не инициируй переход к следующему этапу без явного разрешения пользователя.",
      refusalPrompt: "При конфликте дай отказ, назови нарушенные инварианты и предложи безопасную альтернативу.",
      onStateChanged: null,
      stateSerializer: new AgentStateSerializer(),
      invariantGuard: new InvariantGuard(),
      contextBuilder: new ContextBuilderRouter(),
      modelGateway: new ModelGateway(),
    });
    this.memoryUpdateService = new MemoryUpdateService(this.modelGateway);
    this.ragAnswerService = new RagAnswerService({
      contextBuilder: this.contextBuilder,
      modelGateway: this.modelGateway,
    });
    this.taskWorkflow = new TaskStageWorkflow({
      getTaskState: () => this.taskState,
      setTaskState: (next) => { this.taskState = next; },
      getInvariants: () => this.invariants,
      emitStateChanged: () => this._emitStateChanged(),
      setLastInvariantCheck: (check) => { this.lastInvariantCheck = check; },
      computeInvariantDecision: (userRequest) => this._computeInvariantDecision(userRequest),
      formatInvariantRefusal: (checkResult) => this.formatInvariantRefusal(checkResult),
      runTaskLLMStep: (input) => this._runTaskLLMStep(input),
      extractJsonObject: (text) => this._extractJsonObject(text),
    });
  }

  setConfig(config) { this.modelGateway.updateConfig(this, config); this._emitStateChanged(); }
  setContextPolicy(patch) { this.contextPolicy = { ...this.contextPolicy, ...(patch || {}) }; this._emitStateChanged(); }
  setLongTermMemory(value) { this.longTermMemory = normalizeLongTermMemory(value); this._emitStateChanged(); }
  setInvariants(value) { this.invariants = normalizeInvariants(value, { mergeWithDefaults: false }); this._emitStateChanged(); }
  setUserProfile(profile) { this.userProfile = normalizeUserProfile(profile); this._emitStateChanged(); }
  setTestModeConfig(config) { this.testModeConfig = config && typeof config === "object" ? { ...config } : null; }
  clearTestModeConfig() { this.testModeConfig = null; }

  setRagConfig(patch) {
    const next = patch && typeof patch === "object" ? patch : {};
    this.ragConfig = {
      ...this.ragConfig,
      ...next,
      enabled: Boolean(next.enabled ?? this.ragConfig.enabled),
      topK: normalizePositiveInteger(next.topK, this.ragConfig.topK),
      topKBefore: normalizePositiveInteger(next.topKBefore, this.ragConfig.topKBefore),
      topKAfter: normalizePositiveInteger(next.topKAfter, this.ragConfig.topKAfter),
      minSimilarity: normalizeFiniteNumber(next.minSimilarity, this.ragConfig.minSimilarity),
      answerMinSimilarity: normalizeFiniteNumber(
        next.answerMinSimilarity,
        this.ragConfig.answerMinSimilarity,
      ),
      forceIDontKnowOnWeakContext:
        typeof next.forceIDontKnowOnWeakContext === "boolean"
          ? next.forceIDontKnowOnWeakContext
          : this.ragConfig.forceIDontKnowOnWeakContext,
      rewriteEnabled:
        typeof next.rewriteEnabled === "boolean" ? next.rewriteEnabled : this.ragConfig.rewriteEnabled,
      filteringEnabled:
        typeof next.filteringEnabled === "boolean" ? next.filteringEnabled : this.ragConfig.filteringEnabled,
    };
    this._emitStateChanged();
  }

  exportLongTermMemory() { return normalizeLongTermMemory(this.longTermMemory); }
  exportInvariants() { return normalizeInvariants(this.invariants, { mergeWithDefaults: false }); }
  reset() { this.history = []; this.workingMemory = makeDefaultWorkingMemory(); this.taskState = Agent.makeDefaultTaskState(); this.lastInvariantCheck = null; this.summaryTotals = makeDefaultSummaryTotals(); this._emitStateChanged(); }
  exportState() { return this.stateSerializer.exportState(this); }
  importState(state) { this.stateSerializer.importState(this, state); this._emitStateChanged(); }
  loadState(state) { this.stateSerializer.loadState(this, state); }
  persistState() { return this.stateSerializer.persistState(this); }
  _emitStateChanged() { if (typeof this.onStateChanged === "function") this.onStateChanged(this.exportState()); }
  _slidingWindowSize() { return Math.max(1, Number(this.contextPolicy.keepLastMessages) || 12); }
  transitionTo(nextStage, expectedAction) { return this.taskWorkflow.transitionTo(nextStage, expectedAction); }
  startTask(userGoal) { return this.taskWorkflow.startTask(userGoal); }
  pauseTask() { return this.taskWorkflow.pauseTask(); }
  continueTask() { return this.taskWorkflow.continueTask(); }
  approveNextStage() { return this.taskWorkflow.approveNextStage(); }
  advanceToNextStage() { return this.taskWorkflow.advanceToNextStage(); }
  resetTask() { this.taskWorkflow.resetTask(); }
  runTaskStep(context = {}) { return this.taskWorkflow.runTaskStep(context); }
  buildAgentContext(userRequest = "") { return this.invariantGuard.buildAgentContext(this, userRequest); }
  createDraftPlan(agentContext) { return this.invariantGuard.createDraftPlan(agentContext); }
  checkInvariantConflicts(agentContext, draftPlan) { return this.invariantGuard.checkInvariantConflicts(agentContext, draftPlan); }
  formatInvariantRefusal(checkResult) { return this.invariantGuard.formatInvariantRefusal(checkResult); }
  _computeInvariantDecision(userRequest = "") { return this.invariantGuard.computeDecision(this, userRequest); }
  _extractJsonObject(text) { return extractJsonObject(text); }
  _buildResponseRequestBody(payload) { return this.modelGateway.buildResponseRequestBody(this, payload); }
  _buildContextInput(nextUserText, runtimeContext = null) { return this.contextBuilder.build(this, nextUserText, runtimeContext); }
  _runTaskLLMStep(input) { return this.modelGateway.runTaskLLMStep(this, input); }
  _updateMemoryWithLLM(nextUserText) { return this.memoryUpdateService.update(this, nextUserText); }

  async send(userText) {
    if (requiresAuthorization(this.apiMode) && !this.apiKey) throw new Error("API key пустой.");
    if (!userText.trim()) throw new Error("Пустое сообщение.");
    await this._updateMemoryWithLLM(userText);
    const decision = this._computeInvariantDecision(userText);
    this.lastInvariantCheck = decision.invariantCheck;
    const userMsg = { role: "user", text: userText, at: new Date().toISOString() };
    this.history.push(userMsg);
    this._emitStateChanged();
    if (decision.invariantCheck.conflict) {
      this.lastRagResult = { ...makeDefaultLastRagResult(), enabled: Boolean(this.ragConfig.enabled), question: String(userText || "") };
      const refusalText = this.formatInvariantRefusal(decision.invariantCheck);
      this.history.push({ role: "assistant", text: refusalText, at: new Date().toISOString(), model: "invariant-guard" });
      this._emitStateChanged();
      return { answer: refusalText, model: "invariant-guard", usage: null, durationSeconds: null, costRub: null, invariantCheck: decision.invariantCheck, refused: true };
    }
    try {
      return this.ragConfig.enabled
        ? await this.ragAnswerService.answerWithRag(this, { userText, userMsg, draftPlan: decision.draftPlan, invariantCheck: decision.invariantCheck })
        : await this.ragAnswerService.answerWithoutRag(this, { userText, userMsg, draftPlan: decision.draftPlan, invariantCheck: decision.invariantCheck });
    } catch (error) {
      if (this.ragConfig.enabled) {
        this.lastRagResult = { ...this.ragAnswerService.buildSafeRagError(error), question: String(userText || "") };
        this._emitStateChanged();
      }
      throw error;
    }
  }
}

export { buildProfilePriorityInstructions, normalizeUserProfile };
