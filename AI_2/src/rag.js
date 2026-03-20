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
const DEFAULT_ANSWER_MIN_SIMILARITY = 0.05;
const DEFAULT_TOP_K = 3;
const DEFAULT_TOP_K_BEFORE = 8;
const DEFAULT_TOP_K_AFTER = 3;
const DEFAULT_MODE = "baseline";
const SAFE_NO_DATA_ANSWER =
  "Не знаю по имеющемуся контексту. Пожалуйста, уточните вопрос.";
const SAFE_PARSE_FAILURE_ANSWER =
  "Не удалось надежно сформировать ответ по найденному контексту. Пожалуйста, уточните вопрос.";

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

function normalizeNonEmptyString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function extractJsonObjectFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // Best-effort recovery from wrappers around JSON.
  }

  const startCandidates = [raw.indexOf("{"), raw.indexOf("[")].filter((index) => index >= 0);
  if (startCandidates.length === 0) return null;
  const startIndex = Math.min(...startCandidates);

  for (let end = raw.length; end > startIndex; end -= 1) {
    try {
      return JSON.parse(raw.slice(startIndex, end).trim());
    } catch {
      // keep shrinking
    }
  }

  return null;
}

function stripMarkdownCodeFences(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("```")) return raw;
  return raw.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
}

function buildChunkMap(retrievedChunks) {
  return new Map(
    (Array.isArray(retrievedChunks) ? retrievedChunks : [])
      .filter((chunk) => chunk && typeof chunk === "object")
      .map((chunk) => [normalizeNonEmptyString(chunk.chunk_id, ""), chunk]),
  );
}

function makeSourceFromChunk(chunk) {
  return {
    source: normalizeNonEmptyString(chunk && chunk.source, "unknown"),
    section: normalizeNonEmptyString(chunk && chunk.section, "unknown"),
    chunk_id: normalizeNonEmptyString(chunk && chunk.chunk_id, ""),
  };
}

function makeQuoteFromChunk(chunk, maxLength = 180) {
  const text = normalizeNonEmptyString(chunk && chunk.text, "");
  const compact = text.replace(/\s+/g, " ").trim();
  const quote =
    compact.length <= maxLength ? compact : `${compact.slice(0, maxLength).trim()}...`;
  return {
    ...makeSourceFromChunk(chunk),
    quote,
  };
}

function pickEvidenceChunks(retrievedChunks, limit = 2) {
  return (Array.isArray(retrievedChunks) ? retrievedChunks : [])
    .filter((chunk) => chunk && typeof chunk === "object")
    .slice(0, limit);
}

function buildDerivedAnswerResult(answer, retrievedChunks, overrides = {}) {
  const evidenceChunks = pickEvidenceChunks(retrievedChunks, 2);
  return normalizeAnswerResult(
    {
      answer,
      sources: evidenceChunks.map(makeSourceFromChunk),
      quotes: evidenceChunks.map((chunk) => makeQuoteFromChunk(chunk)),
      needsClarification: false,
      weakContext: false,
      ...overrides,
    },
    overrides,
  );
}

export function makeSafeAnswerResult(overrides = {}) {
  return {
    answer: SAFE_NO_DATA_ANSWER,
    sources: [],
    quotes: [],
    needsClarification: true,
    weakContext: true,
    ...overrides,
  };
}

export function normalizeSourceEntry(entry) {
  const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  return {
    source: normalizeNonEmptyString(raw.source, "unknown"),
    section: normalizeNonEmptyString(raw.section, "unknown"),
    chunk_id: normalizeNonEmptyString(raw.chunk_id, ""),
  };
}

export function normalizeQuoteEntry(entry) {
  const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  return {
    source: normalizeNonEmptyString(raw.source, "unknown"),
    section: normalizeNonEmptyString(raw.section, "unknown"),
    chunk_id: normalizeNonEmptyString(raw.chunk_id, ""),
    quote: normalizeNonEmptyString(raw.quote, ""),
  };
}

