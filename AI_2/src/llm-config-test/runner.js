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

function previewText(text, maxLength = 320) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function normalizeChunkPreview(chunk) {
  return {
    chunkId: chunk?.chunk_id || "unknown",
    source: chunk?.source || "unknown",
    section: chunk?.section || chunk?.title || "unknown",
    similarity: Number.isFinite(chunk?.similarity) ? chunk.similarity : null,
    preview: previewText(chunk?.text || chunk?.preview || "", 360),
  };
}

function pickRetrievedChunks(ragResult) {
  const debugCandidates = Array.isArray(ragResult?.debug?.candidatesBeforeFilter)
    ? ragResult.debug.candidatesBeforeFilter
    : [];
  const finalChunks = Array.isArray(ragResult?.chunks) ? ragResult.chunks : [];
  const list = debugCandidates.length > 0 ? debugCandidates : finalChunks;
  return {
    retrievedChunkCount: list.length,
    retrievedChunksPreview: list.slice(0, 3).map(normalizeChunkPreview),
  };
}

function pickAnswerResult(response, detached) {
  if (response?.answerResult && typeof response.answerResult === "object") return response.answerResult;
  if (detached?.lastRagResult?.answerResult && typeof detached.lastRagResult.answerResult === "object") {
    return detached.lastRagResult.answerResult;
  }
  return null;
}

function classifyError(error, answerResult) {
  if (error?.errorType) return error.errorType;
  if (answerResult?.errorType) return answerResult.errorType;
  const message = `${normalizeRunError(error)} ${answerResult?.errorMessage || ""}`.toLowerCase();
  if (message.includes("memory")) return "memory_error";
  if (message.includes("output_text") || message.includes("извлечь текст")) return "response_parse_error";
  if (message.includes("http ") || message.includes("fetch") || message.includes("network")) return "model_call_error";
  if (message.includes("rag") || message.includes("embedding") || message.includes("индекс") || message.includes("retrieval")) {
    return "retrieval_error";
  }
  if (message.includes("postprocess") || message.includes("evidence") || message.includes("generation_failed")) {
    return "postprocess_error";
  }
  return "unknown_error";
}

function detectSoftFailure(answerResult) {
  const issues = Array.isArray(answerResult?.validation?.issues) ? answerResult.validation.issues : [];
  if (answerResult?.errorType) {
    return {
      errorType: answerResult.errorType,
      errorMessage: answerResult.errorMessage || issues.join(", "),
    };
  }
  if (issues.includes("generation_failed") || issues.includes("answer_missing")) {
    return {
      errorType: "response_parse_error",
      errorMessage: answerResult?.errorMessage || issues.join(", "),
    };
  }
  if (issues.includes("evidence_degraded")) {
    return {
      errorType: "postprocess_error",
      errorMessage: issues.join(", "),
    };
  }
  return null;
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
    disableMemoryUpdate: true,
    ignoreMemoryErrors: true,
    ollamaOptions: {
      num_predict: config.maxTokens,
      num_ctx: config.contextWindow,
    },
  });
  return detached;
}

function buildBaseResult(config, question, startedAt, finishedAt, detached) {
  const ragResult = detached?.lastRagResult || {};
  const retrieved = pickRetrievedChunks(ragResult);
  return {
    configName: config.name,
    questionId: question.id,
    questionText: question.text,
    answerText: "",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    sources: [],
    errorType: null,
    errorMessage: null,
    warningMessage: detached?.lastTestWarning?.message || null,
    rawResponsePreview: "",
    retrievedChunksPreview: retrieved.retrievedChunksPreview,
    retrievedChunkCount: retrieved.retrievedChunkCount,
    error: null,
  };
}

class LlmConfigTestRunner {
  async runSingle(sourceAgent, config, question) {
    const startedAt = new Date();
    const detached = createDetachedAgent(sourceAgent, config);
    try {
      const response = await detached.send(question.text);
      const finishedAt = new Date();
      const answerResult = pickAnswerResult(response, detached);
      const softFailure = detectSoftFailure(answerResult);
      const result = buildBaseResult(config, question, startedAt, finishedAt, detached);
      result.answerText =
        typeof response?.answer === "string" && response.answer.trim()
          ? response.answer
          : typeof answerResult?.answer === "string"
            ? answerResult.answer
            : "";
      result.sources = normalizeSources(answerResult);
      result.rawResponsePreview = previewText(
        answerResult?.rawResponsePreview || answerResult?.rawResponseText || response?.rawResponsePreview || "",
        500,
      );
      if (softFailure) {
        result.errorType = softFailure.errorType;
        result.errorMessage = softFailure.errorMessage || "Soft failure in answer post-processing.";
        result.error = result.errorMessage;
      }
      return result;
    } catch (error) {
      const finishedAt = new Date();
      const answerResult = pickAnswerResult(null, detached);
      const result = buildBaseResult(config, question, startedAt, finishedAt, detached);
      result.answerText =
        typeof answerResult?.answer === "string" && answerResult.answer.trim()
          ? answerResult.answer
          : "";
      result.sources = normalizeSources(answerResult);
      result.errorType = classifyError(error, answerResult);
      result.errorMessage = normalizeRunError(error);
      result.error = result.errorMessage;
      result.rawResponsePreview = previewText(
        error?.rawResponsePreview || answerResult?.rawResponsePreview || answerResult?.rawResponseText || "",
        500,
      );
      if (result.errorType === "memory_error" && result.answerText) {
        result.warningMessage = result.errorMessage;
        result.errorType = null;
        result.errorMessage = null;
        result.error = null;
      }
      return result;
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
