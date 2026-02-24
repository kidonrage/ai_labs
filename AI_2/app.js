// =====================
// Pricing (₽ per 1M tokens) — как в твоём Swift примере
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
// Agent — отдельная сущность. Инкапсулирует:
// - историю
// - подготовку контекста
// - запрос/ответ
// - парсинг, метрики, стоимость
// =====================
class Agent {
  constructor({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.history = []; // { role: "user"|"assistant", text: "..." }
    // небольшой системный пролог (можно убрать)
    this.systemPreamble =
      "Ты полезный ассистент. Отвечай кратко и по делу, если не просят иначе.";
  }

  setConfig({ baseUrl, apiKey, model, temperature }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
  }

  reset() {
    this.history = [];
  }

  // Формируем контекст: system + вся история + новое сообщение
  buildContextInput(nextUserText) {
    // Простой сериализованный контекст строкой.
    // (В реальных SDK обычно передают массив сообщений, но тут сделаем минимально.)
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

    // Сохраняем пользовательское сообщение в историю сразу (агент — владелец состояния)
    this.history.push({ role: "user", text: userText });

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

    // usage
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

    // duration
    const durationSeconds =
      Number.isFinite(dto.created_at) && Number.isFinite(dto.completed_at)
        ? dto.completed_at - dto.created_at
        : null;

    // cost
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

    // Сохраняем ответ ассистента в историю
    this.history.push({ role: "assistant", text: answerText });

    return result;
  }

  // output[] -> first item where role == "assistant" -> content[] -> first where type == "output_text" -> text
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
// UI helpers
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
// Boot
// =====================
let agent = new Agent({
  baseUrl: $("baseUrl").value,
  apiKey: $("apiKey").value,
  model: $("model").value,
  temperature: $("temperature").value,
});

addMessage({
  role: "assistant",
  text: "Привет! Я простой агент. Напиши сообщение — я отправлю его в LLM и покажу ответ. Историю диалога я храню и добавляю в контекст.",
});

function syncAgentConfig() {
  agent.setConfig({
    baseUrl: $("baseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value,
    temperature: $("temperature").value,
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

  // небольшой "typing" placeholder
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
  // Enter — отправить, Shift+Enter — новая строка
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

$("newChat").addEventListener("click", () => {
  agent.reset();
  $("messages").innerHTML = "";
  addMessage({
    role: "assistant",
    text: "Новый чат создан. История очищена — начнём заново.",
  });
});

// если меняют настройки — применяем перед следующим запросом
["baseUrl", "apiKey", "model", "temperature"].forEach((id) => {
  $(id).addEventListener("change", syncAgentConfig);
});