export function normalizeAnswerResult(result, overrides = {}) {
  const raw = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  return {
    answer: normalizeNonEmptyString(raw.answer, ""),
    sources: Array.isArray(raw.sources) ? raw.sources.map(normalizeSourceEntry) : [],
    quotes: Array.isArray(raw.quotes) ? raw.quotes.map(normalizeQuoteEntry) : [],
    needsClarification: normalizeBoolean(raw.needsClarification, false),
    weakContext: normalizeBoolean(raw.weakContext, false),
    ...overrides,
  };
}

export function buildContextDiagnostics(retrievalResult, config = {}) {
  const chunks = Array.isArray(
    retrievalResult && typeof retrievalResult === "object" ? retrievalResult.chunks : null,
  )
    ? retrievalResult.chunks
    : [];
  const similarities = chunks
    .map((chunk) => chunk.similarity)
    .filter((value) => Number.isFinite(value));

  return {
    finalChunksCount: chunks.length,
    maxSimilarity: similarities.length > 0 ? Math.max(...similarities) : null,
    averageSimilarity:
      similarities.length > 0
        ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length
        : null,
    answerMinSimilarity: normalizeFiniteNumber(
      config.answerMinSimilarity,
      DEFAULT_ANSWER_MIN_SIMILARITY,
    ),
    forceIDontKnowOnWeakContext: normalizeBoolean(
      config.forceIDontKnowOnWeakContext,
      true,
    ),
  };
}

export function evaluateContextStrength(retrievalResult, config = {}) {
  const diagnostics = buildContextDiagnostics(retrievalResult, config);
  const weakContext =
    diagnostics.finalChunksCount === 0 ||
    !Number.isFinite(diagnostics.maxSimilarity) ||
    (diagnostics.answerMinSimilarity > 0 &&
      diagnostics.maxSimilarity < diagnostics.answerMinSimilarity);

  return {
    ...diagnostics,
    weakContext,
  };
}

