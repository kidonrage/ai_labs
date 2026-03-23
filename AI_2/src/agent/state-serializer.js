import { inferApiMode } from "../api-profiles.js";
import { normalizeInvariantCheck } from "../invariant-checker.js";
import { normalizeInvariants } from "../invariants.store.js";
import { TaskStageWorkflow } from "../task-stage-workflow.js";
import {
  makeDefaultContextPolicy,
  makeDefaultLastRagResult,
  makeDefaultSummaryTotals,
  normalizeLongTermMemory,
  normalizeWorkingMemory,
} from "./state-shapes.js";
import { normalizeUserProfile } from "./user-profile.js";

const cloneChunkList = (items) =>
  (Array.isArray(items) ? items : [])
    .filter((chunk) => chunk && typeof chunk === "object")
    .map((chunk) => ({
      chunk_id: typeof chunk.chunk_id === "string" ? chunk.chunk_id : null,
      source: typeof chunk.source === "string" ? chunk.source : "unknown",
      section: typeof chunk.section === "string" ? chunk.section : "unknown",
      text: typeof chunk.text === "string" ? chunk.text : "",
      similarity: Number.isFinite(chunk.similarity) ? chunk.similarity : -1,
    }));

class AgentStateSerializer {
  exportState(agent) {
    const keepLast = Math.max(1, Number(agent.contextPolicy.keepLastMessages) || 12);
    return {
      version: 7,
      savedAt: new Date().toISOString(),
      config: {
        apiMode: agent.apiMode,
        baseUrl: agent.baseUrl,
        apiKey: null,
        model: agent.model,
        temperature: agent.temperature,
      },
      systemPreamble: agent.systemPreamble,
      contextPolicy: agent.contextPolicy,
      userProfile: agent.userProfile,
      ragConfig: agent.ragConfig,
      lastRagResult: agent.lastRagResult,
      workingMemory: agent.workingMemory,
      taskState: agent.taskState,
      invariants: agent.invariants,
      lastInvariantCheck: agent.lastInvariantCheck,
      shortTermMemory: {
        messages: agent.history.slice(-keepLast).map((item) => ({
          role: item.role,
          content: String(item.text || ""),
        })),
      },
      summaryTotals: agent.summaryTotals,
      history: agent.history,
    };
  }

  importState(agent, state) {
    if (!state || typeof state !== "object") return;
    if (typeof state.systemPreamble === "string") agent.systemPreamble = state.systemPreamble;
    if (state.userProfile && typeof state.userProfile === "object") {
      agent.userProfile = normalizeUserProfile(state.userProfile);
    }
    if (state.config && typeof state.config === "object") {
      if (typeof state.config.apiMode === "string") {
        agent.apiMode = inferApiMode(state.config.apiMode, state.config.baseUrl);
      }
      if (typeof state.config.baseUrl === "string") agent.baseUrl = state.config.baseUrl;
      if (typeof state.config.model === "string") agent.model = state.config.model;
      if (typeof state.config.temperature === "number") agent.temperature = state.config.temperature;
    }
    if (state.contextPolicy && typeof state.contextPolicy === "object") {
      agent.contextPolicy = { ...makeDefaultContextPolicy(), ...agent.contextPolicy, ...state.contextPolicy };
      if (typeof agent.contextPolicy.memoryModel !== "string" && typeof state.contextPolicy.factsModel === "string") {
        agent.contextPolicy.memoryModel = state.contextPolicy.factsModel;
      }
      if (!Number.isFinite(agent.contextPolicy.memoryTemperature) && Number.isFinite(state.contextPolicy.factsTemperature)) {
        agent.contextPolicy.memoryTemperature = state.contextPolicy.factsTemperature;
      }
    }
    if (state.ragConfig && typeof state.ragConfig === "object") {
      agent.setRagConfig(state.ragConfig);
    }
    if (state.lastRagResult && typeof state.lastRagResult === "object") {
      agent.lastRagResult = {
        ...makeDefaultLastRagResult(),
        ...state.lastRagResult,
        chunks: cloneChunkList(state.lastRagResult.chunks),
        candidatesBeforeFilter: cloneChunkList(state.lastRagResult.candidatesBeforeFilter),
      };
    }
    if (state.workingMemory && typeof state.workingMemory === "object") {
      agent.workingMemory = normalizeWorkingMemory(state.workingMemory);
    } else if (state.facts && typeof state.facts === "object") {
      const normalized = normalizeWorkingMemory(agent.workingMemory);
      const entities = { ...normalized.task.entities };
      for (const [key, value] of Object.entries(state.facts)) {
        if (typeof value === "string" && value.trim()) entities[key] = value.trim();
        if (Array.isArray(value)) {
          const compact = value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
          if (compact.length > 0) entities[key] = compact.join("; ");
        }
      }
      agent.workingMemory = { task: { ...normalized.task, entities } };
    }
    agent.taskState =
      state.taskState && typeof state.taskState === "object"
        ? TaskStageWorkflow.normalizeTaskState(state.taskState)
        : agent.taskState;
    if (Array.isArray(state.invariants)) {
      agent.invariants = normalizeInvariants(state.invariants, { mergeWithDefaults: false });
    }
    agent.lastInvariantCheck =
      state.lastInvariantCheck && typeof state.lastInvariantCheck === "object"
        ? normalizeInvariantCheck(state.lastInvariantCheck)
        : null;
    if (state.summaryTotals && typeof state.summaryTotals === "object") {
      const summary = { ...makeDefaultSummaryTotals(), ...state.summaryTotals };
      agent.summaryTotals = {
        summaryRequests: Number.isFinite(summary.summaryRequests) ? summary.summaryRequests : 0,
        summaryInputTokens: Number.isFinite(summary.summaryInputTokens) ? summary.summaryInputTokens : 0,
        summaryOutputTokens: Number.isFinite(summary.summaryOutputTokens) ? summary.summaryOutputTokens : 0,
        summaryTotalTokens: Number.isFinite(summary.summaryTotalTokens) ? summary.summaryTotalTokens : 0,
        summaryCostRub: Number.isFinite(summary.summaryCostRub) ? summary.summaryCostRub : 0,
      };
    }
    if (Array.isArray(state.history)) {
      agent.history = state.history
        .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
        .map((item) => ({
          role: item.role,
          text: item.text,
          at: typeof item.at === "string" ? item.at : new Date().toISOString(),
          model: typeof item.model === "string" ? item.model : undefined,
          requestInputTokens: Number.isFinite(item.requestInputTokens) ? item.requestInputTokens : undefined,
          requestOutputTokens: Number.isFinite(item.requestOutputTokens) ? item.requestOutputTokens : undefined,
          requestTotalTokens: Number.isFinite(item.requestTotalTokens) ? item.requestTotalTokens : undefined,
          costRub: Number.isFinite(item.costRub) ? item.costRub : undefined,
          durationSeconds: Number.isFinite(item.durationSeconds) ? item.durationSeconds : undefined,
          answerResult: item.answerResult && typeof item.answerResult === "object" ? item.answerResult : undefined,
        }));
    }
    agent.longTermMemory = normalizeLongTermMemory(state.longTermMemory);
  }

  loadState(agent, state) {
    this.importState(agent, state);
    agent._emitStateChanged();
  }

  persistState(agent) {
    return this.exportState(agent);
  }
}

export { AgentStateSerializer };
