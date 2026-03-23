import { Agent } from "../agent.js";
import {
  getRagModeConfig,
  hasQuotes,
  hasSources,
  isConsistentEnough,
  isWeakContext,
} from "../rag.js";
import { RAG_TEST_MODES, TEST_QUESTIONS } from "./constants.js";

function pickRagOverrides(ragConfig = {}) {
  return {
    indexUrl: ragConfig.indexUrl,
    embeddingApiUrl: ragConfig.embeddingApiUrl,
    embeddingModel: ragConfig.embeddingModel,
    minSimilarity: ragConfig.minSimilarity,
    rewriteApiMode: ragConfig.rewriteApiMode,
    rewriteBaseUrl: ragConfig.rewriteBaseUrl,
    rewriteModel: ragConfig.rewriteModel,
    rewriteTemperature: ragConfig.rewriteTemperature,
  };
}

function normalizeError(error) {
  if (!error) return "Неизвестная ошибка.";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return String(error);
}

function formatPreview(text, maxLength = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function createDetachedAgent(sourceAgent, mode) {
  const detached = new Agent({
    apiMode: sourceAgent.apiMode,
    baseUrl: sourceAgent.baseUrl,
    apiKey: sourceAgent.apiKey,
    model: sourceAgent.model,
    temperature: sourceAgent.temperature,
  });
  detached.loadState(sourceAgent.persistState());
  detached.onStateChanged = null;
  detached.setConfig(sourceAgent);
  detached.setRagConfig({
    ...getRagModeConfig(mode, pickRagOverrides(sourceAgent.ragConfig)),
    enabled: true,
  });
  return detached;
}

class RagBatchRunner {
  async runAgentForQuestion(sourceAgent, questionCase, mode) {
    const questionText = String(questionCase?.question || "").trim();
    if (!questionText) throw new Error("Пустой batch-вопрос.");
    const detached = createDetachedAgent(sourceAgent, mode);
    const response = await detached.send(questionText);
    const rag = detached.lastRagResult || {};
    const chunks = Array.isArray(rag.chunks) ? rag.chunks : [];
    const candidatesBeforeFilter = Array.isArray(rag.candidatesBeforeFilter)
      ? rag.candidatesBeforeFilter
      : [];
    const configUsed = rag.configUsed && typeof rag.configUsed === "object" ? rag.configUsed : {};
    const answerResult = response?.answerResult && typeof response.answerResult === "object" ? response.answerResult : null;
    const diagnostics = rag.diagnostics && typeof rag.diagnostics === "object" ? rag.diagnostics : {};
    return {
      questionId: questionCase.id,
      question: questionText,
      expectedFocus: typeof questionCase.expectedFocus === "string" ? questionCase.expectedFocus : "",
      notes: typeof questionCase.notes === "string" ? questionCase.notes : "",
      mode,
      answerText: typeof response?.answer === "string" ? response.answer : "",
      answerResult,
      retrievalQuery: typeof rag.retrievalQuery === "string" ? rag.retrievalQuery : "",
      rewriteApplied: Boolean(rag.rewriteApplied),
      candidatesBeforeFilterCount: candidatesBeforeFilter.length,
      finalChunksCount: chunks.length,
      maxSimilarity: Number.isFinite(diagnostics.maxSimilarity) ? diagnostics.maxSimilarity : null,
      averageSimilarity: Number.isFinite(diagnostics.averageSimilarity) ? diagnostics.averageSimilarity : null,
      needsClarification: Boolean(answerResult?.needsClarification),
      weakContext: isWeakContext(answerResult),
      sourcesPresent: hasSources(answerResult),
      quotesPresent: hasQuotes(answerResult),
      evidenceConsistent: isConsistentEnough(answerResult, chunks),
      topChunkIds: chunks.map((chunk) => chunk.chunk_id).filter(Boolean),
      topSimilarities: chunks.map((chunk) => chunk.similarity).filter(Number.isFinite),
      minSimilarity: Number.isFinite(configUsed.minSimilarity) ? configUsed.minSimilarity : null,
      topKBefore: Number.isFinite(configUsed.topKBefore) ? configUsed.topKBefore : null,
      topKAfter: Number.isFinite(configUsed.topKAfter) ? configUsed.topKAfter : null,
      chunks: chunks.map((chunk) => ({ chunk_id: chunk.chunk_id || null, source: chunk.source || "unknown", section: chunk.section || "unknown", similarity: Number.isFinite(chunk.similarity) ? chunk.similarity : null, preview: formatPreview(chunk.text) })),
      contextText: typeof rag.contextText === "string" ? rag.contextText : "",
      debug: rag.debug || null,
      error: null,
    };
  }

  async runBatch(sourceAgent, options = {}) {
    if (!sourceAgent) throw new Error("Agent не передан для batch-прогона.");
    const questions = Array.isArray(options.questions) && options.questions.length > 0 ? options.questions : TEST_QUESTIONS;
    const modes = Array.isArray(options.modes) && options.modes.length > 0 ? options.modes : RAG_TEST_MODES;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const results = [];
    let completedRuns = 0;
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
        const questionCase = questions[questionIndex];
        const mode = modes[modeIndex];
        onProgress?.({ questionIndex, questionCount: questions.length, modeIndex, modeCount: modes.length, completedRuns, totalRuns: questions.length * modes.length, questionCase, mode, phase: "running" });
        try {
          results.push(await this.runAgentForQuestion(sourceAgent, questionCase, mode));
        } catch (error) {
          results.push({
            questionId: questionCase.id,
            question: questionCase.question,
            expectedFocus: typeof questionCase.expectedFocus === "string" ? questionCase.expectedFocus : "",
            notes: typeof questionCase.notes === "string" ? questionCase.notes : "",
            mode,
            answerText: "",
            answerResult: null,
            retrievalQuery: "",
            rewriteApplied: false,
            candidatesBeforeFilterCount: 0,
            finalChunksCount: 0,
            maxSimilarity: null,
            averageSimilarity: null,
            needsClarification: false,
            weakContext: false,
            sourcesPresent: false,
            quotesPresent: false,
            evidenceConsistent: false,
            topChunkIds: [],
            topSimilarities: [],
            minSimilarity: null,
            topKBefore: null,
            topKAfter: null,
            chunks: [],
            contextText: "",
            debug: null,
            error: normalizeError(error),
          });
        }
        completedRuns += 1;
        onProgress?.({ questionIndex, questionCount: questions.length, modeIndex, modeCount: modes.length, completedRuns, totalRuns: questions.length * modes.length, questionCase, mode, phase: "completed" });
      }
    }
    return results;
  }
}

export { RagBatchRunner, normalizeError };
