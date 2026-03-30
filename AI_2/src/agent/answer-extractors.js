import { API_MODES, isOllamaFamilyMode } from "../api-profiles.js";

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return null;
}

function extractOllamaThinkingText(dto) {
  return pickFirstText(
    dto?.message?.thinking,
    dto?.thinking,
    dto?.choices?.[0]?.message?.thinking,
    dto?.choices?.[0]?.delta?.thinking,
  );
}

function collectTextFromContent(content, parts = []) {
  if (typeof content === "string") {
    const text = normalizeText(content);
    if (text) parts.push(text);
    return parts;
  }
  if (Array.isArray(content)) {
    for (const item of content) collectTextFromContent(item, parts);
    return parts;
  }
  if (!content || typeof content !== "object") return parts;
  const directText = pickFirstText(content.text, content.output_text, content.response);
  if (directText) parts.push(directText);
  if ("content" in content) collectTextFromContent(content.content, parts);
  if ("message" in content) collectTextFromContent(content.message, parts);
  if ("delta" in content) collectTextFromContent(content.delta, parts);
  return parts;
}

function extractOllamaContentText(dto) {
  return pickFirstText(
    dto?.message?.content,
    dto?.response,
    dto?.output_text,
    dto?.choices?.[0]?.message?.content,
    dto?.choices?.[0]?.delta?.content,
  );
}

function extractOllamaResponseDetails(dto, options = {}) {
  const contentText = extractOllamaContentText(dto);
  const thinkingText = extractOllamaThinkingText(dto);
  const allowThinkingFallback = Boolean(options.allowThinkingFallback);
  return {
    contentText,
    thinkingText,
    usedThinkingFallback: !contentText && Boolean(thinkingText) && allowThinkingFallback,
    answerText: contentText || (allowThinkingFallback ? thinkingText : null),
  };
}

function extractResponsesAnswerText(dto) {
  const direct = pickFirstText(dto?.output_text, dto?.response, dto?.choices?.[0]?.message?.content);
  if (direct) return direct;
  const output = Array.isArray(dto?.output) ? dto.output : [];
  const parts = [];
  for (const item of output) {
    if (item?.type === "message" && item.role === "assistant") {
      collectTextFromContent(item.content, parts);
      continue;
    }
    if (item?.type === "output_text" || item?.type === "text") {
      collectTextFromContent(item, parts);
    }
  }
  return parts.join("\n").trim() || null;
}

function extractAnswerText(dto, apiMode = API_MODES.PROXYAPI_RESPONSES, options = {}) {
  if (isOllamaFamilyMode(apiMode)) {
    return extractOllamaResponseDetails(dto, options).answerText;
  }
  return extractResponsesAnswerText(dto);
}

function extractToolCallNames(dto) {
  const output = Array.isArray(dto.output) ? dto.output : [];
  const names = [];
  for (const item of output) {
    if (item?.type !== "mcp_call" || typeof item.name !== "string") continue;
    const name = item.name.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function extractUserVisibleAnswer(dto, apiMode = API_MODES.PROXYAPI_RESPONSES, options = {}) {
  if (isOllamaFamilyMode(apiMode)) return extractAnswerText(dto, apiMode, options);
  const parts = [];
  const toolCallNames = extractToolCallNames(dto);
  const answerText = extractAnswerText(dto, apiMode);
  if (toolCallNames.length > 0) parts.push(toolCallNames.join("\n"));
  if (answerText) parts.push(answerText);
  return parts.join("\n\n").trim() || null;
}

function buildRawResponsePreview(dto, maxLength = 500) {
  const text = extractUserVisibleAnswer(dto, API_MODES.PROXYAPI_RESPONSES)
    || extractOllamaContentText(dto)
    || extractOllamaThinkingText(dto)
    || (() => {
      try {
        return JSON.stringify(dto);
      } catch {
        return String(dto ?? "");
      }
    })();
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function extractDurationSeconds(dto, apiMode = API_MODES.PROXYAPI_RESPONSES) {
  if (isOllamaFamilyMode(apiMode)) {
    return Number.isFinite(dto.total_duration) ? dto.total_duration / 1_000_000_000 : null;
  }
  return Number.isFinite(dto.created_at) && Number.isFinite(dto.completed_at)
    ? dto.completed_at - dto.created_at
    : null;
}

export {
  extractAnswerText,
  extractOllamaResponseDetails,
  buildRawResponsePreview,
  extractDurationSeconds,
  extractToolCallNames,
  extractUserVisibleAnswer,
};
