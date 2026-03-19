import {
  API_MODES,
  endpointForApiMode,
  isOllamaFamilyMode,
  normalizeApiMode,
  requiresAuthorization,
} from "./api-profiles.js";

const DEFAULT_INDEX_URL = "./static/index_structured.json";
const DEFAULT_EMBEDDING_API_URL = "http://localhost:11434/api/embed";
const DEFAULT_EMBEDDING_MODEL = "embeddinggemma";
const DEFAULT_REWRITE_API_MODE = API_MODES.OLLAMA_CHAT;
const DEFAULT_REWRITE_BASE_URL = "http://localhost:11434";
const DEFAULT_REWRITE_MODEL = "gemma3";
const DEFAULT_REWRITE_TEMPERATURE = 0;
const DEFAULT_MIN_SIMILARITY = 0.45;
const DEFAULT_TOP_K = 3;
const DEFAULT_TOP_K_BEFORE = 8;
const DEFAULT_TOP_K_AFTER = 3;
const DEFAULT_MODE = "baseline";

let cachedIndexUrl = null;
let cachedIndexData = null;

function normalizePositiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeChunkRecord(chunk) {
  return {
    chunk_id: chunk && chunk.chunk_id != null ? chunk.chunk_id : null,
    source:
      chunk && typeof chunk.source === "string" && chunk.source.trim()
        ? chunk.source
        : "unknown",
    section:
      chunk && typeof chunk.section === "string" && chunk.section.trim()
        ? chunk.section
        : "unknown",
    text: chunk && typeof chunk.text === "string" ? chunk.text : "",
    similarity:
      chunk && Number.isFinite(chunk.similarity) ? chunk.similarity : -1,
  };
}

function buildRewritePrompt(question) {
  return [
    "Ты переписываешь пользовательский вопрос в короткий поисковый запрос для retrieval в RAG.",
    "Правила:",
    "- Не отвечай на вопрос.",
    "- Сохрани ключевые сущности, имена, названия и технические термины.",
    "- Убери лишнюю разговорную формулировку.",
    "- Верни только одну строку поискового запроса без пояснений.",
    "",
    `Исходный вопрос: ${String(question || "").trim()}`,
    "Поисковый запрос:",
  ].join("\n");
}

function extractRewriteText(dto, apiMode) {
  if (!dto || typeof dto !== "object") return "";

  if (isOllamaFamilyMode(apiMode)) {
    return String(dto.message && dto.message.content ? dto.message.content : "").trim();
  }

  if (typeof dto.output_text === "string" && dto.output_text.trim()) {
    return dto.output_text.trim();
  }

  if (Array.isArray(dto.output)) {
    for (const item of dto.output) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (
            part &&
            typeof part === "object" &&
            typeof part.text === "string" &&
            part.text.trim()
          ) {
            return part.text.trim();
          }
        }
      }
    }
  }

  return "";
}

function sanitizeRewriteResult(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || "";
}

function getRagModePreset(mode) {
  const normalizedMode =
    typeof mode === "string" && mode.trim() ? mode.trim() : DEFAULT_MODE;

  const presets = {
    baseline: {
      mode: "baseline",
      rewriteEnabled: false,
      filteringEnabled: false,
      topK: 3,
      topKBefore: 3,
      topKAfter: 3,
      minSimilarity: DEFAULT_MIN_SIMILARITY,
    },
    rewrite_only: {
      mode: "rewrite_only",
      rewriteEnabled: true,
      filteringEnabled: false,
      topK: 3,
      topKBefore: 3,
      topKAfter: 3,
      minSimilarity: DEFAULT_MIN_SIMILARITY,
    },
    filter_only: {
      mode: "filter_only",
      rewriteEnabled: false,
      filteringEnabled: true,
      topK: 3,
      topKBefore: 8,
      topKAfter: 3,
      minSimilarity: DEFAULT_MIN_SIMILARITY,
    },
    rewrite_and_filter: {
      mode: "rewrite_and_filter",
      rewriteEnabled: true,
      filteringEnabled: true,
      topK: 3,
      topKBefore: 8,
      topKAfter: 3,
      minSimilarity: DEFAULT_MIN_SIMILARITY,
    },
  };

  return presets[normalizedMode] || presets.baseline;
}