export function validateAnswerEvidence(answerResult, retrievedChunks) {
  const normalized = normalizeAnswerResult(answerResult);
  const chunks = Array.isArray(retrievedChunks) ? retrievedChunks : [];
  const chunkMap = buildChunkMap(chunks);
  const issues = [];

  if (!normalized.answer) {
    issues.push("answer_missing");
  }

  for (const source of normalized.sources) {
    if (!source.chunk_id) {
      issues.push("source_chunk_id_missing");
      continue;
    }
    const chunk = chunkMap.get(source.chunk_id);
    if (!chunk) {
      issues.push(`source_chunk_not_found:${source.chunk_id}`);
      continue;
    }
    if (source.source !== normalizeNonEmptyString(chunk.source, "unknown")) {
      issues.push(`source_mismatch:${source.chunk_id}`);
    }
    if (source.section !== normalizeNonEmptyString(chunk.section, "unknown")) {
      issues.push(`section_mismatch:${source.chunk_id}`);
    }
  }

  for (const quote of normalized.quotes) {
    if (!quote.chunk_id) {
      issues.push("quote_chunk_id_missing");
      continue;
    }
    const chunk = chunkMap.get(quote.chunk_id);
    if (!chunk) {
      issues.push(`quote_chunk_not_found:${quote.chunk_id}`);
      continue;
    }
    if (quote.source !== normalizeNonEmptyString(chunk.source, "unknown")) {
      issues.push(`quote_source_mismatch:${quote.chunk_id}`);
    }
    if (quote.section !== normalizeNonEmptyString(chunk.section, "unknown")) {
      issues.push(`quote_section_mismatch:${quote.chunk_id}`);
    }
    if (!quote.quote) {
      issues.push(`quote_text_missing:${quote.chunk_id}`);
      continue;
    }
    if (!String(chunk.text || "").includes(quote.quote)) {
      issues.push(`quote_not_in_chunk:${quote.chunk_id}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    answerResult: normalized,
  };
}

export function repairAnswerEvidence(answerResult, retrievedChunks) {
  const normalized = normalizeAnswerResult(answerResult);
  const chunks = Array.isArray(retrievedChunks) ? retrievedChunks : [];
  const chunkMap = buildChunkMap(chunks);
  const repairedSources = [];
  const repairedQuotes = [];
  const sourceIds = new Set();
  const quoteIds = new Set();

  for (const source of normalized.sources) {
    const chunk = chunkMap.get(source.chunk_id);
    if (!chunk || sourceIds.has(source.chunk_id)) continue;
    repairedSources.push(makeSourceFromChunk(chunk));
    sourceIds.add(source.chunk_id);
  }

  for (const quote of normalized.quotes) {
    const chunk = chunkMap.get(quote.chunk_id);
    if (!chunk || quoteIds.has(quote.chunk_id)) continue;
    let quoteText = normalizeNonEmptyString(quote.quote, "");
    if (!quoteText || !String(chunk.text || "").includes(quoteText)) {
      quoteText = makeQuoteFromChunk(chunk).quote;
    }
    repairedQuotes.push({
      ...makeSourceFromChunk(chunk),
      quote: quoteText,
    });
    quoteIds.add(quote.chunk_id);
  }

  const evidenceChunks = pickEvidenceChunks(chunks, 2);
  const sourceFallbackChunks =
    repairedQuotes.length > 0
      ? repairedQuotes
          .map((item) => chunkMap.get(item.chunk_id))
          .filter(Boolean)
      : evidenceChunks;

  for (const chunk of sourceFallbackChunks) {
    const chunkId = normalizeNonEmptyString(chunk.chunk_id, "");
    if (!chunkId || sourceIds.has(chunkId)) continue;
    repairedSources.push(makeSourceFromChunk(chunk));
    sourceIds.add(chunkId);
  }

  const quoteFallbackChunks =
    repairedSources.length > 0
      ? repairedSources
          .map((item) => chunkMap.get(item.chunk_id))
          .filter(Boolean)
      : evidenceChunks;

  for (const chunk of quoteFallbackChunks) {
    const chunkId = normalizeNonEmptyString(chunk.chunk_id, "");
    if (!chunkId || quoteIds.has(chunkId)) continue;
    repairedQuotes.push(makeQuoteFromChunk(chunk));
    quoteIds.add(chunkId);
  }

  return normalizeAnswerResult({
    ...normalized,
    sources: repairedSources,
    quotes: repairedQuotes,
  });
}

export function hasSources(answerResult) {
  return Array.isArray(answerResult && answerResult.sources) && answerResult.sources.length > 0;
}

export function hasQuotes(answerResult) {
  return Array.isArray(answerResult && answerResult.quotes) && answerResult.quotes.length > 0;
}

export function isWeakContext(answerResult) {
  return Boolean(answerResult && answerResult.weakContext);
}

export function isConsistentEnough(answerResult, retrievedChunks) {
  return validateAnswerEvidence(answerResult, retrievedChunks).valid;
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
    answerMinSimilarity: normalizeFiniteNumber(
      merged.answerMinSimilarity,
      DEFAULT_ANSWER_MIN_SIMILARITY,
    ),
    forceIDontKnowOnWeakContext: normalizeBoolean(
      merged.forceIDontKnowOnWeakContext,
      true,
    ),
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
        `chunk_id: ${chunk.chunk_id || "unknown"}`,
        `source: ${chunk.source || "unknown"}`,
        `section: ${chunk.section || "unknown"}`,
        "text:",
        chunk.text || "",
      ].join("\n"),
    )
    .join("\n\n");
}

export function buildCitedAnswerPrompt(question, contextText, options = {}) {
  const clarificationAnswer = normalizeNonEmptyString(
    options.safeNoDataAnswer,
    SAFE_NO_DATA_ANSWER,
  );

  return [
    "Ответь на вопрос ТОЛЬКО по переданному RAG-контексту.",
    "Не используй внешние знания и не придумывай факты.",
    "Нужен обычный короткий ответ на русском, без markdown и без JSON.",
    "Если ответа нет в контексте, верни ровно эту фразу:",
    clarificationAnswer,
    "Не перечисляй источники и не вставляй цитаты в ответ. Это сделает код после генерации.",
    "",
    `Вопрос: ${String(question || "").trim()}`,
    "",
    "RAG-контекст:",
    String(contextText || "").trim(),
    "",
    "JSON:",
  ].join("\n");
}

export async function generateAnswerWithSourcesAndQuotes(
  question,
  retrievalResult,
  config = {},
) {
  const diagnostics = evaluateContextStrength(retrievalResult, config);
  const chunks = Array.isArray(retrievalResult && retrievalResult.chunks)
    ? retrievalResult.chunks
    : [];

  if (diagnostics.weakContext && diagnostics.forceIDontKnowOnWeakContext) {
    return {
      ...makeSafeAnswerResult(),
      diagnostics,
      validation: {
        valid: true,
        issues: ["weak_context_gate"],
      },
      rawResponseText: "",
    };
  }

  const requestCompletion =
    typeof config.requestCompletion === "function" ? config.requestCompletion : null;
  if (!requestCompletion) {
    throw new Error("Не передан requestCompletion для cited answer generation.");
  }

  const contextText = normalizeNonEmptyString(
    retrievalResult && retrievalResult.contextText,
    buildRagContext(chunks),
  );
  const prompt = buildCitedAnswerPrompt(question, contextText, config);
  let rawResponseText = "";

  try {
    rawResponseText = await requestCompletion(prompt);
    const sanitizedText = stripMarkdownCodeFences(rawResponseText);
    const parsed = extractJsonObjectFromText(sanitizedText);
    const normalized = parsed
      ? normalizeAnswerResult(parsed, {
          weakContext: false,
        })
      : buildDerivedAnswerResult(sanitizedText, chunks, {
          needsClarification: false,
          weakContext: false,
        });
    const repaired = repairAnswerEvidence(normalized, chunks);
    const validation = validateAnswerEvidence(repaired, chunks);
    if (!validation.valid) {
      const fallbackFromText = buildDerivedAnswerResult(
        normalizeNonEmptyString(sanitizedText, SAFE_PARSE_FAILURE_ANSWER),
        chunks,
        {
          needsClarification: false,
          weakContext: false,
        },
      );
      const fallbackValidation = validateAnswerEvidence(fallbackFromText, chunks);
      if (fallbackValidation.valid) {
        return {
          ...fallbackValidation.answerResult,
          weakContext: false,
          diagnostics,
          validation: fallbackValidation,
          rawResponseText,
        };
      }
      return {
        ...makeSafeAnswerResult({
          answer: SAFE_PARSE_FAILURE_ANSWER,
        }),
        diagnostics,
        validation,
        rawResponseText,
      };
    }

    return {
      ...repaired,
      weakContext: false,
      diagnostics,
      validation,
      rawResponseText,
    };
  } catch {
    return {
      ...makeSafeAnswerResult({
        answer: SAFE_PARSE_FAILURE_ANSWER,
      }),
      diagnostics,
      validation: {
        valid: false,
        issues: ["generation_failed"],
      },
      rawResponseText,
    };
  }
}

export function buildAnswerResultFromResponse(answerText, retrievalResult, config = {}) {
  const diagnostics = evaluateContextStrength(retrievalResult, config);
  const chunks = Array.isArray(retrievalResult && retrievalResult.chunks)
    ? retrievalResult.chunks
    : [];
  const normalizedAnswer = normalizeNonEmptyString(answerText, SAFE_PARSE_FAILURE_ANSWER);
  const safeNoDataAnswer = normalizeNonEmptyString(
    config.safeNoDataAnswer,
    SAFE_NO_DATA_ANSWER,
  );
  const needsClarification =
    diagnostics.finalChunksCount === 0 ||
    normalizedAnswer === safeNoDataAnswer ||
    normalizedAnswer === SAFE_PARSE_FAILURE_ANSWER;

  if (diagnostics.finalChunksCount === 0) {
    return {
      ...makeSafeAnswerResult({
        answer: safeNoDataAnswer,
      }),
      diagnostics,
      validation: {
        valid: true,
        issues: ["no_chunks"],
      },
    };
  }

  const result = buildDerivedAnswerResult(normalizedAnswer, chunks, {
    needsClarification,
    weakContext: false,
  });
  const validation = validateAnswerEvidence(result, chunks);

  return {
    ...result,
    diagnostics,
    validation,
  };
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
      diagnostics: retrieval.diagnostics,
      debug: retrieval.debug,
    };
  }

  return result;
}
