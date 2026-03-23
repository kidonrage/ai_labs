import {
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
  endpointUrl(agent) {
    return endpointForApiMode(agent.apiMode, agent.baseUrl);
  }

  requestHeaders(agent) {
    const headers = { "Content-Type": "application/json" };
    if (requiresAuthorization(agent.apiMode)) {
      if (!agent.apiKey) throw new Error("API key пустой.");
      headers.Authorization = `Bearer ${agent.apiKey}`;
    }
    return headers;
  }

  buildResponseRequestBody(agent, { model, input, temperature, messages = null }) {
    if (isOllamaFamilyMode(agent.apiMode)) {
      const body = {
        model,
        messages:
          Array.isArray(messages) && messages.length > 0
            ? messages
            : [{ role: "user", content: String(input || "") }],
        stream: false,
        options: { temperature: Number(temperature) },
      };
      if (agent.apiMode === "ollama_tools_chat") body.think = false;
      return body;
    }
    return { model, input, temperature: Number(temperature) };
  }

  memoryModelName(agent) {
    return isOllamaFamilyMode(agent.apiMode)
      ? agent.model
      : agent.contextPolicy.memoryModel || "gpt-3.5-turbo";
  }

  async requestModelText(agent, { userMsg = null, input, messages = null, temperature = null, modelOverride = null }) {
    const body = this.buildResponseRequestBody(agent, {
      model: modelOverride || agent.model,
      input,
      messages,
      temperature: temperature ?? agent.temperature,
    });
    const resp = await fetch(this.endpointUrl(agent), {
      method: "POST",
      headers: this.requestHeaders(agent),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const dto = await resp.json();
    const answerText = extractUserVisibleAnswer(dto, agent.apiMode);
    if (!answerText) throw new Error("Пустой ответ: не нашёл output_text.");
    const usage = normalizeUsage(dto);
    const durationSeconds = extractDurationSeconds(dto, agent.apiMode);
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
    return { answerText, usage, durationSeconds, modelName, costRub, dto };
  }

  async runTaskLLMStep(agent, input) {
    const completion = await this.requestModelText(agent, { input });
    const answerText = extractAnswerText(completion.dto, agent.apiMode);
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
