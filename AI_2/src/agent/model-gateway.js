import {
  defaultModelForApiMode,
  endpointForApiMode,
  inferApiMode,
  isOllamaFamilyMode,
  requiresAuthorization,
} from "../api-profiles.js";
import { normalizeUsage } from "../helpers.js";
import { OpenAIModelPricing } from "../pricing.js";
import {
  extractAnswerText,
  extractDurationSeconds,
  extractUserVisibleAnswer,
} from "./answer-extractors.js";

class ModelGateway {
  resolveRequestConfig(
    agent,
    { apiModeOverride = null, baseUrlOverride = null, apiKeyOverride = undefined } = {},
  ) {
    const hasBaseUrlOverride = typeof baseUrlOverride === "string" && baseUrlOverride.trim();
    const baseUrl =
      hasBaseUrlOverride
        ? baseUrlOverride.trim()
        : agent.baseUrl;
    const apiMode = hasBaseUrlOverride
      ? inferApiMode(null, baseUrl)
      : inferApiMode(apiModeOverride || agent.apiMode, baseUrl);
    return {
      apiMode,
      baseUrl,
      apiKey: apiKeyOverride === undefined ? agent.apiKey : apiKeyOverride,
    };
  }

  endpointUrl(requestConfig) {
    return endpointForApiMode(requestConfig.apiMode, requestConfig.baseUrl);
  }

  requestHeaders(requestConfig) {
    const headers = { "Content-Type": "application/json" };
    if (requiresAuthorization(requestConfig.apiMode)) {
      if (!requestConfig.apiKey) throw new Error("API key пустой.");
      headers.Authorization = `Bearer ${requestConfig.apiKey}`;
    }
    return headers;
  }

  buildResponseRequestBodyForApiMode(apiMode, { model, input, temperature, messages = null }) {
    if (isOllamaFamilyMode(apiMode)) {
      const body = {
        model,
        messages:
          Array.isArray(messages) && messages.length > 0
            ? messages
            : [{ role: "user", content: String(input || "") }],
        stream: false,
        options: { temperature: Number(temperature) },
      };
      if (apiMode === "ollama_tools_chat") body.think = false;
      return body;
    }
    return { model, input, temperature: Number(temperature) };
  }

  buildResponseRequestBody(agent, payload) {
    return this.buildResponseRequestBodyForApiMode(agent.apiMode, payload);
  }

  memoryModelName(agent, apiMode = agent.apiMode) {
    if (isOllamaFamilyMode(apiMode)) {
      return isOllamaFamilyMode(agent.apiMode) && typeof agent.model === "string" && agent.model.trim()
        ? agent.model.trim()
        : defaultModelForApiMode(apiMode, "");
    }
    const memoryModel =
      typeof agent.contextPolicy?.memoryModel === "string"
        ? agent.contextPolicy.memoryModel.trim()
        : "";
    return memoryModel || defaultModelForApiMode(apiMode, "");
  }

  async requestModelText(
    agent,
    {
      userMsg = null,
      input,
      messages = null,
      temperature = null,
      modelOverride = null,
      apiModeOverride = null,
      baseUrlOverride = null,
      apiKeyOverride = undefined,
    },
  ) {
    const requestConfig = this.resolveRequestConfig(agent, {
      apiModeOverride,
      baseUrlOverride,
      apiKeyOverride,
    });
    const body = this.buildResponseRequestBodyForApiMode(requestConfig.apiMode, {
      model: modelOverride || agent.model,
      input,
      messages,
      temperature: temperature ?? agent.temperature,
    });
    const resp = await fetch(this.endpointUrl(requestConfig), {
      method: "POST",
      headers: this.requestHeaders(requestConfig),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const dto = await resp.json();
    const answerText = extractUserVisibleAnswer(dto, requestConfig.apiMode);
    if (!answerText) throw new Error("Пустой ответ: не нашёл output_text.");
    const usage = normalizeUsage(dto);
    const durationSeconds = extractDurationSeconds(dto, requestConfig.apiMode);
    const modelName = dto.model || body.model;
    const costRub = usage
      ? OpenAIModelPricing.costRub(modelName, usage.inputTokens, usage.outputTokens)
      : null;
    if (usage && userMsg) {
      Object.assign(userMsg, {
        model: modelName,
        requestInputTokens: usage.inputTokens,
        requestOutputTokens: usage.outputTokens,
        requestTotalTokens: usage.totalTokens,
        costRub: costRub != null ? costRub : undefined,
        durationSeconds: durationSeconds != null ? durationSeconds : undefined,
      });
    }
    return { answerText, usage, durationSeconds, modelName, costRub, dto, apiMode: requestConfig.apiMode };
  }

  async runTaskLLMStep(agent, input) {
    const completion = await this.requestModelText(agent, { input });
    const answerText = extractAnswerText(completion.dto, completion.apiMode);
    if (!answerText) throw new Error("Пустой ответ: не нашёл output_text.");
    return answerText;
  }

  updateConfig(agent, { apiMode, baseUrl, apiKey, model, temperature }) {
    agent.apiMode = inferApiMode(apiMode, baseUrl);
    agent.baseUrl = baseUrl;
    agent.apiKey = apiKey;
    agent.model = model;
    agent.temperature = temperature;
  }
}

export { ModelGateway };
