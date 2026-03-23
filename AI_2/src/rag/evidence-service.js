import {
  DEFAULT_ANSWER_MIN_SIMILARITY,
  SAFE_NO_DATA_ANSWER,
} from "./constants.js";
import {
  normalizeBoolean,
  normalizeFiniteNumber,
  normalizeNonEmptyString,
} from "./shared.js";

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
  const compact = normalizeNonEmptyString(chunk && chunk.text, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ...makeSourceFromChunk(chunk),
    quote:
      compact.length <= maxLength ? compact : `${compact.slice(0, maxLength).trim()}...`,
  };
}

function pickEvidenceChunks(retrievedChunks, limit = 2) {
  return (Array.isArray(retrievedChunks) ? retrievedChunks : [])
    .filter((chunk) => chunk && typeof chunk === "object")
    .slice(0, limit);
}

function normalizeSourceEntry(entry) {
  const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  return {
    source: normalizeNonEmptyString(raw.source, "unknown"),
    section: normalizeNonEmptyString(raw.section, "unknown"),
    chunk_id: normalizeNonEmptyString(raw.chunk_id, ""),
  };
}

function normalizeQuoteEntry(entry) {
  const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  return {
    source: normalizeNonEmptyString(raw.source, "unknown"),
    section: normalizeNonEmptyString(raw.section, "unknown"),
    chunk_id: normalizeNonEmptyString(raw.chunk_id, ""),
    quote: normalizeNonEmptyString(raw.quote, ""),
  };
}

function normalizeAnswerResult(result, overrides = {}) {
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

function makeSafeAnswerResult(overrides = {}) {
  return {
    answer: SAFE_NO_DATA_ANSWER,
    sources: [],
    quotes: [],
    needsClarification: true,
    weakContext: true,
    ...overrides,
  };
}

function buildContextDiagnostics(retrievalResult, config = {}) {
  const chunks = Array.isArray(retrievalResult && retrievalResult.chunks)
    ? retrievalResult.chunks
    : [];
  const similarities = chunks.map((chunk) => chunk.similarity).filter(Number.isFinite);
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
    forceIDontKnowOnWeakContext: normalizeBoolean(config.forceIDontKnowOnWeakContext, true),
  };
}

function evaluateContextStrength(retrievalResult, config = {}) {
  const diagnostics = buildContextDiagnostics(retrievalResult, config);
  return {
    ...diagnostics,
    weakContext:
      diagnostics.finalChunksCount === 0 ||
      !Number.isFinite(diagnostics.maxSimilarity) ||
      (diagnostics.answerMinSimilarity > 0 &&
        diagnostics.maxSimilarity < diagnostics.answerMinSimilarity),
  };
}

function validateAnswerEvidence(answerResult, retrievedChunks) {
  const normalized = normalizeAnswerResult(answerResult);
  const chunkMap = buildChunkMap(retrievedChunks);
  const issues = [];
  if (!normalized.answer) issues.push("answer_missing");

  for (const source of normalized.sources) {
    const chunk = chunkMap.get(source.chunk_id);
    if (!source.chunk_id) issues.push("source_chunk_id_missing");
    else if (!chunk) issues.push(`source_chunk_not_found:${source.chunk_id}`);
    else if (source.source !== normalizeNonEmptyString(chunk.source, "unknown")) {
      issues.push(`source_mismatch:${source.chunk_id}`);
    } else if (source.section !== normalizeNonEmptyString(chunk.section, "unknown")) {
      issues.push(`section_mismatch:${source.chunk_id}`);
    }
  }

  for (const quote of normalized.quotes) {
    const chunk = chunkMap.get(quote.chunk_id);
    if (!quote.chunk_id) issues.push("quote_chunk_id_missing");
    else if (!chunk) issues.push(`quote_chunk_not_found:${quote.chunk_id}`);
    else if (quote.source !== normalizeNonEmptyString(chunk.source, "unknown")) {
      issues.push(`quote_source_mismatch:${quote.chunk_id}`);
    } else if (quote.section !== normalizeNonEmptyString(chunk.section, "unknown")) {
      issues.push(`quote_section_mismatch:${quote.chunk_id}`);
    } else if (!quote.quote) {
      issues.push(`quote_text_missing:${quote.chunk_id}`);
    } else if (!String(chunk.text || "").includes(quote.quote)) {
      issues.push(`quote_not_in_chunk:${quote.chunk_id}`);
    }
  }

  return { valid: issues.length === 0, issues, answerResult: normalized };
}