function buildRetrievalConfig(config = {}) {
  const modeConfig = getRagModePreset(config.mode || DEFAULT_MODE);
  const merged = {
    ...modeConfig,
    ...config,
  };
  const filteringEnabled =
    typeof merged.filteringEnabled === "boolean"
      ? merged.filteringEnabled
      : Boolean(merged.enableFiltering);
  const rewriteEnabled =
    typeof merged.rewriteEnabled === "boolean"
      ? merged.rewriteEnabled
      : Boolean(merged.enableRewrite);
  const topK = normalizePositiveInt(merged.topK, DEFAULT_TOP_K);
  const topKBefore = normalizePositiveInt(
    merged.topKBefore,
    filteringEnabled ? DEFAULT_TOP_K_BEFORE : topK,
  );
  const topKAfter = normalizePositiveInt(merged.topKAfter, topK);

  return {
    ...merged,
    mode: typeof merged.mode === "string" && merged.mode.trim() ? merged.mode : DEFAULT_MODE,
    rewriteEnabled,
    filteringEnabled,
    topK,
    topKBefore,
    topKAfter,
    minSimilarity: normalizeFiniteNumber(merged.minSimilarity, DEFAULT_MIN_SIMILARITY),
    postProcessingStages: Array.isArray(merged.postProcessingStages)
      ? merged.postProcessingStages.filter((stage) => typeof stage === "function")
      : [],
  };
}

/**
 * Loads the chunk index JSON once from the static directory.
 */
