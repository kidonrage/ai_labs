import { Agent } from "./agent.js";
import { loadState, saveState } from "./storage.js";
import { computeHistoryTotals, mergeTotals, formatTime } from "./helpers.js";
import {
  addMessage,
  renderHistory,
  renderTotalsBar,
  setBusy,
  messageStatsLines,
} from "./ui.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_CONTEXT_STRATEGY = "sticky_facts";
const CONTEXT_STRATEGIES = new Set([
  "sliding_window",
  "sticky_facts",
  "branching",
]);
const privateConfig = await loadPrivateConfig();
const privateApiKey = getPrivateApiKey(privateConfig);

function normalizeContextStrategy(value) {
  return CONTEXT_STRATEGIES.has(value) ? value : DEFAULT_CONTEXT_STRATEGY;
}

function contextStrategyLabel(value) {
  const strategy = normalizeContextStrategy(value);
  if (strategy === "sliding_window") return "Sliding Window";
  if (strategy === "branching") return "Branching (ветки диалога)";
  return "Sticky Facts / Key-Value Memory";
}

async function loadPrivateConfig() {
  try {
    const mod = await import("./private.config.js");
    return (mod && mod.PRIVATE_APP_CONFIG) || {};
  } catch {
    return {};
  }
}

function getPrivateApiKey(cfg) {
  return cfg && typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
}

function getEffectiveApiKey() {
  return privateApiKey;
}

function makeChatId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `chat_${Date.now()}_${Math.random()}`;
}

function defaultTotals() {
  return {
    requestInputTokens: 0,
    requestOutputTokens: 0,
    requestTotalTokens: 0,
    costRub: 0,
  };
}

function normalizeStore(raw, fallbackConfig) {
  if (raw && Array.isArray(raw.chats) && typeof raw.activeChatId === "string") {
    const chats = raw.chats
      .filter((c) => c && typeof c.id === "string" && c.state)
      .map((c) => ({
        id: c.id,
        title: typeof c.title === "string" && c.title.trim() ? c.title : "Чат",
        contextStrategy: normalizeContextStrategy(c.contextStrategy),
        createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date().toISOString(),
        updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : new Date().toISOString(),
        state: c.state,
      }));

    if (chats.length > 0) {
      const hasActive = chats.some((c) => c.id === raw.activeChatId);
      return {
        version: 1,
        activeChatId: hasActive ? raw.activeChatId : chats[0].id,
        chats,
      };
    }
  }

  // migrate old single-chat state format
  if (raw && typeof raw === "object" && Array.isArray(raw.history) && raw.config) {
    return {
      version: 1,
      activeChatId: "chat_1",
      chats: [
        {
          id: "chat_1",
          title: "Чат 1",
          contextStrategy: DEFAULT_CONTEXT_STRATEGY,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: raw,
        },
      ],
    };
  }

  const initialAgent = new Agent({
    baseUrl: fallbackConfig.baseUrl,
    apiKey: "",
    model: fallbackConfig.model,
    temperature: fallbackConfig.temperature,
  });

  return {
    version: 1,
    activeChatId: "chat_1",
    chats: [
      {
        id: "chat_1",
        title: "Чат 1",
        contextStrategy: DEFAULT_CONTEXT_STRATEGY,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: initialAgent.exportState(),
      },
    ],
  };
}

