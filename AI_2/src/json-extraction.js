function isJsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseJsonObject(text) {
  try {
    return isJsonObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const direct = parseJsonObject(raw);
  if (direct) return direct;

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  return parseJsonObject(raw.slice(start, end + 1));
}

export { extractJsonObject };
