import { OpenAIModelPricing } from "./pricing.js";
import { normalizeUsage } from "./helpers.js";

export class Agent {
  constructor({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;

    this.history = [];

    // Summary chunks stored separately
    // { id, fromIndex, toIndex, at, text }
    this.summaries = [];

    // Separate accounting for summarization
    this.summaryTotals = {
      summaryRequests: 0,
      summaryInputTokens: 0,
      summaryOutputTokens: 0,
      summaryTotalTokens: 0,
      summaryCostRub: 0,
    };

    this.contextPolicy = {
      keepLastMessages: 12,
      chunkSize: 10,
      maxSummaryChars: 1400,

      // NEW: summarize via cheap LLM
      summaryModel: "gpt-3.5-turbo",
      summaryTemperature: 0.2,
    };

    this.systemPreamble =
      "Ты полезный ассистент. Отвечай кратко и по делу, если не просят иначе.";

    this.onStateChanged = null;

    // avoid concurrent summarization
    this._summarizeLock = Promise.resolve();
  }

  setConfig({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this._emitStateChanged();
  }

  setContextPolicy(patch) {
    this.contextPolicy = { ...this.contextPolicy, ...(patch || {}) };
    this._emitStateChanged();
  }

  reset() {
    this.history = [];
    this.summaries = [];
    this.summaryTotals = {
      summaryRequests: 0,
      summaryInputTokens: 0,
      summaryOutputTokens: 0,
      summaryTotalTokens: 0,
      summaryCostRub: 0,
    };
    this._emitStateChanged();
  }

  exportState() {
    return {
      version: 4,
      savedAt: new Date().toISOString(),
      config: {
        baseUrl: this.baseUrl,
        apiKey: null,
        model: this.model,
        temperature: this.temperature,
      },
      systemPreamble: this.systemPreamble,
      contextPolicy: this.contextPolicy,
      summaries: this.summaries,
      summaryTotals: this.summaryTotals,
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
    }

    if (state.contextPolicy && typeof state.contextPolicy === "object") {
      this.contextPolicy = { ...this.contextPolicy, ...state.contextPolicy };
    }

    if (Array.isArray(state.summaries)) {
      this.summaries = state.summaries
        .filter((s) => s && typeof s.text === "string")
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : this._summaryId(),
          fromIndex: Number.isFinite(s.fromIndex) ? s.fromIndex : 0,
          toIndex: Number.isFinite(s.toIndex) ? s.toIndex : 0,
          at: typeof s.at === "string" ? s.at : new Date().toISOString(),
          text: s.text,
        }));
    }

    if (state.summaryTotals && typeof state.summaryTotals === "object") {
      const t = state.summaryTotals;
      this.summaryTotals = {
        summaryRequests: Number.isFinite(t.summaryRequests)
          ? t.summaryRequests
          : 0,
        summaryInputTokens: Number.isFinite(t.summaryInputTokens)
          ? t.summaryInputTokens
          : 0,
        summaryOutputTokens: Number.isFinite(t.summaryOutputTokens)
          ? t.summaryOutputTokens
          : 0,
        summaryTotalTokens: Number.isFinite(t.summaryTotalTokens)
          ? t.summaryTotalTokens
          : 0,
        summaryCostRub: Number.isFinite(t.summaryCostRub)
          ? t.summaryCostRub
          : 0,
      };
    }

