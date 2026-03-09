import { OpenAIModelPricing } from "./pricing.js";
import { normalizeUsage } from "./helpers.js";
import { normalizeInvariants } from "./invariants.store.js";
import {
  createDraftPlan as createInvariantDraftPlan,
  checkInvariantConflicts as runInvariantChecker,
  normalizeInvariantCheck,
} from "./invariant-checker.js";
import { formatInvariantRefusal as buildInvariantRefusalText } from "./refusal-formatter.js";
import { TaskStageWorkflow } from "./task-stage-workflow.js";

function normalizeUserProfile(profile) {
  const raw =
    profile && typeof profile === "object" && !Array.isArray(profile)
      ? profile
      : {};
  const prefsRaw =
    raw.preferences &&
    typeof raw.preferences === "object" &&
    !Array.isArray(raw.preferences)
      ? raw.preferences
      : {};
  const normalizeString = (v) =>
    typeof v === "string" && v.trim() ? v.trim() : "";
  const constraints = Array.from(
    new Set(
      (Array.isArray(prefsRaw.constraints) ? prefsRaw.constraints : [])
        .filter((x) => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );

  return {
    id: normalizeString(raw.id) || null,
    name: normalizeString(raw.name) || "Стандартный",
    preferences: {
      style: normalizeString(prefsRaw.style) || "Кратко и по делу.",
      format: normalizeString(prefsRaw.format) || "Структурированный текст.",
      constraints,
    },
  };
}

function buildProfilePriorityInstructions(userProfile) {
  const p = normalizeUserProfile(userProfile);
  const constraints = Array.isArray(p.preferences.constraints)
    ? p.preferences.constraints
    : [];
  const lines = [
    "PROFILE DIRECTIVES (HIGH PRIORITY):",
    "These directives have higher priority than all non-safety user preferences in chat history.",
    "You MUST follow them when generating the final answer.",
    `- Profile name: ${p.name}`,
    `- Required style: ${p.preferences.style}`,
    `- Required output format: ${p.preferences.format}`,
  ];
  if (constraints.length > 0) {
    lines.push("- Hard constraints:");
    for (const c of constraints) {
      lines.push(`  - ${c}`);
    }
  } else {
    lines.push("- Hard constraints: (none)");
  }
  lines.push(
    "If there is a conflict between these directives and a user's latest request, ask a short clarification question.",
  );
  return lines.join("\n");
}

export class Agent {
  static makeDefaultInvariants() {
    return normalizeInvariants(null);
  }

  static makeDefaultLongTermMemory() {
    return {
      profile: {
        name: null,
        language: "ru",
        role: null,
      },
      preferences: {
        verbosity: "normal",
        format: ["structured"],
      },
      facts: [],
      stable_decisions: [],
    };
  }

  static makeDefaultWorkingMemory() {
    return {
      task: {
        goal: null,
        constraints: [],
        entities: {},
        decisions: [],
        open_questions: [],
        artifacts: [],
      },
    };
  }

  static normalizeLongTermMemory(value) {
    const base = Agent.makeDefaultLongTermMemory();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return base;
    }

    const profileRaw =
      value.profile &&
      typeof value.profile === "object" &&
      !Array.isArray(value.profile)
        ? value.profile
        : {};
    const preferencesRaw =
      value.preferences &&
      typeof value.preferences === "object" &&
      !Array.isArray(value.preferences)
        ? value.preferences
        : {};

    const normalizeStringArray = (arr) =>
      Array.from(
        new Set(
          (Array.isArray(arr) ? arr : [])
            .filter((x) => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      );

    return {
      profile: {
        name:
          typeof profileRaw.name === "string" && profileRaw.name.trim()
            ? profileRaw.name.trim()
            : null,
        language:
          typeof profileRaw.language === "string" && profileRaw.language.trim()
            ? profileRaw.language.trim()
            : base.profile.language,
        role:
          typeof profileRaw.role === "string" && profileRaw.role.trim()
            ? profileRaw.role.trim()
            : null,
      },
      preferences: {
        verbosity:
          typeof preferencesRaw.verbosity === "string" &&
          preferencesRaw.verbosity.trim()
            ? preferencesRaw.verbosity.trim()
            : base.preferences.verbosity,
        format: (() => {
          const format = normalizeStringArray(preferencesRaw.format);
          return format.length > 0 ? format : base.preferences.format;
        })(),
      },
      facts: normalizeStringArray(value.facts),
      stable_decisions: normalizeStringArray(value.stable_decisions),
    };
  }

  static normalizeWorkingMemory(value) {
    const base = Agent.makeDefaultWorkingMemory();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return base;
    }

    const taskRaw =
      value.task && typeof value.task === "object" && !Array.isArray(value.task)
        ? value.task
        : {};

    const normalizeStringArray = (arr) =>
      Array.from(
        new Set(
          (Array.isArray(arr) ? arr : [])
            .filter((x) => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      );

    const rawEntities =
      taskRaw.entities &&
      typeof taskRaw.entities === "object" &&
      !Array.isArray(taskRaw.entities)
        ? taskRaw.entities
        : {};
    const entities = {};
    for (const [k, v] of Object.entries(rawEntities)) {
      if (typeof k !== "string") continue;
      const key = k.trim();
      if (!key) continue;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
      ) {
        entities[key] = v;
      }
    }

    return {
      task: {
        goal:
          typeof taskRaw.goal === "string" && taskRaw.goal.trim()
            ? taskRaw.goal.trim()
            : null,
        constraints: normalizeStringArray(taskRaw.constraints),
        entities,
        decisions: normalizeStringArray(taskRaw.decisions),
        open_questions: normalizeStringArray(taskRaw.open_questions),
        artifacts: normalizeStringArray(taskRaw.artifacts),
      },
    };
  }

  static makeDefaultTaskState() {
    return TaskStageWorkflow.makeDefaultTaskState();
  }

  static normalizeTaskState(value) {
    return TaskStageWorkflow.normalizeTaskState(value);
  }

  constructor({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.history = [];
    this.longTermMemory = Agent.makeDefaultLongTermMemory();
    this.workingMemory = Agent.makeDefaultWorkingMemory();
    this.taskState = Agent.makeDefaultTaskState();
    this.invariants = Agent.makeDefaultInvariants();
    this.lastInvariantCheck = null;
    this.userProfile = normalizeUserProfile(null);

    // Separate accounting for summarization
    this.summaryTotals = {
      summaryRequests: 0,
      summaryInputTokens: 0,
      summaryOutputTokens: 0,
      summaryTotalTokens: 0,
      summaryCostRub: 0,
    };

    this.contextPolicy = {
      keepLastMessages: 20,
      memoryModel: "gpt-3.5-turbo",
      memoryTemperature: 0.1,
    };

    this.systemPreamble =
      "Ты полезный ассистент. Отвечай кратко и по делу, если не просят иначе.";
    this.plannerPrompt =
      "Собери короткий draft-план ответа на запрос, учитывая memory/task state/invariants. Переход между этапами задачи возможен только после явной команды пользователя approve.";
    this.invariantCheckerPrompt =
      "Проверь draft-план и запрос на конфликты с инвариантами. Любой конфликт означает отказ.";
    this.finalResponderPrompt =
      "Сформируй финальный ответ только в рамках инвариантов и активного профиля пользователя. Не инициируй переход к следующему этапу без явного разрешения пользователя.";
    this.refusalPrompt =
      "При конфликте дай отказ, назови нарушенные инварианты и предложи безопасную альтернативу.";

    this.onStateChanged = null;

    this.taskWorkflow = new TaskStageWorkflow({
      getTaskState: () => this.taskState,
      setTaskState: (next) => {
        this.taskState = next;
      },
      getInvariants: () => this.invariants,
      emitStateChanged: () => this._emitStateChanged(),
      setLastInvariantCheck: (check) => {
        this.lastInvariantCheck = check;
      },
      computeInvariantDecision: (userRequest) =>
        this._computeInvariantDecision(userRequest),
      formatInvariantRefusal: (checkResult) =>
        this.formatInvariantRefusal(checkResult),
      runTaskLLMStep: (input) => this._runTaskLLMStep(input),
      extractJsonObject: (text) => this._extractJsonObject(text),
    });
  }

  setConfig({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this._emitStateChanged();
  }

  setContextPolicy(patch) {
    this.contextPolicy = { ...this.contextPolicy, ...(patch || {}) };
    this._emitStateChanged();
  }

  setLongTermMemory(value) {
    this.longTermMemory = Agent.normalizeLongTermMemory(value);
    this._emitStateChanged();
  }

  setInvariants(value) {
    this.invariants = normalizeInvariants(value, { mergeWithDefaults: false });
    this._emitStateChanged();
  }

  setUserProfile(profile) {
    this.userProfile = normalizeUserProfile(profile);
    this._emitStateChanged();
  }

  exportLongTermMemory() {
    return Agent.normalizeLongTermMemory(this.longTermMemory);
  }

  exportInvariants() {
    return normalizeInvariants(this.invariants, { mergeWithDefaults: false });
  }

  reset() {
    this.history = [];
    this.workingMemory = Agent.makeDefaultWorkingMemory();
    this.taskState = Agent.makeDefaultTaskState();
    this.lastInvariantCheck = null;
    this.summaryTotals = {
      summaryRequests: 0,
      summaryInputTokens: 0,
      summaryOutputTokens: 0,
      summaryTotalTokens: 0,
      summaryCostRub: 0,
    };
    this._emitStateChanged();
  }

  exportState() {
    const keepLast = this._slidingWindowSize();
    const shortTermMemory = {
      messages: this.history.slice(-keepLast).map((m) => ({
        role: m.role,
        content: String(m.text || ""),
      })),
    };

    return {
      version: 7,
      savedAt: new Date().toISOString(),
      config: {
        baseUrl: this.baseUrl,
        apiKey: null,
        model: this.model,
        temperature: this.temperature,
      },
      systemPreamble: this.systemPreamble,
      contextPolicy: this.contextPolicy,
      userProfile: this.userProfile,
      workingMemory: this.workingMemory,
      taskState: this.taskState,
      invariants: this.invariants,
      lastInvariantCheck: this.lastInvariantCheck,
      shortTermMemory,
      summaryTotals: this.summaryTotals,
      history: this.history,
    };
  }

  importState(state) {
    if (!state || typeof state !== "object") return;

    if (typeof state.systemPreamble === "string") {
      this.systemPreamble = state.systemPreamble;
    }
    if (state.userProfile && typeof state.userProfile === "object") {
      this.userProfile = normalizeUserProfile(state.userProfile);
    }

    if (state.config && typeof state.config === "object") {
      if (typeof state.config.baseUrl === "string")
        this.baseUrl = state.config.baseUrl;
      if (typeof state.config.model === "string")
        this.model = state.config.model;
      if (typeof state.config.temperature === "number")
        this.temperature = state.config.temperature;
    }

    if (state.contextPolicy && typeof state.contextPolicy === "object") {
      this.contextPolicy = { ...this.contextPolicy, ...state.contextPolicy };
      if (
        typeof this.contextPolicy.memoryModel !== "string" &&
        typeof state.contextPolicy.factsModel === "string"
      ) {
        this.contextPolicy.memoryModel = state.contextPolicy.factsModel;
      }
      if (
        !Number.isFinite(this.contextPolicy.memoryTemperature) &&
        Number.isFinite(state.contextPolicy.factsTemperature)
      ) {
        this.contextPolicy.memoryTemperature =
          state.contextPolicy.factsTemperature;
      }
    }

    if (
      state.workingMemory &&
      typeof state.workingMemory === "object" &&
      !Array.isArray(state.workingMemory)
    ) {
      this.workingMemory = Agent.normalizeWorkingMemory(state.workingMemory);
    } else if (
      state.facts &&
      typeof state.facts === "object" &&
      !Array.isArray(state.facts)
    ) {
      // Legacy fallback: map key-value facts into working.task.entities.
      const normalized = Agent.normalizeWorkingMemory(this.workingMemory);
      const entities = { ...normalized.task.entities };
      for (const [k, v] of Object.entries(state.facts)) {
        if (!k) continue;
        if (typeof v === "string" && v.trim()) {
          entities[k] = v.trim();
          continue;
        }
        if (Array.isArray(v)) {
          const compact = v
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean);
          if (compact.length > 0) entities[k] = compact.join("; ");
        }
      }
      this.workingMemory = {
        task: {
          ...normalized.task,
          entities,
        },
      };
    }

    if (
      state.taskState &&
      typeof state.taskState === "object" &&
      !Array.isArray(state.taskState)
    ) {
      this.taskState = Agent.normalizeTaskState(state.taskState);
    }

    if (Array.isArray(state.invariants)) {
      // Preserve per-chat invariant set exactly as saved (including deletions).
      this.invariants = normalizeInvariants(state.invariants, {
        mergeWithDefaults: false,
      });
    }

    if (
      state.lastInvariantCheck &&
      typeof state.lastInvariantCheck === "object" &&
      !Array.isArray(state.lastInvariantCheck)
    ) {
      this.lastInvariantCheck = normalizeInvariantCheck(
        state.lastInvariantCheck,
      );
    } else {
      this.lastInvariantCheck = null;
    }

    if (state.summaryTotals && typeof state.summaryTotals === "object") {
      const t = state.summaryTotals;
      this.summaryTotals = {
        summaryRequests: Number.isFinite(t.summaryRequests)
          ? t.summaryRequests
          : 0,
        summaryInputTokens: Number.isFinite(t.summaryInputTokens)
          ? t.summaryInputTokens
          : 0,
        summaryOutputTokens: Number.isFinite(t.summaryOutputTokens)
          ? t.summaryOutputTokens
          : 0,
        summaryTotalTokens: Number.isFinite(t.summaryTotalTokens)
          ? t.summaryTotalTokens
          : 0,
        summaryCostRub: Number.isFinite(t.summaryCostRub)
          ? t.summaryCostRub
          : 0,
      };
    }

    if (Array.isArray(state.history)) {
      this.history = state.history
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.text === "string",
        )
        .map((m) => ({
          role: m.role,
          text: m.text,
          at: typeof m.at === "string" ? m.at : new Date().toISOString(),
          model: typeof m.model === "string" ? m.model : undefined,
          requestInputTokens: Number.isFinite(m.requestInputTokens)
            ? m.requestInputTokens
            : undefined,
          requestOutputTokens: Number.isFinite(m.requestOutputTokens)
            ? m.requestOutputTokens
            : undefined,
          requestTotalTokens: Number.isFinite(m.requestTotalTokens)
            ? m.requestTotalTokens
            : undefined,
          costRub: Number.isFinite(m.costRub) ? m.costRub : undefined,
          durationSeconds: Number.isFinite(m.durationSeconds)
            ? m.durationSeconds
            : undefined,
        }));
    }

    this._emitStateChanged();
  }

  _emitStateChanged() {
    if (typeof this.onStateChanged === "function") {
      this.onStateChanged(this.exportState());
    }
  }

  loadState(state) {
    this.importState(state);
  }

  persistState() {
    return this.exportState();
  }

  _slidingWindowSize() {
    return Math.max(1, Number(this.contextPolicy.keepLastMessages) || 12);
  }

  transitionTo(nextStage, expectedAction) {
    return this.taskWorkflow.transitionTo(nextStage, expectedAction);
  }

  startTask(userGoal) {
    return this.taskWorkflow.startTask(userGoal);
  }

  pauseTask() {
    return this.taskWorkflow.pauseTask();
  }

  continueTask() {
    return this.taskWorkflow.continueTask();
  }

  approveNextStage() {
    return this.taskWorkflow.approveNextStage();
  }

  advanceToNextStage() {
    return this.taskWorkflow.advanceToNextStage();
  }

  resetTask() {
    this.taskWorkflow.resetTask();
  }

  buildAgentContext(userRequest = "") {
    return {
      userRequest: String(userRequest || "").trim(),
      memory: {
        longTerm: Agent.normalizeLongTermMemory(this.longTermMemory),
        working: Agent.normalizeWorkingMemory(this.workingMemory),
      },
      taskState: Agent.normalizeTaskState(this.taskState),
      invariants: normalizeInvariants(this.invariants, {
        mergeWithDefaults: false,
      }),
    };
  }

  createDraftPlan(agentContext) {
    return createInvariantDraftPlan(agentContext);
  }

  checkInvariantConflicts(agentContext, draftPlan) {
    const ctx =
      agentContext &&
      typeof agentContext === "object" &&
      !Array.isArray(agentContext)
        ? agentContext
        : this.buildAgentContext("");
    return runInvariantChecker({
      request: ctx.userRequest,
      draftPlan,
      taskState: ctx.taskState,
      invariants: ctx.invariants,
    });
  }

  formatInvariantRefusal(checkResult) {
    return buildInvariantRefusalText(checkResult);
  }

  _computeInvariantDecision(userRequest = "") {
    const agentContext = this.buildAgentContext(userRequest);
    const draftPlan = this.createDraftPlan(agentContext);
    const invariantCheck = this.checkInvariantConflicts(
      agentContext,
      draftPlan,
    );
    return { agentContext, draftPlan, invariantCheck };
  }

  _extractJsonObject(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      const start = t.indexOf("{");
      const end = t.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(t.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  _extractMemoryWritePatch(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const root =
      parsed.write &&
      typeof parsed.write === "object" &&
      !Array.isArray(parsed.write)
        ? parsed.write
        : parsed;
    return root && typeof root === "object" && !Array.isArray(root)
      ? root
      : null;
  }

  _pushUniqueStrings(target, values) {
    const next = Array.isArray(target) ? [...target] : [];
    for (const raw of Array.isArray(values) ? values : []) {
      if (typeof raw !== "string") continue;
      const item = raw.trim();
      if (!item || next.includes(item)) continue;
      next.push(item);
    }
    return next;
  }

  _mergeEntityObject(target, patch) {
    const out =
      target && typeof target === "object" && !Array.isArray(target)
        ? { ...target }
        : {};
    const src =
      patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof k !== "string") continue;
      const key = k.trim();
      if (!key) continue;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null
      ) {
        out[key] = v;
      }
    }
    return out;
  }

  _applyMemoryWritePatch(writePatch) {
    if (
      !writePatch ||
      typeof writePatch !== "object" ||
      Array.isArray(writePatch)
    )
      return;

    const normalizedLong = Agent.normalizeLongTermMemory(this.longTermMemory);
    const normalizedWorking = Agent.normalizeWorkingMemory(this.workingMemory);

    const workingPatch =
      writePatch.working &&
      typeof writePatch.working === "object" &&
      !Array.isArray(writePatch.working)
        ? writePatch.working
        : {};
    const longPatch =
      writePatch.long_term &&
      typeof writePatch.long_term === "object" &&
      !Array.isArray(writePatch.long_term)
        ? writePatch.long_term
        : {};

    const nextWorking = {
      task: {
        ...normalizedWorking.task,
      },
    };

    if (
      typeof workingPatch.set_goal === "string" &&
      workingPatch.set_goal.trim()
    ) {
      nextWorking.task.goal = workingPatch.set_goal.trim();
    }
    nextWorking.task.constraints = this._pushUniqueStrings(
      nextWorking.task.constraints,
      workingPatch.add_constraints,
    );
    nextWorking.task.decisions = this._pushUniqueStrings(
      nextWorking.task.decisions,
      workingPatch.add_decisions,
    );
    nextWorking.task.open_questions = this._pushUniqueStrings(
      nextWorking.task.open_questions,
      workingPatch.add_open_questions,
    );
    nextWorking.task.artifacts = this._pushUniqueStrings(
      nextWorking.task.artifacts,
      workingPatch.add_artifacts,
    );
    nextWorking.task.entities = this._mergeEntityObject(
      nextWorking.task.entities,
      workingPatch.merge_entities,
    );

    const nextLong = {
      ...normalizedLong,
      profile: {
        ...normalizedLong.profile,
      },
      preferences: {
        ...normalizedLong.preferences,
      },
    };

    if (
      longPatch.add_profile &&
      typeof longPatch.add_profile === "object" &&
      !Array.isArray(longPatch.add_profile)
    ) {
      for (const [k, v] of Object.entries(longPatch.add_profile)) {
        if (typeof k !== "string" || typeof v !== "string" || !v.trim())
          continue;
        nextLong.profile[k.trim()] = v.trim();
      }
    }
    if (
      longPatch.add_preferences &&
      typeof longPatch.add_preferences === "object" &&
      !Array.isArray(longPatch.add_preferences)
    ) {
      for (const [k, v] of Object.entries(longPatch.add_preferences)) {
        if (typeof k !== "string") continue;
        const key = k.trim();
        if (!key) continue;
        if (Array.isArray(v)) {
          nextLong.preferences[key] = this._pushUniqueStrings([], v);
        } else if (typeof v === "string" && v.trim()) {
          nextLong.preferences[key] = v.trim();
        }
      }
    }
    nextLong.facts = this._pushUniqueStrings(
      nextLong.facts,
      longPatch.add_facts,
    );
    nextLong.stable_decisions = this._pushUniqueStrings(
      nextLong.stable_decisions,
      longPatch.add_stable_decisions,
    );

    this.workingMemory = Agent.normalizeWorkingMemory(nextWorking);
    this.longTermMemory = Agent.normalizeLongTermMemory(nextLong);
  }

  async _runTaskLLMStep(input) {
    if (!this.apiKey) throw new Error("API key пустой.");
    const url = this.baseUrl.replace(/\/+$/, "") + "/openai/v1/responses";
    const body = {
      model: this.model,
      input,
      temperature: Number(this.temperature),
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }

    const dto = await resp.json();
    const answerText = Agent.extractAnswerText(dto);
    if (!answerText) throw new Error("Пустой ответ: не нашёл output_text.");
    return answerText;
  }

  async runTaskStep(context = {}) {
    return this.taskWorkflow.runTaskStep(context);
  }

  async _updateMemoryWithLLM(nextUserText) {
    if (!this.apiKey)
      throw new Error("API key пустой (нужен для memory update).");

    const keepLast = this._slidingWindowSize();
    const recentMessages = this.history.slice(-keepLast);
    const contextBlock =
      recentMessages.length > 0
        ? recentMessages
            .map(
              (m) =>
                `${m.role === "user" ? "User" : "Assistant"}: ${String(
                  m.text || "",
                ).trim()}`,
            )
            .filter(Boolean)
            .join("\n")
        : "(empty)";

    const instruction =
      `Ты извлекаешь изменения памяти из контекста и нового сообщения пользователя.\n` +
      `Верни ТОЛЬКО JSON-объект строго формата:\n` +
      `{"write":{"working":{"set_goal":null,"add_constraints":[],"add_decisions":[],"add_open_questions":[],"merge_entities":{},"add_artifacts":[]},"long_term":{"add_preferences":{},"add_facts":[],"add_profile":{},"add_stable_decisions":[]}}}\n` +
      `Правила:\n` +
      `- Заполняй только то, что действительно следует из сообщения и контекста.\n` +
      `- Если нечего менять: верни пустые массивы/объекты и null для set_goal.\n` +
      `- Не выдумывай факты.\n` +
      `- Пиши значения на русском, если нет явного указания на другой язык.\n`;

    const input =
      `SYSTEM: ${instruction}\n` +
      `ACTIVE USER PROFILE:\n${JSON.stringify(this.userProfile, null, 2)}\n` +
      `LONG_TERM_MEMORY:\n${JSON.stringify(this.longTermMemory, null, 2)}\n` +
      `WORKING_MEMORY:\n${JSON.stringify(this.workingMemory, null, 2)}\n` +
      `INVARIANTS:\n${JSON.stringify(this.invariants, null, 2)}\n` +
      `CONTEXT:\n${contextBlock}\n` +
      `USER_MESSAGE:\n${String(nextUserText || "").trim()}\n` +
      `JSON:\n`;

    const url = this.baseUrl.replace(/\/+$/, "") + "/openai/v1/responses";
    const body = {
      model: this.contextPolicy.memoryModel || "gpt-3.5-turbo",
      input,
      temperature: Number(this.contextPolicy.memoryTemperature ?? 0.1),
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Memory HTTP ${resp.status}: ${text || resp.statusText}`);
    }

    const dto = await resp.json();
    const memoryText = Agent.extractAnswerText(dto);
    if (!memoryText) throw new Error("Memory: пустой output_text.");

    const parsed = this._extractJsonObject(memoryText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Memory: модель вернула не JSON-объект.");
    }
    const writePatch = this._extractMemoryWritePatch(parsed);
    if (!writePatch) {
      throw new Error("Memory: модель вернула невалидный write-патч.");
    }
    this._applyMemoryWritePatch(writePatch);

    const usage = normalizeUsage(dto);
    const modelName = dto.model || body.model;
    const costRub = usage
      ? OpenAIModelPricing.costRub(
          modelName,
          usage.inputTokens,
          usage.outputTokens,
        )
      : null;

    if (usage) {
      this.summaryTotals.summaryRequests += 1;
      this.summaryTotals.summaryInputTokens += usage.inputTokens;
      this.summaryTotals.summaryOutputTokens += usage.outputTokens;
      this.summaryTotals.summaryTotalTokens += usage.totalTokens;
      if (costRub != null) this.summaryTotals.summaryCostRub += costRub;
    }

    this._emitStateChanged();
  }

  // =====================
  // Context build
  // =====================

  async _buildContextInput(nextUserText, runtimeContext = null) {
    const keepLast = this._slidingWindowSize();
    const tail = this.history.slice(-keepLast);

    const parts = [];
    parts.push(`SYSTEM: ${this.systemPreamble}`);
    parts.push(`PLANNER PROMPT: ${this.plannerPrompt}`);
    parts.push(`INVARIANT CHECKER PROMPT: ${this.invariantCheckerPrompt}`);
    parts.push(`FINAL RESPONDER PROMPT: ${this.finalResponderPrompt}`);
    parts.push(`REFUSAL MODE PROMPT: ${this.refusalPrompt}`);
    parts.push(buildProfilePriorityInstructions(this.userProfile));
    parts.push("ACTIVE USER PROFILE:");
    parts.push(JSON.stringify(this.userProfile, null, 2));
    parts.push("MEMORY LAYERS:");
    parts.push("LONG-TERM MEMORY:");
    parts.push(JSON.stringify(this.longTermMemory, null, 2));
    parts.push("WORKING MEMORY:");
    parts.push(JSON.stringify(this.workingMemory, null, 2));
    parts.push("TASK STATE:");
    parts.push(JSON.stringify(this.taskState, null, 2));
    parts.push("INVARIANTS:");
    parts.push(JSON.stringify(this.invariants, null, 2));

    if (
      runtimeContext &&
      typeof runtimeContext === "object" &&
      !Array.isArray(runtimeContext)
    ) {
      const draftPlan = runtimeContext.draftPlan || null;
      const invariantCheck = runtimeContext.invariantCheck || null;
      if (draftPlan) {
        parts.push("DRAFT PLAN:");
        parts.push(JSON.stringify(draftPlan, null, 2));
      }
      if (invariantCheck) {
        parts.push("INVARIANT CHECK RESULT:");
        parts.push(JSON.stringify(invariantCheck, null, 2));
      }
    }
    const shortTerm = {
      messages: tail.map((m) => ({
        role: m.role,
        content: String(m.text || ""),
      })),
    };
    parts.push("SHORT-TERM MEMORY:");
    parts.push(JSON.stringify(shortTerm, null, 2));

    if (tail.length > 0) {
      parts.push("RECENT MESSAGES:");
      for (const m of tail) {
        parts.push(`${m.role.toUpperCase()}: ${m.text}`);
      }
    }

    parts.push(`USER: ${nextUserText}`);
    parts.push("ASSISTANT:");
    return parts.join("\n");
  }

  async generateFinalResponse({
    userText,
    userMsg,
    draftPlan,
    invariantCheck,
  }) {
    const input = await this._buildContextInput(userText, {
      draftPlan,
      invariantCheck,
    });
    const url = this.baseUrl.replace(/\/+$/, "") + "/openai/v1/responses";
    const body = {
      model: this.model,
      input,
      temperature: Number(this.temperature),
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }

    const dto = await resp.json();
    const answerText = Agent.extractAnswerText(dto);
    if (!answerText) throw new Error("Пустой ответ: не нашёл output_text.");

    const usage = normalizeUsage(dto);
    const durationSeconds =
      Number.isFinite(dto.created_at) && Number.isFinite(dto.completed_at)
        ? dto.completed_at - dto.created_at
        : null;
    const modelName = dto.model || this.model;
    const costRub = usage
      ? OpenAIModelPricing.costRub(
          modelName,
          usage.inputTokens,
          usage.outputTokens,
        )
      : null;

    if (usage && userMsg) {
      userMsg.model = modelName;
      userMsg.requestInputTokens = usage.inputTokens;
      userMsg.requestOutputTokens = usage.outputTokens;
      userMsg.requestTotalTokens = usage.totalTokens;
      userMsg.costRub = costRub != null ? costRub : undefined;
      userMsg.durationSeconds =
        durationSeconds != null ? durationSeconds : undefined;
    }

    const assistantMsg = {
      role: "assistant",
      text: answerText,
      at: new Date().toISOString(),
      model: modelName,
      requestInputTokens: usage ? usage.inputTokens : undefined,
      requestOutputTokens: usage ? usage.outputTokens : undefined,
      requestTotalTokens: usage ? usage.totalTokens : undefined,
      costRub: costRub != null ? costRub : undefined,
      durationSeconds: durationSeconds != null ? durationSeconds : undefined,
    };
    this.history.push(assistantMsg);

    this._emitStateChanged();

    return {
      answer: answerText,
      model: modelName,
      usage,
      durationSeconds,
      costRub,
      invariantCheck,
      refused: false,
    };
  }

  // =====================
  // Main send (chat request)
  // =====================

  async send(userText) {
    if (!this.apiKey) throw new Error("API key пустой.");
    if (!userText.trim()) throw new Error("Пустое сообщение.");

    await this._updateMemoryWithLLM(userText);
    const decision = this._computeInvariantDecision(userText);
    this.lastInvariantCheck = decision.invariantCheck;

    // 1) add user message to history
    const userMsg = {
      role: "user",
      text: userText,
      at: new Date().toISOString(),
    };
    this.history.push(userMsg);
    this._emitStateChanged();

    if (decision.invariantCheck.conflict) {
      const refusalText = this.formatInvariantRefusal(decision.invariantCheck);
      this.history.push({
        role: "assistant",
        text: refusalText,
        at: new Date().toISOString(),
        model: "invariant-guard",
      });
      this._emitStateChanged();
      return {
        answer: refusalText,
        model: "invariant-guard",
        usage: null,
        durationSeconds: null,
        costRub: null,
        invariantCheck: decision.invariantCheck,
        refused: true,
      };
    }

    return this.generateFinalResponse({
      userText,
      userMsg,
      draftPlan: decision.draftPlan,
      invariantCheck: decision.invariantCheck,
    });
  }

  static extractAnswerText(dto) {
    const output = Array.isArray(dto.output) ? dto.output : [];
    const assistantItem = output.find(
      (it) => it && it.type === "message" && it.role === "assistant",
    );
    const content =
      assistantItem && Array.isArray(assistantItem.content)
        ? assistantItem.content
        : [];
    const textItem = content.find(
      (c) => c && c.type === "output_text" && typeof c.text === "string",
    );
    const t = textItem ? textItem.text : null;
    return (t || "").trim() || null;
  }
}
