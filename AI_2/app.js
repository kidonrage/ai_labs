// =====================
// Pricing (₽ per 1M tokens)
// =====================
const OpenAIModelPricing = {
  rates: {
    "gpt-5.2": { input: 531.0, output: 4245.0 },
    "gpt-4.1": { input: 516.0, output: 2062.0 },
    "gpt-3.5-turbo": { input: 129.0, output: 387.0 },
  },
  key(model) {
    if (!model) return null;
    if (model.startsWith("gpt-5.2")) return "gpt-5.2";
    if (model.startsWith("gpt-4.1")) return "gpt-4.1";
    if (model.startsWith("gpt-3.5-turbo")) return "gpt-3.5-turbo";
    return null;
  },
  costRub(model, inputTokens, outputTokens) {
    const k = this.key(model);
    if (!k || !this.rates[k]) return null;
    const r = this.rates[k];
    const inCost = (Number(inputTokens || 0) / 1_000_000) * r.input;
    const outCost = (Number(outputTokens || 0) / 1_000_000) * r.output;
    return inCost + outCost;
  },
  costPartsRub(model, inputTokens, outputTokens) {
    const k = this.key(model);
    if (!k || !this.rates[k]) return null;
    const r = this.rates[k];
    const inCost = (Number(inputTokens || 0) / 1_000_000) * r.input;
    const outCost = (Number(outputTokens || 0) / 1_000_000) * r.output;
    return { inCost, outCost, total: inCost + outCost, key: k };
  },
};

// =====================
// Persistent Storage (JSON in localStorage)
// =====================
const STORAGE_KEY = "simple_agent_chat_v2";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const obj = safeJsonParse(raw);
  if (!obj || typeof obj !== "object") return null;
  return obj;
}

function saveState(stateObj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj, null, 2));
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

