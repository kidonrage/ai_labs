import {
  authorizationHeaderForRequest,
  defaultModelForApiMode,
  endpointForApiMode,
  inferApiMode,
  isOllamaFamilyMode,
} from "../api-profiles.js";
import { normalizeUsage } from "../helpers.js";
import { OpenAIModelPricing } from "../pricing.js";
import {
  extractAnswerText,
  extractOllamaResponseDetails,
  buildRawResponsePreview,
  extractDurationSeconds,
  extractUserVisibleAnswer,
} from "./answer-extractors.js";

function mergeOllamaOptions(temperature, extraOptions = null) {
  const options = { temperature: Number(temperature) };
  const raw = extraOptions && typeof extraOptions === "object" ? extraOptions : {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || key === "thinking" || key === "think") continue;
    options[key] = value;
  }
  return options;
}

function makeTypedError(message, fields = {}) {
  return Object.assign(new Error(message), fields);
}

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
    const authorization = authorizationHeaderForRequest(
      requestConfig.apiMode,
      requestConfig.baseUrl,
      requestConfig.apiKey,
    );
    if (authorization) headers.Authorization = authorization;
    return headers;
  }

  buildResponseRequestBodyForApiMode(
    apiMode,
    { model, input, temperature, messages = null, ollamaOptions = null },
  ) {
    if (isOllamaFamilyMode(apiMode)) {
      const body = {
        model,
        messages:
          Array.isArray(messages) && messages.length > 0
            ? messages
            : [{ role: "user", content: String(input || "") }],
        stream: false,
        options: mergeOllamaOptions(temperature, ollamaOptions),
        think: false,
      };
      return body;
    }
    return { model, input, temperature: Number(temperature) };
  }

  buildResponseRequestBody(agent, payload) {
    return this.buildResponseRequestBodyForApiMode(agent.apiMode, {
      ...payload,
      ollamaOptions: agent?.testModeConfig?.ollamaOptions || null,
    });
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
      ollamaOptions: agent?.testModeConfig?.ollamaOptions || null,
    });
    const resp = await fetch(this.endpointUrl(requestConfig), {
      method: "POST",
      headers: this.requestHeaders(requestConfig),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw makeTypedError(`HTTP ${resp.status}: ${text || resp.statusText}`, {
        errorType: "model_call_error",
        rawResponsePreview: buildRawResponsePreview(text || resp.statusText),
      });
    }
    let dto = null;
    if (typeof resp.text === "function") {
      const responseText = await resp.text();
      try {
        dto = JSON.parse(responseText);
      } catch {
        throw makeTypedError("Ответ модели не является валидным JSON.", {
          errorType: "response_parse_error",
          rawResponsePreview: buildRawResponsePreview(responseText),
        });
      }
    } else if (typeof resp.json === "function") {
      dto = await resp.json();
    } else {
      throw makeTypedError("Ответ модели не содержит json/text body.", {
        errorType: "response_parse_error",
        rawResponsePreview: "",
      });
    }
    const allowThinkingFallback = Boolean(agent?.testModeConfig?.allowThinkingAsAnswer);
    const ollamaDetails = isOllamaFamilyMode(requestConfig.apiMode)
      ? extractOllamaResponseDetails(dto, { allowThinkingFallback })
      : null;
    const answerText = isOllamaFamilyMode(requestConfig.apiMode)
      ? ollamaDetails?.answerText || null
      : extractUserVisibleAnswer(dto, requestConfig.apiMode);
    const rawResponsePreview = buildRawResponsePreview(dto);
    const warningMessage =
      ollamaDetails?.usedThinkingFallback
        ? "model_returned_thinking_instead_of_content"
        : null;
    if (!answerText) {
      throw makeTypedError("Пустой ответ: не удалось извлечь текст из ответа модели.", {
        errorType: "response_parse_error",
        rawResponsePreview,
        dto,
      });
    }
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
    return {
      answerText,
      usage,
      durationSeconds,
      modelName,
      costRub,
      dto,
      apiMode: requestConfig.apiMode,
      rawResponsePreview,
      warningMessage,
    };
  }

  async runTaskLLMStep(agent, input) {
    const completion = await this.requestModelText(agent, { input });
    const answerText = completion.answerText || extractAnswerText(completion.dto, completion.apiMode);
    if (!answerText) {
      throw makeTypedError("Пустой ответ: не удалось извлечь текст из ответа модели.", {
        errorType: "response_parse_error",
        rawResponsePreview: completion.rawResponsePreview || "",
        dto: completion.dto,
      });
    }
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
