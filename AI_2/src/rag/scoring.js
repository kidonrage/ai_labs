import {
  DEFAULT_EMBEDDING_API_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_K,
  DEFAULT_TOP_K_AFTER,
} from "./constants.js";
import {
  normalizeChunkRecord,
  normalizeFiniteNumber,
  normalizePositiveInt,
} from "./shared.js";

async function getQuestionEmbedding(
  question,
  { embeddingApiUrl = DEFAULT_EMBEDDING_API_URL, embeddingModel = DEFAULT_EMBEDDING_MODEL } = {},
) {
  const response = await fetch(embeddingApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embeddingModel, input: String(question || "") }),
  });
  if (!response.ok) {
    throw new Error(
      `Не удалось получить embedding вопроса: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();
  const embedding = Array.isArray(data.embeddings) ? data.embeddings[0] : data.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding API вернул невалидный ответ.");
  }
  return embedding;
}

function cosineSimilarity(a, b) {
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
  if (normA === 0 || normB === 0) return -1;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function findTopChunks(questionEmbedding, chunks, topK = DEFAULT_TOP_K) {
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

function filterChunksBySimilarity(
  chunks,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  topKAfter = DEFAULT_TOP_K_AFTER,
) {
  const candidates = Array.isArray(chunks) ? chunks.map(normalizeChunkRecord) : [];
  const kept = candidates
    .filter((chunk) => chunk.similarity >= normalizeFiniteNumber(minSimilarity, DEFAULT_MIN_SIMILARITY))
    .slice(0, normalizePositiveInt(topKAfter, DEFAULT_TOP_K_AFTER));
  if (kept.length > 0) return kept;
  return candidates.length === 0 ? [] : [candidates[0]];
}

export { cosineSimilarity, filterChunksBySimilarity, findTopChunks, getQuestionEmbedding };
