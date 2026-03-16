export const API_MODES = Object.freeze({
  PROXYAPI_RESPONSES: "proxyapi_responses",
  OLLAMA_CHAT: "ollama_chat",
  OLLAMA_TOOLS_CHAT: "ollama_tools_chat",
});

export function normalizeApiMode(value) {
  if (value === API_MODES.OLLAMA_CHAT) return API_MODES.OLLAMA_CHAT;
  if (value === API_MODES.OLLAMA_TOOLS_CHAT) return API_MODES.OLLAMA_TOOLS_CHAT;
  return API_MODES.PROXYAPI_RESPONSES;
}

export function inferApiMode(value, rawBaseUrl) {
  if (
    value === API_MODES.OLLAMA_CHAT ||
    value === API_MODES.OLLAMA_TOOLS_CHAT ||
    value === API_MODES.PROXYAPI_RESPONSES
  ) {
    return value;
  }
  const baseUrl = String(rawBaseUrl || "").trim();
  if (/localhost:8000/i.test(baseUrl) && /\/api\/chat\/?$/i.test(baseUrl)) {
    return API_MODES.OLLAMA_TOOLS_CHAT;
  }
  if (/\/api\/chat\/?$/i.test(baseUrl) || /localhost:11434/i.test(baseUrl)) {
    return API_MODES.OLLAMA_CHAT;
  }
  return API_MODES.PROXYAPI_RESPONSES;
}

export function defaultEndpointForApiMode(value) {
  const mode = normalizeApiMode(value);
  if (mode === API_MODES.OLLAMA_TOOLS_CHAT) {
    return "http://localhost:8000/api/chat";
  }
  if (mode === API_MODES.OLLAMA_CHAT) {
    return "http://localhost:11434/api/chat";
  }
  return "https://api.proxyapi.ru/openai/v1/responses";
}

export function endpointForApiMode(value, rawBaseUrl) {
  const mode = normalizeApiMode(value);
  const baseUrl = String(rawBaseUrl || "").trim();
  if (!baseUrl) return defaultEndpointForApiMode(mode);

  if (mode === API_MODES.OLLAMA_CHAT) {
    return /\/api\/chat\/?$/i.test(baseUrl)
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, "")}/api/chat`;
  }

  if (mode === API_MODES.OLLAMA_TOOLS_CHAT) {
    return /\/api\/chat\/?$/i.test(baseUrl)
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, "")}/api/chat`;
  }

  return /\/openai\/v1\/responses\/?$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/openai/v1/responses`;
}

export function requiresAuthorization(value) {
  return normalizeApiMode(value) === API_MODES.PROXYAPI_RESPONSES;
}

export function defaultModelForApiMode(value, currentModel = "") {
  const mode = normalizeApiMode(value);
  const model = String(currentModel || "").trim();
  if (model) return model;
  if (mode === API_MODES.OLLAMA_TOOLS_CHAT) return "qwen3:8b";
  if (mode === API_MODES.OLLAMA_CHAT) return "gemma3";
  return "gpt-4.1";
}

export function isOllamaFamilyMode(value) {
  const mode = normalizeApiMode(value);
  return mode === API_MODES.OLLAMA_CHAT || mode === API_MODES.OLLAMA_TOOLS_CHAT;
}
