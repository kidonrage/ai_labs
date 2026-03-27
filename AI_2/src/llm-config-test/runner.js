import { Agent } from "../agent.js";
import { LLM_CONFIG_TEST_CONFIGS, LLM_TEST_SYSTEM_PROMPT } from "./configs.js";
import { LLM_CONFIG_TEST_QUESTIONS } from "./questions.js";

function normalizeRunError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return String(error);
}

function normalizeSources(answerResult) {
  const raw = answerResult && Array.isArray(answerResult.sources) ? answerResult.sources : [];
  return raw.map((source) => ({
    source: typeof source.source === "string" ? source.source : "unknown",
    section: typeof source.section === "string" ? source.section : "unknown",
    chunk_id: typeof source.chunk_id === "string" ? source.chunk_id : "unknown",
  }));
}

function createDetachedAgent(sourceAgent, config) {
  const detached = new Agent({
    apiMode: sourceAgent.apiMode,
    baseUrl: sourceAgent.baseUrl,
    apiKey: sourceAgent.apiKey,
    model: config.model,
    temperature: config.temperature,
  });
  detached.loadState(sourceAgent.persistState());
  detached.onStateChanged = null;
  detached.setConfig({
    apiMode: sourceAgent.apiMode,
    baseUrl: sourceAgent.baseUrl,
    apiKey: sourceAgent.apiKey,
    model: config.model,
    temperature: config.temperature,
  });
  detached.setRagConfig({
    ...sourceAgent.ragConfig,
    enabled: true,
  });
  detached.setTestModeConfig({
    systemPreamble: LLM_TEST_SYSTEM_PROMPT,
    ollamaOptions: {
      num_predict: config.maxTokens,
      num_ctx: config.contextWindow,
    },
  });
  return detached;
}

class LlmConfigTestRunner {
  async runSingle(sourceAgent, config, question) {
    const started = new Date();
    try {
      const detached = createDetachedAgent(sourceAgent, config);
      const response = await detached.send(question.text);
      const finished = new Date();
      const answerResult =
        response && response.answerResult && typeof response.answerResult === "object"
          ? response.answerResult
          : detached.lastRagResult && detached.lastRagResult.answerResult
            ? detached.lastRagResult.answerResult
            : null;
      return {
        configName: config.name,
        questionId: question.id,
        questionText: question.text,
        answerText: typeof response?.answer === "string" ? response.answer : "",
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        sources: normalizeSources(answerResult),
        error: null,
      };
    } catch (error) {
      const finished = new Date();
      return {
        configName: config.name,
        questionId: question.id,
        questionText: question.text,
        answerText: "",
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        sources: [],
        error: normalizeRunError(error),
      };
    }
  }

  async run(sourceAgent, options = {}) {
    if (!sourceAgent) throw new Error("Agent is required for LLM config test.");
    const configs =
      Array.isArray(options.configs) && options.configs.length > 0
        ? options.configs
        : LLM_CONFIG_TEST_CONFIGS;
    const questions =
      Array.isArray(options.questions) && options.questions.length > 0
        ? options.questions
        : LLM_CONFIG_TEST_QUESTIONS;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const results = [];
    let completedRuns = 0;
    const totalRuns = configs.length * questions.length;

    for (let configIndex = 0; configIndex < configs.length; configIndex += 1) {
      const config = configs[configIndex];
      for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
        const question = questions[questionIndex];
        onProgress?.({
          state: "running",
          config,
          configIndex,
          configCount: configs.length,
          question,
          questionIndex,
          questionCount: questions.length,
          completedRuns,
          totalRuns,
        });
        results.push(await this.runSingle(sourceAgent, config, question));
        completedRuns += 1;
      }
    }

    onProgress?.({
      state: "done",
      completedRuns,
      totalRuns,
      configCount: configs.length,
      questionCount: questions.length,
    });
    return results;
  }
}

export { LlmConfigTestRunner, normalizeRunError };
