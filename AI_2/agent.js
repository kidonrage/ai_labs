// /src/agent.js
import { OpenAIModelPricing } from "./pricing.js";
import { normalizeUsage } from "./helpers.js";

export class Agent {
  constructor({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;

    // history item schema (v2):
    // {
    //   role: "user"|"assistant",
    //   text: string,
    //   at: ISO string,
    //   model?: string,
    //   requestInputTokens?: number,  // dto.usage.input_tokens (for this request)
    //   requestOutputTokens?: number, // dto.usage.output_tokens (for this request)
    //   requestTotalTokens?: number,  // dto.usage.total_tokens (for this request)
    //   costRub?: number,             // total request cost (in+out) for this request
    //   durationSeconds?: number|null
    // }
    this.history = [];

    this.systemPreamble =
      "Ты полезный ассистент. Отвечай кратко и по делу, если не просят иначе.";

    this.onStateChanged = null;
  }

  setConfig({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this._emitStateChanged();
  }

  reset() {
    this.history = [];
    this._emitStateChanged();
  }

  exportState() {
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      config: {
        baseUrl: this.baseUrl,
        apiKey: null, // intentionally not persisted
        model: this.model,
        temperature: this.temperature,
      },
      systemPreamble: this.systemPreamble,
      history: this.history,
    };
  }

  importState(state) {
    if (!state || typeof state !== "object") return;

    if (typeof state.systemPreamble === "string") {
      this.systemPreamble = state.systemPreamble;
    }

    if (state.config && typeof state.config === "object") {
      if (typeof state.config.baseUrl === "string")
        this.baseUrl = state.config.baseUrl;
      if (typeof state.config.model === "string")
        this.model = state.config.model;
      if (typeof state.config.temperature === "number")
        this.temperature = state.config.temperature;
      // apiKey intentionally not restored
    }

    if (Array.isArray(state.history)) {
      // Accept v1 and v2. v1: {role,text}. v2: extended.
      this.history = state.history
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.text === "string",
        )
        .map((m) => ({
          role: m.role,
          text: m.text,
          at: typeof m.at === "string" ? m.at : new Date().toISOString(),
          model: typeof m.model === "string" ? m.model : undefined,
          requestInputTokens: Number.isFinite(m.requestInputTokens)
            ? m.requestInputTokens
            : undefined,
          requestOutputTokens: Number.isFinite(m.requestOutputTokens)
            ? m.requestOutputTokens
            : undefined,
          requestTotalTokens: Number.isFinite(m.requestTotalTokens)
            ? m.requestTotalTokens
            : undefined,
          costRub: Number.isFinite(m.costRub) ? m.costRub : undefined,
          durationSeconds: Number.isFinite(m.durationSeconds)
            ? m.durationSeconds
            : undefined,
        }));
    }

    this._emitStateChanged();
  }

  _emitStateChanged() {
    if (typeof this.onStateChanged === "function") {
      this.onStateChanged(this.exportState());
    }
  }

  buildContextInput(nextUserText) {
    const lines = [];
    lines.push(`SYSTEM: ${this.systemPreamble}`);
    for (const m of this.history) {
      lines.push(`${m.role.toUpperCase()}: ${m.text}`);
    }
    lines.push(`USER: ${nextUserText}`);
    lines.push("ASSISTANT:");
    return lines.join("\n");
  }

  async send(userText) {
    if (!this.apiKey) throw new Error("API key пустой.");
    if (!userText.trim()) throw new Error("Пустое сообщение.");

    const input = this.buildContextInput(userText);

    // 1) add user message to history
    const userMsg = {
      role: "user",
      text: userText,
      at: new Date().toISOString(),
    };
    this.history.push(userMsg);
    this._emitStateChanged();

    const url = this.baseUrl.replace(/\/+$/, "") + "/openai/v1/responses";
    const body = {
      model: this.model,
      input,
      temperature: Number(this.temperature),
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }

    const dto = await resp.json();

    const answerText = Agent.extractAnswerText(dto);
    if (!answerText) throw new Error("Пустой ответ: не нашёл output_text.");

    const usage = normalizeUsage(dto);

    const durationSeconds =
      Number.isFinite(dto.created_at) && Number.isFinite(dto.completed_at)
        ? dto.completed_at - dto.created_at
        : null;

    const modelName = dto.model || this.model;

    const costRub = usage
      ? OpenAIModelPricing.costRub(
          modelName,
          usage.inputTokens,
          usage.outputTokens,
        )
      : null;

    // 2) attach request stats to BOTH messages of this turn (user + assistant),
    // so UI can show per-message info without looking back.
    if (usage) {
      userMsg.model = modelName;
      userMsg.requestInputTokens = usage.inputTokens; // токены текущего запроса
      userMsg.requestOutputTokens = usage.outputTokens; // токены ответа в рамках этого же запроса (для общей суммы)
      userMsg.requestTotalTokens = usage.totalTokens;
      userMsg.costRub = costRub != null ? costRub : undefined;
      userMsg.durationSeconds =
        durationSeconds != null ? durationSeconds : undefined;
    }

    const assistantMsg = {
      role: "assistant",
      text: answerText,
      at: new Date().toISOString(),
      model: modelName,
      requestInputTokens: usage ? usage.inputTokens : undefined,
      requestOutputTokens: usage ? usage.outputTokens : undefined,
      requestTotalTokens: usage ? usage.totalTokens : undefined,
      costRub: costRub != null ? costRub : undefined,
      durationSeconds: durationSeconds != null ? durationSeconds : undefined,
    };

    // 3) push assistant message
    this.history.push(assistantMsg);
    this._emitStateChanged();

    return {
      answer: answerText,
      model: modelName,
      usage,
      durationSeconds,
      costRub,
    };
  }

  static extractAnswerText(dto) {
    const output = Array.isArray(dto.output) ? dto.output : [];
    const assistantItem = output.find(
      (it) => it && it.type === "message" && it.role === "assistant",
    );
    const content =
      assistantItem && Array.isArray(assistantItem.content)
        ? assistantItem.content
        : [];
    const textItem = content.find(
      (c) => c && c.type === "output_text" && typeof c.text === "string",
    );
    const t = textItem ? textItem.text : null;
    return (t || "").trim() || null;
  }
}
