export const RAG_MODE_OPTIONS = Object.freeze([
  { value: "baseline", label: "Базовый" },
  { value: "rewrite_only", label: "Только rewrite" },
  { value: "filter_only", label: "Только фильтрация" },
  { value: "rewrite_and_filter", label: "Rewrite + filter" },
]);

export const DEFAULT_RAG_MODE = "baseline";

export function normalizeRagMode(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return RAG_MODE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_RAG_MODE;
}

export function getRagModeLabel(value) {
  const normalized = normalizeRagMode(value);
  const match = RAG_MODE_OPTIONS.find((option) => option.value === normalized);
  return match ? match.label : "Базовый";
}
