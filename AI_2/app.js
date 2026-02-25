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
    const inCost = (inputTokens / 1_000_000) * r.input;
    const outCost = (outputTokens / 1_000_000) * r.output;
    return inCost + outCost;
  },
};

// =====================
// Persistent Storage (JSON in localStorage)
// =====================
const STORAGE_KEY = "simple_agent_chat_v1";

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
  // stateObj -> JSON "file" in localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj, null, 2));
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
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

    this.history = []; // { role: "user"|"assistant", text: "..." }

    this.systemPreamble =
      "Ты полезный ассистент. Отвечай кратко и по делу, если не просят иначе.";

    // callback, который UI может установить, чтобы реагировать на изменения (сохранять)
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
      version: 1,
      savedAt: new Date().toISOString(),
      config: {
        baseUrl: this.baseUrl,
        // ключ обычно НЕ сохраняют. Но пользователь просил "между запусками".
        // Сохранять его в localStorage небезопасно, поэтому по умолчанию НЕ сохраняем.
        // Если хочешь — можно включить вручную в UI.
        apiKey: null,
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
      // apiKey намеренно не подхватываем автоматически (безопасность)
    }

    if (Array.isArray(state.history)) {
      // минимальная валидация
      this.history = state.history
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.text === "string",
        )
        .map((m) => ({ role: m.role, text: m.text }));
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

    // добавляем user в историю и сохраняем
    this.history.push({ role: "user", text: userText });
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

    const usage =
      dto.usage &&
      Number.isFinite(dto.usage.input_tokens) &&
      Number.isFinite(dto.usage.output_tokens) &&
      Number.isFinite(dto.usage.total_tokens)
        ? {
            inputTokens: dto.usage.input_tokens,
            outputTokens: dto.usage.output_tokens,
            totalTokens: dto.usage.total_tokens,
          }
        : null;

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

    const result = {
      answer: answerText,
      model: modelName,
      usage,
      durationSeconds,
      costRub,
    };

    // добавляем assistant в историю и сохраняем
    this.history.push({ role: "assistant", text: answerText });
    this._emitStateChanged();

    return result;
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

function formatTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMessage({ role, text, meta = {} }) {
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

  const textDiv = document.createElement("div");
  textDiv.className = "text";
  textDiv.textContent = text;

  wrap.appendChild(metaRow);
  wrap.appendChild(textDiv);

  if (
    role === "assistant" &&
    (meta.model ||
      meta.usage ||
      meta.durationSeconds != null ||
      meta.costRub != null)
  ) {
    const stats = document.createElement("div");
    stats.className = "stats";

    if (meta.model) {
      const el = document.createElement("span");
      el.textContent = `model: ${meta.model}`;
      stats.appendChild(el);
    }
    if (meta.usage) {
      const el = document.createElement("span");
      el.textContent = `tokens: in ${meta.usage.inputTokens}, out ${meta.usage.outputTokens}, total ${meta.usage.totalTokens}`;
      stats.appendChild(el);
    }
    if (meta.durationSeconds != null) {
      const el = document.createElement("span");
      el.textContent = `duration: ${meta.durationSeconds}s`;
      stats.appendChild(el);
    }
    if (meta.costRub != null) {
      const el = document.createElement("span");
      el.textContent = `cost: ${meta.costRub.toFixed(4)} ₽`;
      stats.appendChild(el);
    }

    wrap.appendChild(stats);
  }

  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function renderHistory(history) {
  $("messages").innerHTML = "";
  for (const m of history) {
    addMessage({ role: m.role, text: m.text });
  }
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

// агент будет сохранять состояние при любом изменении
agent.onStateChanged = (state) => saveState(state);

// восстановление истории/настроек
const persisted = loadState();
if (persisted) {
  agent.importState(persisted);

  // применим восстановленные настройки в UI
  if (persisted.config) {
    if (typeof persisted.config.baseUrl === "string")
      $("baseUrl").value = persisted.config.baseUrl;
    if (typeof persisted.config.model === "string")
      $("model").value = persisted.config.model;
    if (typeof persisted.config.temperature === "number")
      $("temperature").value = String(persisted.config.temperature);
  }

  // отрендерим историю
  if (Array.isArray(persisted.history) && persisted.history.length > 0) {
    renderHistory(agent.history);
  } else {
    addMessage({
      role: "assistant",
      text: "История пуста. Начнём новый диалог.",
    });
  }

  // API key не восстанавливаем автоматически (безопасность)
  addMessage({
    role: "assistant",
    text:
      "Я восстановил контекст из localStorage (JSON). " +
      "Если ты перезагрузила страницу — история сохранена. " +
      "Вставь API key (он не сохраняется) и продолжай.",
  });
} else {
  addMessage({
    role: "assistant",
    text:
      "Привет! Я простой агент. Я сохраняю контекст в localStorage как JSON, " +
      "поэтому после перезагрузки страница продолжит диалог с прежней историей.",
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

  addMessage({ role: "user", text });
  $("input").value = "";
  $("input").focus();

  setBusy(true);

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
    const result = await agent.send(text);

    typing.remove();
    addMessage({
      role: "assistant",
      text: result.answer,
      meta: {
        model: result.model,
        usage: result.usage,
        durationSeconds: result.durationSeconds,
        costRub: result.costRub,
      },
    });

    // агент уже сохранил state через onStateChanged
  } catch (err) {
    typing.remove();
    addMessage({
      role: "assistant",
      text: `Ошибка: ${err && err.message ? err.message : String(err)}`,
    });
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
  clearState(); // очищаем persisted JSON
  $("messages").innerHTML = "";
  addMessage({
    role: "assistant",
    text: "Новый чат создан. История очищена (включая сохранённый JSON в localStorage).",
  });
});

["baseUrl", "apiKey", "model", "temperature"].forEach((id) => {
  $(id).addEventListener("change", syncAgentConfig);
});
