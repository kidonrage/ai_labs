import { API_MODES, isOllamaFamilyMode } from "../api-profiles.js";

function extractAnswerText(dto, apiMode = API_MODES.PROXYAPI_RESPONSES) {
  if (isOllamaFamilyMode(apiMode)) {
    const text =
      dto && dto.message && typeof dto.message.content === "string"
        ? dto.message.content
        : null;
    return (text || "").trim() || null;
  }
  const output = Array.isArray(dto.output) ? dto.output : [];
  const assistantItem = output.find((item) => item?.type === "message" && item.role === "assistant");
  const content = assistantItem && Array.isArray(assistantItem.content) ? assistantItem.content : [];
  const textItem = content.find((item) => item?.type === "output_text" && typeof item.text === "string");
  return (textItem ? textItem.text : "").trim() || null;
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

function extractUserVisibleAnswer(dto, apiMode = API_MODES.PROXYAPI_RESPONSES) {
  if (isOllamaFamilyMode(apiMode)) return extractAnswerText(dto, apiMode);
  const parts = [];
  const toolCallNames = extractToolCallNames(dto);
  const answerText = extractAnswerText(dto, apiMode);
  if (toolCallNames.length > 0) parts.push(toolCallNames.join("\n"));
  if (answerText) parts.push(answerText);
  return parts.join("\n\n").trim() || null;
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
  extractDurationSeconds,
  extractToolCallNames,
  extractUserVisibleAnswer,
};