function nextChatTitle(chats) {
  let maxNum = 0;
  for (const c of chats) {
    const m = /^Чат\s+(\d+)$/i.exec(c.title || "");
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  return `Чат ${maxNum + 1}`;
}

const persisted = loadState();

const fallbackConfig = {
  baseUrl: $("baseUrl").value,
  model: $("model").value,
  temperature: Number($("temperature").value),
};

let store = normalizeStore(persisted, fallbackConfig);
let activeChatId = store.activeChatId;
let agent = null;
let defaultNewChatStrategy = DEFAULT_CONTEXT_STRATEGY;

function persistStore() {
  store.activeChatId = activeChatId;
  saveState(store);
}

function getActiveChat() {
  return store.chats.find((c) => c.id === activeChatId) || null;
}

function renderChatSelector() {
  const select = $("chatSelect");
  select.innerHTML = "";

  for (const chat of store.chats) {
    const opt = document.createElement("option");
    opt.value = chat.id;
    opt.textContent = chat.title;
    select.appendChild(opt);
  }

  select.value = activeChatId;
  $("deleteChat").disabled = store.chats.length <= 1;
}

function bindAgentToActiveChat() {
  const chat = getActiveChat();
  if (!chat) return;
  const contextStrategy = normalizeContextStrategy(chat.contextStrategy);
  const activeStrategyInput = $("activeChatContextStrategy");
  if (activeStrategyInput) {
    activeStrategyInput.value = contextStrategyLabel(contextStrategy);
  }

  const currentApiKey = getEffectiveApiKey();
  const chatConfig = (chat.state && chat.state.config) || {};

  agent = new Agent({
    baseUrl: typeof chatConfig.baseUrl === "string" ? chatConfig.baseUrl : fallbackConfig.baseUrl,
    apiKey: currentApiKey,
    model: typeof chatConfig.model === "string" ? chatConfig.model : fallbackConfig.model,
    temperature: Number.isFinite(chatConfig.temperature)
      ? chatConfig.temperature
      : fallbackConfig.temperature,
  });

  agent.onStateChanged = (state) => {
    chat.state = state;
    chat.updatedAt = new Date().toISOString();
    persistStore();

    const historyTotals = computeHistoryTotals(state.history || []);
    const globalTotals = mergeTotals(
      historyTotals,
      state.summaryTotals || agent.summaryTotals,
    );
    renderTotalsBar(globalTotals);
  };

  if (chat.state) {
    agent.importState(chat.state);
  }
  agent.setContextStrategy(contextStrategy);

  if (chat.state && chat.state.config) {
    if (typeof chat.state.config.baseUrl === "string") {
      $("baseUrl").value = chat.state.config.baseUrl;
    }
    if (typeof chat.state.config.model === "string") {
      $("model").value = chat.state.config.model;
    }
    if (typeof chat.state.config.temperature === "number") {
      $("temperature").value = String(chat.state.config.temperature);
    }
  }

  if (Array.isArray(agent.history) && agent.history.length > 0) {
    renderHistory(agent.history, agent.summaryTotals, agent.summaries, {
      contextStrategy,
      keepLastMessages: agent.contextPolicy.keepLastMessages,
    });
  } else {
    $("messages").innerHTML = "";
    addMessage({
      role: "assistant",
      text: "Чат пуст. Напиши первое сообщение.",
      meta: { statsLines: [] },
    });
    renderTotalsBar(mergeTotals(defaultTotals(), agent.summaryTotals));
  }
}

function switchToChat(chatId) {
  if (!store.chats.some((c) => c.id === chatId)) return;
  activeChatId = chatId;
  renderChatSelector();
  bindAgentToActiveChat();
  persistStore();
}

function createChat(strategyValue) {
  const currentApiKey = getEffectiveApiKey();
  const chatId = makeChatId();
  const selectedStrategy = normalizeContextStrategy(strategyValue);

  const newAgent = new Agent({
    baseUrl: $("baseUrl").value.trim(),
    apiKey: currentApiKey,
    model: $("model").value,
    temperature: Number($("temperature").value),
  });

  const chat = {
    id: chatId,
    title: nextChatTitle(store.chats),
    contextStrategy: selectedStrategy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: newAgent.exportState(),
  };

  store.chats.push(chat);
  switchToChat(chatId);

  addMessage({
    role: "assistant",
    text: `Новый независимый чат создан. Стратегия: ${contextStrategyLabel(selectedStrategy)}.`,
    meta: { statsLines: [] },
  });
}

function chooseNewChatStrategy() {
  const dialog = $("newChatDialog");
  const select = $("newChatDialogStrategy");
  const cancelBtn = $("cancelNewChatDialog");

  if (!dialog || !select || typeof dialog.showModal !== "function") {
    return Promise.resolve(defaultNewChatStrategy);
  }

  select.value = normalizeContextStrategy(defaultNewChatStrategy);

  return new Promise((resolve) => {
    const onClose = () => {
      const isCreate = dialog.returnValue === "create";
      const chosen = isCreate ? normalizeContextStrategy(select.value) : null;
      if (chosen) defaultNewChatStrategy = chosen;

      dialog.removeEventListener("close", onClose);
      cancelBtn?.removeEventListener("click", onCancel);
      resolve(chosen);
    };

    const onCancel = () => {
      dialog.close("cancel");
    };

    dialog.addEventListener("close", onClose);
    cancelBtn?.addEventListener("click", onCancel);
    dialog.showModal();
  });
}

function renameActiveChat() {
  const chat = getActiveChat();
  if (!chat) return;

  const nextTitleRaw = window.prompt("Новое имя чата:", chat.title || "");
  if (nextTitleRaw == null) return;

  const nextTitle = nextTitleRaw.trim();
  if (!nextTitle) {
    window.alert("Имя чата не может быть пустым.");
    return;
  }

  const normalized = nextTitle.slice(0, 60);
  chat.title = normalized;
  chat.updatedAt = new Date().toISOString();
  renderChatSelector();
  persistStore();
}

function deleteActiveChat() {
  if (store.chats.length <= 1) return;

  const idx = store.chats.findIndex((c) => c.id === activeChatId);
  if (idx < 0) return;

  store.chats.splice(idx, 1);
  const next = store.chats[Math.max(0, idx - 1)] || store.chats[0];
  activeChatId = next.id;
  switchToChat(activeChatId);
}

function syncAgentConfig() {
  if (!agent) return;
  agent.setConfig({
    baseUrl: $("baseUrl").value.trim(),
    apiKey: getEffectiveApiKey(),
    model: $("model").value,
    temperature: Number($("temperature").value),
  });
}

async function handleSend() {
  const text = $("input").value;
  if (!text.trim() || !agent) return;

  syncAgentConfig();

  // Optimistic render
  const optimisticUser = {
    role: "user",
    text,
    at: new Date().toISOString(),
  };
  agent.history.push(optimisticUser);
  agent._emitStateChanged();

  const chat = getActiveChat();
  renderHistory(agent.history, agent.summaryTotals, agent.summaries, {
    contextStrategy: normalizeContextStrategy(chat && chat.contextStrategy),
    keepLastMessages: agent.contextPolicy.keepLastMessages,
  });

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
    // Remove optimistic
    agent.history.pop();
    agent._emitStateChanged();

    await agent.send(text);

    typing.remove();
    const chat = getActiveChat();
    renderHistory(agent.history, agent.summaryTotals, agent.summaries, {
      contextStrategy: normalizeContextStrategy(chat && chat.contextStrategy),
      keepLastMessages: agent.contextPolicy.keepLastMessages,
    });
  } catch (err) {
    typing.remove();

    // Restore optimistic message
    agent.history.push(optimisticUser);
    agent._emitStateChanged();

    const historyTotals = computeHistoryTotals(agent.history);
    const globalTotals = mergeTotals(historyTotals, agent.summaryTotals);

    addMessage({
      role: "assistant",
      text: `Ошибка: ${err && err.message ? err.message : String(err)}`,
      meta: {
        statsLines: messageStatsLines(
          { role: "assistant", text: "" },
        ),
      },
    });

    renderTotalsBar(globalTotals);
  } finally {
    setBusy(false);
    renderChatSelector();
  }
}

// Boot
renderChatSelector();
bindAgentToActiveChat();

if (persisted) {
  addMessage({
    role: "assistant",
    text: privateApiKey
      ? "Чаты восстановлены из localStorage. API key загружен из private.config.js."
      : "Чаты восстановлены из localStorage. API key не сохраняется, его нужно вводить заново.",
    meta: { statsLines: [] },
  });
} else {
  addMessage({
    role: "assistant",
    text:
      "Привет! Можно создавать несколько независимых чатов, переключаться между ними, и они сохраняются в localStorage.",
    meta: { statsLines: [] },
  });
}

$("send").addEventListener("click", handleSend);

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

$("newChat").addEventListener("click", async () => {
  const selectedStrategy = await chooseNewChatStrategy();
  if (!selectedStrategy) return;
  createChat(selectedStrategy);
});

$("renameChat").addEventListener("click", () => {
  renameActiveChat();
});

$("deleteChat").addEventListener("click", () => {
  deleteActiveChat();
});

$("chatSelect").addEventListener("change", (e) => {
  switchToChat(e.target.value);
});

["baseUrl", "model", "temperature"].forEach((id) => {
  $(id).addEventListener("change", syncAgentConfig);
});
