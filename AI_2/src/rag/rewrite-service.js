import {
  endpointForApiMode,
  isOllamaFamilyMode,
  normalizeApiMode,
  requiresAuthorization,
} from "../api-profiles.js";
import {
  DEFAULT_REWRITE_API_MODE,
  DEFAULT_REWRITE_BASE_URL,
  DEFAULT_REWRITE_MODEL,
  DEFAULT_REWRITE_TEMPERATURE,
} from "./constants.js";
import { normalizeFiniteNumber } from "./shared.js";
import {
  buildRewritePrompt,
  extractRewriteText,
  sanitizeRewriteResult,
} from "./prompt-builder.js";

async function rewriteQuery(question, options = {}) {
  const originalQuestion = String(question || "").trim();
  if (!originalQuestion) return "";
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
  const headers = { "Content-Type": "application/json" };
  if (requiresAuthorization(apiMode)) {
    const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
    if (!apiKey) return originalQuestion;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  try {
    const body = isOllamaFamilyMode(apiMode)
      ? { model, messages: [{ role: "user", content: buildRewritePrompt(originalQuestion) }], stream: false, options: { temperature }, think: false }
      : { model, input: buildRewritePrompt(originalQuestion), temperature };
    const response = await fetch(baseUrl, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) return originalQuestion;
    const data = await response.json();
    return sanitizeRewriteResult(extractRewriteText(data, apiMode)) || originalQuestion;
  } catch {
    return originalQuestion;
  }
}

export { rewriteQuery };