    if (Array.isArray(state.history)) {
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

  // =====================
  // Summarization (LLM)
  // =====================

  _summaryId() {
    return (
      (crypto.randomUUID && crypto.randomUUID()) ||
      `sum_${Date.now()}_${Math.random()}`
    );
  }

  _getSummarizedUntilIndexExclusive() {
    let maxTo = -1;
    for (const s of this.summaries) {
      if (Number.isFinite(s.toIndex)) maxTo = Math.max(maxTo, s.toIndex);
    }
    return maxTo + 1;
  }

  _needsSummarize() {
    const keepLast = Math.max(
      0,
      Number(this.contextPolicy.keepLastMessages) || 0,
    );
    const chunkSize = Math.max(2, Number(this.contextPolicy.chunkSize) || 10);

    const total = this.history.length;
    if (total <= keepLast) return null;

    const unsummarizedStart = Math.max(0, total - keepLast);
    const summarizedUntil = this._getSummarizedUntilIndexExclusive();

    if (summarizedUntil + chunkSize <= unsummarizedStart) {
      return {
        fromIndex: summarizedUntil,
        toIndex: summarizedUntil + chunkSize - 1,
      };
    }
    return null;
  }

  async _ensureSummariesUpToDate() {
    // serialize summarization calls (avoid concurrent)
    this._summarizeLock = this._summarizeLock.then(async () => {
      while (true) {
        const next = this._needsSummarize();
        if (!next) break;

        const chunk = this.history.slice(next.fromIndex, next.toIndex + 1);
        const summaryText = await this._summarizeChunkWithLLM(chunk, next);

        this.summaries.push({
          id: this._summaryId(),
          fromIndex: next.fromIndex,
          toIndex: next.toIndex,
          at: new Date().toISOString(),
          text: this._compactText(
            summaryText,
            this.contextPolicy.maxSummaryChars,
          ),
        });

        // persist totals + summaries
        this._emitStateChanged();
      }
    });

    return this._summarizeLock;
  }

  _compactText(text, maxChars) {
    const m = Math.max(200, Number(maxChars) || 1400);
    const t = String(text || "").trim();
    if (t.length <= m) return t;
    const head = t.slice(0, Math.floor(m * 0.75));
    const tail = t.slice(-Math.floor(m * 0.2));
    return `${head}\n…\n${tail}`.slice(0, m);
  }

  _chunkToTranscript(messages) {
    // Compact transcript for summarization prompt
    const lines = [];
    for (const m of messages) {
      const role = m.role === "user" ? "User" : "Assistant";
      const txt = String(m.text || "").trim();
      if (!txt) continue;
      lines.push(`${role}: ${txt}`);
    }
    return lines.join("\n");
  }

  async _summarizeChunkWithLLM(messages, { fromIndex, toIndex }) {
    if (!this.apiKey)
      throw new Error("API key пустой (нужен для суммаризации).");

    const transcript = this._chunkToTranscript(messages);

    const instruction =
      `Ты summarizer. Сожми диалог в структурированное summary.\n` +
      `Правила:\n` +
      `- 6–12 буллетов, коротко.\n` +
      `- Сохрани: цели пользователя, важные факты, решения/выводы, ограничения, договорённости.\n` +
      `- Не добавляй выдуманных деталей.\n` +
      `- Пиши по-русски.\n` +
      `Верни только summary, без прелюдий.\n`;

    const input =
      `SYSTEM: ${instruction}\n` +
      `CONTEXT: Messages #${fromIndex}..#${toIndex}\n` +
      `TRANSCRIPT:\n${transcript}\n` +
      `SUMMARY:\n`;

    const url = this.baseUrl.replace(/\/+$/, "") + "/openai/v1/responses";
    const body = {
      model: this.contextPolicy.summaryModel || "gpt-3.5-turbo",
      input,
      temperature: Number(this.contextPolicy.summaryTemperature || 0.2),
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
      throw new Error(
        `Summarize HTTP ${resp.status}: ${text || resp.statusText}`,
      );
    }

    const dto = await resp.json();
    const summaryText = Agent.extractAnswerText(dto);
    if (!summaryText) throw new Error("Summarize: пустой output_text.");

    // accounting (NOT in chat)
    const usage = normalizeUsage(dto);
    const modelName = dto.model || body.model;

    const costRub = usage
      ? OpenAIModelPricing.costRub(
          modelName,
          usage.inputTokens,
          usage.outputTokens,
        )
      : null;

    if (usage) {
      this.summaryTotals.summaryRequests += 1;
      this.summaryTotals.summaryInputTokens += usage.inputTokens;
      this.summaryTotals.summaryOutputTokens += usage.outputTokens;
      this.summaryTotals.summaryTotalTokens += usage.totalTokens;
      if (costRub != null) this.summaryTotals.summaryCostRub += costRub;
    }

    return summaryText;
  }

  // =====================
  // Context build
  // =====================

  async _buildContextInput(nextUserText) {
    // Ensure summaries exist before sending main request
    await this._ensureSummariesUpToDate();

    const keepLast = Math.max(
      0,
      Number(this.contextPolicy.keepLastMessages) || 0,
    );
    const total = this.history.length;
    const tailStart = Math.max(0, total - keepLast);
    const tail = this.history.slice(tailStart);

    const parts = [];
    parts.push(`SYSTEM: ${this.systemPreamble}`);

    if (this.summaries.length > 0) {
      parts.push("CONTEXT SUMMARY (older messages):");
      for (const s of this.summaries) {
        parts.push(`- ${s.text}`);
      }
    }

    if (tail.length > 0) {
      parts.push("RECENT MESSAGES:");
      for (const m of tail) {
        parts.push(`${m.role.toUpperCase()}: ${m.text}`);
      }
    }

    parts.push(`USER: ${nextUserText}`);
    parts.push("ASSISTANT:");
    return parts.join("\n");
  }

  // =====================
  // Main send (chat request)
  // =====================

  async send(userText) {
    if (!this.apiKey) throw new Error("API key пустой.");
    if (!userText.trim()) throw new Error("Пустое сообщение.");

    // build context with summaries
    const input = await this._buildContextInput(userText);

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

    // attach request stats to user message
    if (usage) {
      userMsg.model = modelName;
      userMsg.requestInputTokens = usage.inputTokens;
      userMsg.requestOutputTokens = usage.outputTokens;
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

    this.history.push(assistantMsg);

    // After pushing new messages, we may be able to summarize older chunks for next turns
    // (async, but awaited to keep state consistent)
    await this._ensureSummariesUpToDate();

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