export async function loadRagIndex(indexUrl = DEFAULT_INDEX_URL) {
  if (cachedIndexUrl === indexUrl && Array.isArray(cachedIndexData)) {
    return cachedIndexData;
  }

  const response = await fetch(indexUrl);
  if (!response.ok) {
    throw new Error(
      `Не удалось загрузить индекс RAG: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Индекс RAG имеет неверный формат: ожидался массив.");
  }

  cachedIndexUrl = indexUrl;
  cachedIndexData = data;
  return data;
}

/**
 * Requests an embedding for the user's question from local Ollama.
 */
export async function getQuestionEmbedding(
  question,
  {
    embeddingApiUrl = DEFAULT_EMBEDDING_API_URL,
    embeddingModel = DEFAULT_EMBEDDING_MODEL,
  } = {},
) {
  const response = await fetch(embeddingApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: String(question || ""),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Не удалось получить embedding вопроса: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const embedding = Array.isArray(data.embeddings)
    ? data.embeddings[0]
    : data.embedding;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding API вернул невалидный ответ.");
  }

  return embedding;
}

/**
 * Computes cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return -1;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return -1;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Scores chunks and returns top-k most relevant items sorted by similarity.
 */
export function findTopChunks(questionEmbedding, chunks, topK = DEFAULT_TOP_K) {
  return (Array.isArray(chunks) ? chunks : [])
    .filter((chunk) => Array.isArray(chunk.embedding))
    .map((chunk) => ({
      chunk_id: chunk.chunk_id,
      source: chunk.source || "unknown",
      section: chunk.section || "unknown",
      text: chunk.text || "",
      similarity: cosineSimilarity(questionEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Builds a compact text context from retrieved chunks for the final prompt.
 */
export function buildRagContext(chunks) {
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk, index) =>
      [
        `[Chunk ${index + 1}]`,
        `Source: ${chunk.source || "unknown"}`,
        `Section: ${chunk.section || "unknown"}`,
        "Text:",
        chunk.text || "",
      ].join("\n"),
    )
    .join("\n\n");
}

/**
 * Rewrites a conversational user question into a short retrieval query.
 */
export async function rewriteQuery(question, options = {}) {
  const originalQuestion = String(question || "").trim();
  if (!originalQuestion) {
    return "";
  }

  const apiMode = normalizeApiMode(options.rewriteApiMode || options.apiMode || DEFAULT_REWRITE_API_MODE);
  const baseUrl = endpointForApiMode(
    apiMode,
    options.rewriteBaseUrl || options.baseUrl || DEFAULT_REWRITE_BASE_URL,
  );
  const model =
    typeof options.rewriteModel === "string" && options.rewriteModel.trim()
      ? options.rewriteModel.trim()
      : typeof options.model === "string" && options.model.trim()
        ? options.model.trim()
        : DEFAULT_REWRITE_MODEL;
  const temperature = normalizeFiniteNumber(
    options.rewriteTemperature,
    DEFAULT_REWRITE_TEMPERATURE,
  );
  const prompt = buildRewritePrompt(originalQuestion);
  const headers = {
    "Content-Type": "application/json",
  };

  if (requiresAuthorization(apiMode)) {
    const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
    if (!apiKey) {
      return originalQuestion;
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const body = isOllamaFamilyMode(apiMode)
      ? {
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: {
            temperature,
          },
        }
      : {
          model,
          input: prompt,
          temperature,
        };

    if (apiMode === API_MODES.OLLAMA_TOOLS_CHAT) {
      body.think = false;
    }

    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return originalQuestion;
    }

    const data = await response.json();
    const sanitized = sanitizeRewriteResult(extractRewriteText(data, apiMode));
    return sanitized || originalQuestion;
  } catch {
    return originalQuestion;
  }
}

/**
 * Filters sorted candidates by similarity threshold and applies a safe fallback.
 */
export function filterChunksBySimilarity(
  chunks,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  topKAfter = DEFAULT_TOP_K_AFTER,
) {
  const candidates = Array.isArray(chunks) ? chunks.map(normalizeChunkRecord) : [];
  const normalizedThreshold = normalizeFiniteNumber(minSimilarity, DEFAULT_MIN_SIMILARITY);
  const normalizedTopKAfter = normalizePositiveInt(topKAfter, DEFAULT_TOP_K_AFTER);

  const kept = candidates
    .filter((chunk) => chunk.similarity >= normalizedThreshold)
    .slice(0, normalizedTopKAfter);

  if (kept.length > 0) {
    return kept;
  }

  if (candidates.length === 0) {
    return [];
  }

  return [candidates[0]];
}

/**
 * Returns the normalized configuration for one of the supported RAG modes.
 */
export function getRagModeConfig(mode, overrides = {}) {
  const preset = getRagModePreset(mode);
  return buildRetrievalConfig({
    ...preset,
    ...overrides,
    mode: preset.mode,
  });
}

/**
 * Runs optional post-processing stages on retrieved candidates.
 */
export async function runRagPostProcessingStages(candidates, stageContext = {}) {
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
    meta.push({
      stage: stageName,
      beforeCount,
      afterCount: current.length,
    });
  }

  return {
    chunks: current,
    meta,
  };
}

/**
 * Runs the whole retrieval pipeline for one question.
 */
export async function retrieveChunks(question, config = {}) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) {
    throw new Error("Пустой вопрос для RAG.");
  }

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
  const candidatesBeforeFilter = findTopChunks(
    embedding,
    index,
    resolvedConfig.topKBefore,
  );
  const postProcessingContext = {
    question: trimmedQuestion,
    retrievalQuery: effectiveRetrievalQuery,
    config: resolvedConfig,
    postProcessingStages: resolvedConfig.postProcessingStages,
  };
  const postProcessed = await runRagPostProcessingStages(
    candidatesBeforeFilter,
    postProcessingContext,
  );

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
    const limit = normalizePositiveInt(
      resolvedConfig.topKAfter,
      resolvedConfig.topK,
    );
    chunks = candidatesAfterPostProcessing.slice(0, limit);
  }

  return {
    originalQuestion: trimmedQuestion,
    retrievalQuery: effectiveRetrievalQuery,
    rewriteApplied,
    candidatesBeforeFilter,
    chunks,
    contextText: buildRagContext(chunks),
    configUsed: {
      mode: resolvedConfig.mode,
      indexUrl,
      embeddingApiUrl: resolvedConfig.embeddingApiUrl || DEFAULT_EMBEDDING_API_URL,
      embeddingModel: resolvedConfig.embeddingModel || DEFAULT_EMBEDDING_MODEL,
      topK: resolvedConfig.topK,
      topKBefore: resolvedConfig.topKBefore,
      topKAfter: resolvedConfig.topKAfter,
      minSimilarity: resolvedConfig.minSimilarity,
      rewriteEnabled: resolvedConfig.rewriteEnabled,
      filteringEnabled: resolvedConfig.filteringEnabled,
    },
    debug: {
      retrievalQuery: effectiveRetrievalQuery,
      candidatesBeforeFilter: candidatesBeforeFilter.map(normalizeChunkRecord),
      candidatesAfterPostProcessing:
        candidatesAfterPostProcessing.map(normalizeChunkRecord),
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

/**
 * Runs the same question through all supported RAG retrieval modes.
 */
export async function compareRagModes(question, baseConfig = {}) {
  const modes = [
    "baseline",
    "rewrite_only",
    "filter_only",
    "rewrite_and_filter",
  ];
  const result = {};

  for (const mode of modes) {
    const config = getRagModeConfig(mode, baseConfig);
    const retrieval = await retrieveChunks(question, config);
    result[mode] = {
      retrievalQuery: retrieval.retrievalQuery,
      topChunkIds: retrieval.chunks.map((chunk) => chunk.chunk_id),
      similarities: retrieval.chunks.map((chunk) => chunk.similarity),
      contextText: retrieval.contextText,
      chunks: retrieval.chunks,
      candidatesBeforeFilter: retrieval.candidatesBeforeFilter,
      debug: retrieval.debug,
    };
  }

  return result;
}