function repairAnswerEvidence(answerResult, retrievedChunks) {
  const normalized = normalizeAnswerResult(answerResult);
  const chunks = Array.isArray(retrievedChunks) ? retrievedChunks : [];
  const chunkMap = buildChunkMap(chunks);
  const repairedSources = [];
  const repairedQuotes = [];
  const sourceIds = new Set();
  const quoteIds = new Set();
  for (const source of normalized.sources) {
    const chunk = chunkMap.get(source.chunk_id);
    if (chunk && !sourceIds.has(source.chunk_id)) {
      repairedSources.push(makeSourceFromChunk(chunk));
      sourceIds.add(source.chunk_id);
    }
  }
  for (const quote of normalized.quotes) {
    const chunk = chunkMap.get(quote.chunk_id);
    if (!chunk || quoteIds.has(quote.chunk_id)) continue;
    repairedQuotes.push({
      ...makeSourceFromChunk(chunk),
      quote:
        normalizeNonEmptyString(quote.quote, "") && String(chunk.text || "").includes(quote.quote)
          ? quote.quote
          : makeQuoteFromChunk(chunk).quote,
    });
    quoteIds.add(quote.chunk_id);
  }
  const evidenceChunks = pickEvidenceChunks(chunks, 2);
  for (const chunk of repairedQuotes.length > 0
    ? repairedQuotes.map((item) => chunkMap.get(item.chunk_id)).filter(Boolean)
    : evidenceChunks) {
    const chunkId = normalizeNonEmptyString(chunk.chunk_id, "");
    if (chunkId && !sourceIds.has(chunkId)) {
      repairedSources.push(makeSourceFromChunk(chunk));
      sourceIds.add(chunkId);
    }
  }
  for (const chunk of repairedSources.length > 0
    ? repairedSources.map((item) => chunkMap.get(item.chunk_id)).filter(Boolean)
    : evidenceChunks) {
    const chunkId = normalizeNonEmptyString(chunk.chunk_id, "");
    if (chunkId && !quoteIds.has(chunkId)) {
      repairedQuotes.push(makeQuoteFromChunk(chunk));
      quoteIds.add(chunkId);
    }
  }
  return normalizeAnswerResult({ ...normalized, sources: repairedSources, quotes: repairedQuotes });
}

function buildDerivedAnswerResult(answer, retrievedChunks, overrides = {}) {
  const evidenceChunks = pickEvidenceChunks(retrievedChunks, 2);
  return normalizeAnswerResult({
    answer,
    sources: evidenceChunks.map(makeSourceFromChunk),
    quotes: evidenceChunks.map((chunk) => makeQuoteFromChunk(chunk)),
    needsClarification: false,
    weakContext: false,
    ...overrides,
  });
}

const hasSources = (answerResult) =>
  Array.isArray(answerResult && answerResult.sources) && answerResult.sources.length > 0;
const hasQuotes = (answerResult) =>
  Array.isArray(answerResult && answerResult.quotes) && answerResult.quotes.length > 0;
const isWeakContext = (answerResult) => Boolean(answerResult && answerResult.weakContext);
const isConsistentEnough = (answerResult, retrievedChunks) =>
  validateAnswerEvidence(answerResult, retrievedChunks).valid;

export {
  buildContextDiagnostics,
  buildDerivedAnswerResult,
  evaluateContextStrength,
  hasQuotes,
  hasSources,
  isConsistentEnough,
  isWeakContext,
  makeSafeAnswerResult,
  normalizeAnswerResult,
  normalizeQuoteEntry,
  normalizeSourceEntry,
  repairAnswerEvidence,
  validateAnswerEvidence,
};