// =====================
// Helpers: usage + totals
// =====================
function normalizeUsage(dto) {
  const u = dto && dto.usage ? dto.usage : null;
  const input = u && Number.isFinite(u.input_tokens) ? u.input_tokens : null;
  const output = u && Number.isFinite(u.output_tokens) ? u.output_tokens : null;
  const total = u && Number.isFinite(u.total_tokens) ? u.total_tokens : null;

  if (input == null || output == null || total == null) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function computeHistoryTotals(history) {
  // Суммируем usage по всем request'ам (мы сохраняем одинаковые request-метрики на user и assistant сообщение)
  // Чтобы не удваивать — учитываем только user сообщения как "request anchor".
  let reqIn = 0;
  let reqOut = 0;
  let reqTotal = 0;
  let costRub = 0;

  for (const m of history) {
    if (m.role !== "user") continue;
    if (Number.isFinite(m.requestInputTokens)) reqIn += m.requestInputTokens;
    if (Number.isFinite(m.requestOutputTokens)) reqOut += m.requestOutputTokens;
    if (Number.isFinite(m.requestTotalTokens)) reqTotal += m.requestTotalTokens;
    if (Number.isFinite(m.costRub)) costRub += m.costRub;
  }

  return {
    requestInputTokens: reqIn,
    requestOutputTokens: reqOut,
    requestTotalTokens: reqTotal,
    costRub,
  };
}

function round4(x) {
  return Math.round(x * 10_000) / 10_000;
}

// =====================
// Agent — отдельная сущность + persistence hooks
// =====================
class Agent {
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

// =====================
// UI
// =====================
const $ = (id) => document.getElementById(id);

function formatTimeFromISO(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return formatTime();
  }
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatCost(x) {
  if (!Number.isFinite(x)) return null;
  return `${round4(x).toFixed(4)} ₽`;
}

function messageStatsLines(message, historyTotals) {
  const lines = [];

  const model = message.model;
  const hasUsage =
    Number.isFinite(message.requestInputTokens) &&
    Number.isFinite(message.requestOutputTokens);

  // Per-message: tokens/cost
  if (hasUsage) {
    const inTok = message.requestInputTokens;
    const outTok = message.requestOutputTokens;
    const totalTok = Number.isFinite(message.requestTotalTokens)
      ? message.requestTotalTokens
      : inTok + outTok;

    if (message.role === "user") {
      // "для текущего запроса" — это input_tokens
      const perMsgCost = OpenAIModelPricing.costPartsRub(model || "", inTok, 0);
      const c = perMsgCost ? perMsgCost.inCost : null;

      lines.push(
        `request tokens: in ${inTok}, out ${outTok}, total ${totalTok}`,
      );
      if (model) lines.push(`model: ${model}`);
      if (c != null)
        lines.push(`this message cost: ${formatCost(c)} (input only)`);
    } else {
      // assistant message cost is output part
      const perMsgCost = OpenAIModelPricing.costPartsRub(
        model || "",
        0,
        outTok,
      );
      const c = perMsgCost ? perMsgCost.outCost : null;

      lines.push(
        `request tokens: in ${inTok}, out ${outTok}, total ${totalTok}`,
      );
      if (model) lines.push(`model: ${model}`);
      if (c != null)
        lines.push(`this message cost: ${formatCost(c)} (output only)`);
    }

    // optional duration
    if (message.durationSeconds != null) {
      lines.push(`duration: ${message.durationSeconds}s`);
    }

    // History totals (global)
    if (historyTotals) {
      lines.push(
        `history total: in ${historyTotals.requestInputTokens}, out ${historyTotals.requestOutputTokens}, total ${historyTotals.requestTotalTokens}`,
      );
      lines.push(`history cost: ${formatCost(historyTotals.costRub)}`);
    }
  } else {
    // No usage available (e.g., restored old history without usage)
    if (model) lines.push(`model: ${model}`);
    if (historyTotals) {
      lines.push(
        `history total: in ${historyTotals.requestInputTokens}, out ${historyTotals.requestOutputTokens}, total ${historyTotals.requestTotalTokens}`,
      );
      lines.push(`history cost: ${formatCost(historyTotals.costRub)}`);
    }
  }

  return lines;
}

function addMessage({ role, text, meta = {} }, historyTotals = null) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;

  const metaRow = document.createElement("div");
  metaRow.className = "meta";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = role === "user" ? "USER" : "ASSISTANT";
  metaRow.appendChild(badge);

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = meta.time || formatTime();
  metaRow.appendChild(time);

  wrap.appendChild(metaRow);

  const textDiv = document.createElement("div");
  textDiv.className = "text";
  textDiv.textContent = text;
  wrap.appendChild(textDiv);

  // Stats
  const statsLines = meta.statsLines || [];
  if (statsLines.length > 0) {
    const stats = document.createElement("div");
    stats.className = "stats";

    for (const line of statsLines) {
      const el = document.createElement("span");
      el.textContent = line;
      stats.appendChild(el);
    }
    wrap.appendChild(stats);
  }

  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function renderHistory(history) {
  $("messages").innerHTML = "";

  const totals = computeHistoryTotals(history);

  for (const m of history) {
    const time = m.at ? formatTimeFromISO(m.at) : formatTime();
    const statsLines = messageStatsLines(m, totals);
    addMessage(
      { role: m.role, text: m.text, meta: { time, statsLines } },
      totals,
    );
  }

  // Sticky footer total
  renderTotalsBar(totals);
}

function renderTotalsBar(totals) {
  const el = $("totals");
  if (!el) return;

  const hasAny =
    totals &&
    (totals.requestTotalTokens > 0 ||
      (Number.isFinite(totals.costRub) && totals.costRub > 0));

  if (!hasAny) {
    el.textContent = "History totals: —";
    return;
  }

  el.textContent =
    `History totals — tokens: in ${totals.requestInputTokens}, out ${totals.requestOutputTokens}, total ${totals.requestTotalTokens} • ` +
    `cost: ${formatCost(totals.costRub)}`;
}

function setBusy(isBusy) {
  $("send").disabled = isBusy;
  $("newChat").disabled = isBusy;
  $("input").disabled = isBusy;
  $("model").disabled = isBusy;
  $("temperature").disabled = isBusy;
  $("baseUrl").disabled = isBusy;
  $("apiKey").disabled = isBusy;
  $("send").textContent = isBusy ? "Sending…" : "Send";
}

// =====================
// Boot + restore persisted context
// =====================
let agent = new Agent({
  baseUrl: $("baseUrl").value,
  apiKey: $("apiKey").value,
  model: $("model").value,
  temperature: Number($("temperature").value),
});

// agent persists on every change
agent.onStateChanged = (state) => {
  saveState(state);
  // also re-render totals bar live (without fully re-rendering messages)
  const totals = computeHistoryTotals(state.history || []);
  renderTotalsBar(totals);
};

const persisted = loadState();

if (persisted) {
  agent.importState(persisted);

  // apply restored settings to UI
  if (persisted.config) {
    if (typeof persisted.config.baseUrl === "string")
      $("baseUrl").value = persisted.config.baseUrl;
    if (typeof persisted.config.model === "string")
      $("model").value = persisted.config.model;
    if (typeof persisted.config.temperature === "number")
      $("temperature").value = String(persisted.config.temperature);
  }

  if (Array.isArray(agent.history) && agent.history.length > 0) {
    renderHistory(agent.history);
  } else {
    addMessage({
      role: "assistant",
      text: "История пуста. Начнём новый диалог.",
      meta: { statsLines: [] },
    });
    renderTotalsBar({
      requestInputTokens: 0,
      requestOutputTokens: 0,
      requestTotalTokens: 0,
      costRub: 0,
    });
  }

  addMessage({
    role: "assistant",
    text:
      "Я восстановил контекст из localStorage (JSON). " +
      "Если ты перезагрузила страницу — история сохранена. " +
      "Вставь API key (он не сохраняется) и продолжай.",
    meta: { statsLines: [] },
  });
} else {
  addMessage({
    role: "assistant",
    text:
      "Привет! Я простой агент. Я сохраняю контекст в localStorage как JSON, " +
      "поэтому после перезагрузки страница продолжит диалог с прежней историей.",
    meta: { statsLines: [] },
  });
  renderTotalsBar({
    requestInputTokens: 0,
    requestOutputTokens: 0,
    requestTotalTokens: 0,
    costRub: 0,
  });
}

function syncAgentConfig() {
  agent.setConfig({
    baseUrl: $("baseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value,
    temperature: Number($("temperature").value),
  });
}

async function handleSend() {
  const text = $("input").value;
  if (!text.trim()) return;

  syncAgentConfig();

  // Optimistic render user message (no usage yet)
  const optimisticUser = {
    role: "user",
    text,
    at: new Date().toISOString(),
  };
  agent.history.push(optimisticUser);
  agent._emitStateChanged();

  renderHistory(agent.history);

  $("input").value = "";
  $("input").focus();

  setBusy(true);

  // Typing placeholder
  const typing = document.createElement("div");
  typing.className = "msg assistant";
  typing.innerHTML = `
    <div class="meta">
      <span class="badge">ASSISTANT</span>
      <span class="time">${formatTime()}</span>
    </div>
    <div class="text">…</div>
  `;
  $("messages").appendChild(typing);
  $("messages").scrollTop = $("messages").scrollHeight;

  try {
    // Remove optimisticUser because agent.send will add "real" user message with stats
    agent.history.pop();
    agent._emitStateChanged();

    const result = await agent.send(text);

    typing.remove();
    renderHistory(agent.history);
  } catch (err) {
    typing.remove();

    // If send failed, keep the optimistic user message in history (already there?) — we removed it before send.
    // Let's add it back with no stats.
    agent.history.push(optimisticUser);
    agent._emitStateChanged();

    const totals = computeHistoryTotals(agent.history);
    addMessage(
      {
        role: "assistant",
        text: `Ошибка: ${err && err.message ? err.message : String(err)}`,
        meta: {
          statsLines: messageStatsLines(
            { role: "assistant", text: "", ...optimisticUser },
            totals,
          ),
        },
      },
      totals,
    );
    renderTotalsBar(totals);
  } finally {
    setBusy(false);
  }
}

$("send").addEventListener("click", handleSend);

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

$("newChat").addEventListener("click", () => {
  agent.reset();
  clearState();
  $("messages").innerHTML = "";
  addMessage({
    role: "assistant",
    text: "Новый чат создан. История очищена (включая сохранённый JSON в localStorage).",
    meta: { statsLines: [] },
  });
  renderTotalsBar({
    requestInputTokens: 0,
    requestOutputTokens: 0,
    requestTotalTokens: 0,
    costRub: 0,
  });
});

["baseUrl", "apiKey", "model", "temperature"].forEach((id) => {
  $(id).addEventListener("change", syncAgentConfig);
});
