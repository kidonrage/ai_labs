const DEFAULT_INDEX_URL = "./static/index_structured.json";
const DEFAULT_EMBEDDING_API_URL = "http://localhost:11434/api/embed";
const DEFAULT_EMBEDDING_MODEL = "embeddinggemma";

let cachedIndexUrl = null;
let cachedIndexData = null;

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
export function findTopChunks(questionEmbedding, chunks, topK = 3) {
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
 * Runs the whole retrieval pipeline for one question.
 */
export async function retrieveChunks(question, config = {}) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) {
    throw new Error("Пустой вопрос для RAG.");
  }

  const indexUrl = config.indexUrl || DEFAULT_INDEX_URL;
  const topK = Number.isInteger(config.topK) && config.topK > 0 ? config.topK : 3;
  const index = await loadRagIndex(indexUrl);
  const embedding = await getQuestionEmbedding(trimmedQuestion, config);
  const chunks = findTopChunks(embedding, index, topK);

  return {
    chunks,
    contextText: buildRagContext(chunks),
  };
}
