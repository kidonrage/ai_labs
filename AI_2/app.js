import { Agent } from "./agent.js";
import { loadState, saveState, clearState } from "./storage.js";
import { computeHistoryTotals, formatTime } from "./helpers.js";
import {
  addMessage,
  renderHistory,
  renderTotalsBar,
  setBusy,
  messageStatsLines,
} from "./ui.js";

const $ = (id) => document.getElementById(id);

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

    await agent.send(text);

    typing.remove();
    renderHistory(agent.history);
  } catch (err) {
    typing.remove();

    // If send failed, keep the optimistic user message in history (we removed it before send).
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
