import {
  DEFAULT_ANSWER_MIN_SIMILARITY,
  DEFAULT_EMBEDDING_API_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_INDEX_URL,
} from "./constants.js";
import { buildRetrievalConfig } from "./config.js";
import { loadRagIndex } from "./index-repository.js";
import { buildContextDiagnostics } from "./evidence-service.js";
import { buildRagContext } from "./prompt-builder.js";
import { normalizeBoolean, normalizeChunkRecord, normalizeFiniteNumber, normalizePositiveInt } from "./shared.js";
import { filterChunksBySimilarity, findTopChunks, getQuestionEmbedding } from "./scoring.js";
import { rewriteQuery } from "./rewrite-service.js";

async function runRagPostProcessingStages(candidates, stageContext = {}) {
  let current = Array.isArray(candidates) ? candidates.slice() : [];
  const meta = [];
  const stages = Array.isArray(stageContext.postProcessingStages)
    ? stageContext.postProcessingStages
    : [];
  for (const stage of stages) {
    const stageName =
      typeof stage.stageName === "string" && stage.stageName.trim()
        ? stage.stageName.trim()
        : "custom_post_processing";
    const beforeCount = current.length;
    const next = await stage(current, stageContext);
    current = Array.isArray(next) ? next : current;
    meta.push({ stage: stageName, beforeCount, afterCount: current.length });
  }
  return { chunks: current, meta };
}

async function retrieveChunks(question, config = {}) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) throw new Error("Пустой вопрос для RAG.");
  const resolvedConfig = buildRetrievalConfig(config);
  const indexUrl = resolvedConfig.indexUrl || DEFAULT_INDEX_URL;
  const retrievalQuery = resolvedConfig.rewriteEnabled
    ? await rewriteQuery(trimmedQuestion, resolvedConfig)
    : trimmedQuestion;
  const effectiveRetrievalQuery =
    typeof retrievalQuery === "string" && retrievalQuery.trim()
      ? retrievalQuery.trim()
      : trimmedQuestion;
  const rewriteApplied =
    resolvedConfig.rewriteEnabled && effectiveRetrievalQuery !== trimmedQuestion;
  const index = await loadRagIndex(indexUrl);
  const embedding = await getQuestionEmbedding(effectiveRetrievalQuery, resolvedConfig);
  const candidatesBeforeFilter = findTopChunks(embedding, index, resolvedConfig.topKBefore);
  const postProcessed = await runRagPostProcessingStages(candidatesBeforeFilter, {
    question: trimmedQuestion,
    retrievalQuery: effectiveRetrievalQuery,
    config: resolvedConfig,
    postProcessingStages: resolvedConfig.postProcessingStages,
  });
  const candidatesAfterPostProcessing = Array.isArray(postProcessed.chunks)
    ? postProcessed.chunks
    : candidatesBeforeFilter.slice();
  const droppedByFiltering = [];
  let chunks = [];
  if (resolvedConfig.filteringEnabled) {
    chunks = filterChunksBySimilarity(
      candidatesAfterPostProcessing,
      resolvedConfig.minSimilarity,
      resolvedConfig.topKAfter,
    );
    const selectedIds = new Set(chunks.map((chunk) => chunk.chunk_id));
    for (const candidate of candidatesAfterPostProcessing) {
      if (!selectedIds.has(candidate.chunk_id)) {
        droppedByFiltering.push(normalizeChunkRecord(candidate));
      }
    }
  } else {
    chunks = candidatesAfterPostProcessing.slice(
      0,
      normalizePositiveInt(resolvedConfig.topKAfter, resolvedConfig.topK),
    );
  }
  return {
    originalQuestion: trimmedQuestion,
    retrievalQuery: effectiveRetrievalQuery,
    rewriteApplied,
    candidatesBeforeFilter,
    chunks,
    contextText: buildRagContext(chunks),
    diagnostics: buildContextDiagnostics({ chunks }, resolvedConfig),
    configUsed: {
      mode: resolvedConfig.mode,
      indexUrl,
      embeddingApiUrl: resolvedConfig.embeddingApiUrl || DEFAULT_EMBEDDING_API_URL,
      embeddingModel: resolvedConfig.embeddingModel || DEFAULT_EMBEDDING_MODEL,
      topK: resolvedConfig.topK,
      topKBefore: resolvedConfig.topKBefore,
      topKAfter: resolvedConfig.topKAfter,
      minSimilarity: resolvedConfig.minSimilarity,
      answerMinSimilarity: normalizeFiniteNumber(
        resolvedConfig.answerMinSimilarity,
        DEFAULT_ANSWER_MIN_SIMILARITY,
      ),
      forceIDontKnowOnWeakContext: normalizeBoolean(
        resolvedConfig.forceIDontKnowOnWeakContext,
        true,
      ),
      rewriteEnabled: resolvedConfig.rewriteEnabled,
      filteringEnabled: resolvedConfig.filteringEnabled,
    },
    debug: {
      retrievalQuery: effectiveRetrievalQuery,
      candidatesBeforeFilter: candidatesBeforeFilter.map(normalizeChunkRecord),
      candidatesAfterPostProcessing: candidatesAfterPostProcessing.map(normalizeChunkRecord),
      droppedByFiltering,
      filteringMeta: {
        enabled: resolvedConfig.filteringEnabled,
        threshold: resolvedConfig.minSimilarity,
        fallbackUsed:
          resolvedConfig.filteringEnabled &&
          chunks.length === 1 &&
          droppedByFiltering.length === candidatesAfterPostProcessing.length - 1 &&
          chunks[0] &&
          candidatesAfterPostProcessing[0] &&
          chunks[0].chunk_id === candidatesAfterPostProcessing[0].chunk_id &&
          chunks[0].similarity < resolvedConfig.minSimilarity,
      },
      postProcessingMeta: postProcessed.meta,
    },
  };
}

export { retrieveChunks, runRagPostProcessingStages };
