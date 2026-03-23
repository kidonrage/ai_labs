function normalizePositiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeNonEmptyString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
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
    similarity: chunk && Number.isFinite(chunk.similarity) ? chunk.similarity : -1,
  };
}

function extractJsonObjectFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const startCandidates = [raw.indexOf("{"), raw.indexOf("[")].filter((i) => i >= 0);
    if (startCandidates.length === 0) return null;
    const startIndex = Math.min(...startCandidates);
    for (let end = raw.length; end > startIndex; end -= 1) {
      try {
        return JSON.parse(raw.slice(startIndex, end).trim());
      } catch {
        // keep shrinking
      }
    }
  }

  return null;
}

function stripMarkdownCodeFences(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("```")) return raw;
  return raw.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
}

export {
  extractJsonObjectFromText,
  normalizeBoolean,
  normalizeChunkRecord,
  normalizeFiniteNumber,
  normalizeNonEmptyString,
  normalizePositiveInt,
  stripMarkdownCodeFences,
};
