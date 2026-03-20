import { Agent } from "./agent.js";
import {
  defaultModelForApiMode,
  defaultEndpointForApiMode,
  endpointForApiMode,
  inferApiMode,
} from "./api-profiles.js";
import { getRagModeConfig } from "./rag.js";
import {
  DEFAULT_RAG_MODE,
  normalizeRagMode,
  RAG_MODE_OPTIONS,
} from "./rag-modes.js";
import {
  buildBatchMarkdownReport,
  buildBatchReportFilename,
  downloadMarkdownFile,
  MARKDOWN_EXPORT_QUESTIONS,
  RAG_TEST_MODES,
  runRagBatch,
  TEST_QUESTIONS,
} from "./rag-batch.js";
import { loadState, saveState } from "./storage.js";
import {
  computeHistoryTotals,
  mergeTotals,
  formatTime,
  shouldRestoreOptimisticUserMessage,
} from "./helpers.js";
import {
  addMessage,
  renderHistory,
  renderFactsPanel,
  renderInvariantPanel,
  renderRagPanel,
  renderTaskStatus,
  renderTotalsBar,
  setBusy,
} from "./ui.js";

const $ = (id) => document.getElementById(id);
const privateConfig = await loadPrivateConfig();
const privateApiKey = getPrivateApiKey(privateConfig);

populateRagModeSelect();

async function loadPrivateConfig() {
  try {
    const mod = await import("./config/private.config.js");
    return (mod && mod.PRIVATE_APP_CONFIG) || {};
  } catch {
    return {};
  }
}

function getPrivateApiKey(cfg) {
  return cfg && typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
}

function populateRagModeSelect() {
  const select = $("ragRetrievalMode");
  if (!select) return;

  select.innerHTML = RAG_MODE_OPTIONS.map(
    (option) => `<option value="${option.value}">${option.label}</option>`,
  ).join("");
  select.value = DEFAULT_RAG_MODE;
}

function pickRagConfigOverrides(source) {
  const raw = source && typeof source === "object" ? source : {};
  return {
    indexUrl: raw.indexUrl,
    embeddingApiUrl: raw.embeddingApiUrl,
    embeddingModel: raw.embeddingModel,
    minSimilarity: raw.minSimilarity,
    answerMinSimilarity: raw.answerMinSimilarity,
    forceIDontKnowOnWeakContext: raw.forceIDontKnowOnWeakContext,
    rewriteApiMode: raw.rewriteApiMode,
    rewriteBaseUrl: raw.rewriteBaseUrl,
    rewriteModel: raw.rewriteModel,
    rewriteTemperature: raw.rewriteTemperature,
  };
}

function buildRagConfigFromUi(baseConfig = {}) {
  const selectedMode = normalizeRagMode($("ragRetrievalMode")?.value);
  return {
    ...getRagModeConfig(selectedMode, pickRagConfigOverrides(baseConfig)),
    enabled: $("ragEnabled")?.value === "on",
  };
}

function syncRagControlsFromAgent(boundAgent) {
  const ragConfig =
    boundAgent && boundAgent.ragConfig && typeof boundAgent.ragConfig === "object"
      ? boundAgent.ragConfig
      : {};
  const enabledSelect = $("ragEnabled");
  const modeSelect = $("ragRetrievalMode");
  if (enabledSelect) {
    enabledSelect.value = ragConfig.enabled ? "on" : "off";
  }
  if (modeSelect) {
    modeSelect.value = normalizeRagMode(ragConfig.mode);
  }
}

function getEffectiveApiKey() {
  return privateApiKey;
}

function makeChatId() {
  return (
    (crypto.randomUUID && crypto.randomUUID()) ||
    `chat_${Date.now()}_${Math.random()}`
  );
}

function makeBranchId() {
  return (
    (crypto.randomUUID && crypto.randomUUID()) ||
    `branch_${Date.now()}_${Math.random()}`
  );
}

function makeProfileId() {
  return (
    (crypto.randomUUID && crypto.randomUUID()) ||
    `profile_${Date.now()}_${Math.random()}`
  );
}

function clonePlain(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeProfile(profile, index = 0) {
  const baseName = `Профиль ${index + 1}`;
  const raw = profile && typeof profile === "object" ? profile : {};
  const normalizeString = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : "";
  const normalizeArray = (arr) =>
    Array.from(
      new Set(
        (Array.isArray(arr) ? arr : [])
          .filter((x) => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    );

  const style = normalizeString(raw.style) || "Кратко, по делу, без воды.";
  const format =
    normalizeString(raw.format) ||
    "Структурированный ответ с заголовками при необходимости.";
  const constraints = normalizeArray(raw.constraints);
  const now = new Date().toISOString();

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : makeProfileId(),
    name: normalizeString(raw.name) || baseName,
    style,
    format,
    constraints,
    createdAt: normalizeString(raw.createdAt) || now,
    updatedAt: normalizeString(raw.updatedAt) || now,
  };
}

function normalizeProfiles(rawProfiles) {
  const normalized = (Array.isArray(rawProfiles) ? rawProfiles : [])
    .map((p, idx) => normalizeProfile(p, idx))
    .filter((p) => typeof p.id === "string" && p.id);
  if (normalized.length > 0) return normalized;
  return [normalizeProfile({ id: "profile_default", name: "Стандартный" }, 0)];
}

function defaultTotals() {
  return {
    requestInputTokens: 0,
    requestOutputTokens: 0,
    requestTotalTokens: 0,
    costRub: 0,
  };
}

function makeDefaultBranching(baseState) {
  const now = new Date().toISOString();
  const branchId = makeBranchId();
  return {
    activeBranchId: branchId,
    selectedCheckpointId: null,
    branches: [
      {
        id: branchId,
        title: "Ветка 1",
        parentBranchId: null,
        parentCheckpointId: null,
        createdAt: now,
        updatedAt: now,
        state: clonePlain(baseState),
      },
    ],
    checkpoints: [],
  };
}

function normalizeBranching(rawBranching, fallbackState) {
  const now = new Date().toISOString();
  const fallback =
    fallbackState && typeof fallbackState === "object"
      ? clonePlain(fallbackState)
      : {};

  if (rawBranching && typeof rawBranching === "object") {
    const normalizedBranches = Array.isArray(rawBranching.branches)
      ? rawBranching.branches
          .filter((b) => b && typeof b.id === "string")
          .map((b, idx) => ({
            id: b.id,
            title:
              typeof b.title === "string" && b.title.trim()
                ? b.title.trim()
                : `Ветка ${idx + 1}`,
            parentBranchId:
              typeof b.parentBranchId === "string" ? b.parentBranchId : null,
            parentCheckpointId:
              typeof b.parentCheckpointId === "string"
                ? b.parentCheckpointId
                : null,
            createdAt: typeof b.createdAt === "string" ? b.createdAt : now,
            updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : now,
            state:
              b.state && typeof b.state === "object"
                ? clonePlain(b.state)
                : clonePlain(fallback),
          }))
      : [];

    if (normalizedBranches.length > 0) {
      const activeBranchId = normalizedBranches.some(
        (b) => b.id === rawBranching.activeBranchId,
      )
        ? rawBranching.activeBranchId
        : normalizedBranches[0].id;

      const checkpoints = Array.isArray(rawBranching.checkpoints)
        ? rawBranching.checkpoints
            .filter(
              (cp) =>
                cp &&
                typeof cp.id === "string" &&
                typeof cp.branchId === "string",
            )
            .filter((cp) =>
              normalizedBranches.some((b) => b.id === cp.branchId),
            )
            .map((cp, idx) => ({
              id: cp.id,
              title:
                typeof cp.title === "string" && cp.title.trim()
                  ? cp.title.trim()
                  : `Checkpoint ${idx + 1}`,
              branchId: cp.branchId,
              createdAt: typeof cp.createdAt === "string" ? cp.createdAt : now,
              messageCount: Number.isFinite(cp.messageCount)
                ? cp.messageCount
                : 0,
              state:
                cp.state && typeof cp.state === "object"
                  ? clonePlain(cp.state)
                  : clonePlain(fallback),
            }))
        : [];

      const selectedCheckpointId = checkpoints.some(
        (cp) => cp.id === rawBranching.selectedCheckpointId,
      )
        ? rawBranching.selectedCheckpointId
        : null;

      return {
        activeBranchId,
        selectedCheckpointId,
        branches: normalizedBranches,
        checkpoints,
      };
    }
  }

  return makeDefaultBranching(fallback);
}

function normalizeStore(raw, fallbackConfig) {
  const normalizeLongTerm = (value) => Agent.normalizeLongTermMemory(value);

  if (raw && Array.isArray(raw.chats) && typeof raw.activeChatId === "string") {
    const chats = raw.chats
      .filter((c) => c && typeof c.id === "string")
      .map((c) => {
        const legacyState =
          c.state && typeof c.state === "object" ? c.state : null;
        const branching = normalizeBranching(c.branching, legacyState || {});
        const activeBranch =
          branching.branches.find((b) => b.id === branching.activeBranchId) ||
          branching.branches[0];

        return {
          id: c.id,
          title:
            typeof c.title === "string" && c.title.trim() ? c.title : "Чат",
          createdAt:
            typeof c.createdAt === "string"
              ? c.createdAt
              : new Date().toISOString(),
          updatedAt:
            typeof c.updatedAt === "string"
              ? c.updatedAt
              : new Date().toISOString(),
          state: clonePlain(activeBranch.state),
          branching,
        };
      });

    if (chats.length > 0) {
      const hasActive = chats.some((c) => c.id === raw.activeChatId);
      const profiles = normalizeProfiles(raw.profiles);
      const hasActiveProfile = profiles.some(
        (p) => p.id === raw.activeProfileId,
      );
      return {
        version: 4,
        longTermMemory: normalizeLongTerm(raw.longTermMemory),
        activeChatId: hasActive ? raw.activeChatId : chats[0].id,
        activeProfileId: hasActiveProfile
          ? raw.activeProfileId
          : profiles[0].id,
        profiles,
        chats,
      };
    }
  }

  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray(raw.history) &&
    raw.config
  ) {
    const branching = normalizeBranching(null, raw);
    return {
      version: 4,
      longTermMemory: normalizeLongTerm(raw.longTermMemory),
      activeChatId: "chat_1",
      activeProfileId: "profile_default",
      profiles: [
        normalizeProfile({ id: "profile_default", name: "Стандартный" }, 0),
      ],
      chats: [
        {
          id: "chat_1",
          title: "Чат 1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: clonePlain(raw),
          branching,
        },
      ],
    };
  }

  const initialAgent = new Agent({
    apiMode: fallbackConfig.apiMode,
    baseUrl: fallbackConfig.baseUrl,
    apiKey: "",
    model: fallbackConfig.model,
    temperature: fallbackConfig.temperature,
  });

  const initialState = initialAgent.exportState();
  const branching = normalizeBranching(null, initialState);

  return {
    version: 4,
    longTermMemory: normalizeLongTerm(raw && raw.longTermMemory),
    activeChatId: "chat_1",
    activeProfileId: "profile_default",
    profiles: [
      normalizeProfile({ id: "profile_default", name: "Стандартный" }, 0),
    ],
    chats: [
      {
        id: "chat_1",
        title: "Чат 1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: clonePlain(initialState),
        branching,
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
  apiMode: inferApiMode($("apiMode").value, $("baseUrl").value),
  baseUrl: endpointForApiMode(
    $("apiMode").value,
    $("baseUrl").value,
  ),
  model: defaultModelForApiMode(
    inferApiMode($("apiMode").value, $("baseUrl").value),
    $("model").value,
  ),
  temperature: Number($("temperature").value),
};

let store = normalizeStore(persisted, fallbackConfig);
let activeChatId = store.activeChatId;
let activeProfileId = store.activeProfileId;
let agent = null;
let isSending = false;
let isBatchRunning = false;

function isUiBusy() {
  return isSending || isBatchRunning;
}

function setBatchRunStatus(text, tone = "idle") {
  const el = $("batchRunStatus");
  if (!el) return;

  const normalizedText = String(text || "").trim();
  el.hidden = !normalizedText;
  el.textContent = normalizedText;
  el.classList.remove("is-error", "is-success");
  if (tone === "error") {
    el.classList.add("is-error");
  } else if (tone === "success") {
    el.classList.add("is-success");
  }
}

function persistStore() {
  store.activeChatId = activeChatId;
  store.activeProfileId = activeProfileId;
  saveState(store);
}

function getActiveChat() {
  return store.chats.find((c) => c.id === activeChatId) || null;
}

function getActiveProfile() {
  return (
    store.profiles.find((p) => p.id === activeProfileId) ||
    store.profiles[0] ||
    null
  );
}

function renderProfileMenu() {
  const menu = $("profileMenu");
  const trigger = $("profileMenuTrigger");
  const list = $("profileMenuList");
  const createBtn = $("profileMenuCreate");
  if (!menu || !trigger || !list || !createBtn) return;

  const selected = store.profiles.some((p) => p.id === activeProfileId)
    ? activeProfileId
    : store.profiles[0]
      ? store.profiles[0].id
      : "";
  activeProfileId = selected;

  const activeProfile = getActiveProfile();
  trigger.textContent = `Профиль: ${activeProfile ? activeProfile.name : "—"}`;
  list.innerHTML = "";

  for (const profile of store.profiles) {
    const row = document.createElement("div");
    row.className = "profile-menu-item";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = `profile-select-btn${profile.id === activeProfileId ? " active" : ""}`;
    selectBtn.textContent = profile.name;
    selectBtn.dataset.profileId = profile.id;
    selectBtn.dataset.profileAction = "select";
    row.appendChild(selectBtn);

    if (profile.id !== activeProfileId && store.profiles.length > 1) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "profile-delete-btn";
      deleteBtn.textContent = "Удалить";
      deleteBtn.dataset.profileId = profile.id;
      deleteBtn.dataset.profileAction = "delete";
      row.appendChild(deleteBtn);
    }

    list.appendChild(row);
  }
}

function getActiveBranch(chat) {
  const currentChat = chat || getActiveChat();
  if (!currentChat) return null;

  currentChat.branching = normalizeBranching(
    currentChat.branching,
    currentChat.state || {},
  );
  const branching = currentChat.branching;
  return (
    branching.branches.find((b) => b.id === branching.activeBranchId) ||
    branching.branches[0] ||
    null
  );
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

function renderInvariantControls() {
  const select = $("invariantSelect");
  const removeBtn = $("removeInvariant");
  if (!select || !agent) return;

  const invariants = Array.isArray(agent.invariants) ? agent.invariants : [];
  const prevValue = select.value;
  select.innerHTML = "";

  for (const inv of invariants) {
    if (typeof inv !== "string") continue;
    const opt = document.createElement("option");
    opt.value = inv;
    opt.textContent = inv;
    select.appendChild(opt);
  }

  const hasPrev = invariants.some((inv) => inv === prevValue);
  if (hasPrev) {
    select.value = prevValue;
  } else if (invariants[0]) {
    select.value = invariants[0];
  }

  if (removeBtn) {
    removeBtn.disabled = invariants.length === 0;
  }
}

function promptInvariantDraft() {
  const raw = window.prompt("Текст инварианта:", "");
  if (raw == null) return null;
  const rule = raw.trim();
  if (!rule) {
    window.alert("Правило не может быть пустым.");
    return null;
  }
  return rule.slice(0, 300);
}

function addInvariant() {
  if (!agent) return;
  const draft = promptInvariantDraft();
  if (!draft) return;

  const current = Array.isArray(agent.invariants)
    ? clonePlain(agent.invariants)
    : [];
  const normalizedDraft = draft.toLowerCase();
  if (current.some((inv) => inv.toLowerCase() === normalizedDraft)) {
    window.alert("Такой инвариант уже существует.");
    return;
  }
  current.push(draft);
  agent.setInvariants(current);
  renderInvariantControls();
}

function removeSelectedInvariant() {
  if (!agent) return;
  const select = $("invariantSelect");
  if (!select || !select.value) return;
  const invariant = select.value;
  const ok = window.confirm(`Удалить инвариант "${invariant}"?`);
  if (!ok) return;

  const current = Array.isArray(agent.invariants)
    ? clonePlain(agent.invariants)
    : [];
  const next = current.filter((inv) => inv !== invariant);
  agent.setInvariants(next);
  renderInvariantControls();
}

function profileToAgentPrefs(profile) {
  if (!profile) return null;
  const constraints = Array.isArray(profile.constraints)
    ? profile.constraints
    : [];
  return {
    id: profile.id,
    name: profile.name,
    preferences: {
      style: profile.style,
      format: profile.format,
      constraints,
    },
  };
}

function bindAgentToActiveChat() {
  const chat = getActiveChat();
  if (!chat) return;

  chat.branching = normalizeBranching(chat.branching, chat.state || {});
  const activeBranch = getActiveBranch(chat);
  if (!activeBranch) return;

  const currentApiKey = getEffectiveApiKey();
  const branchState =
    activeBranch.state && typeof activeBranch.state === "object"
      ? activeBranch.state
      : chat.state || {};
  const chatConfig = (branchState && branchState.config) || {};
  const apiMode = inferApiMode(chatConfig.apiMode, chatConfig.baseUrl);

  agent = new Agent({
    apiMode,
    baseUrl:
      typeof chatConfig.baseUrl === "string"
        ? endpointForApiMode(apiMode, chatConfig.baseUrl)
        : fallbackConfig.baseUrl,
    apiKey: currentApiKey,
    model:
      typeof chatConfig.model === "string"
        ? chatConfig.model
        : fallbackConfig.model,
    temperature: Number.isFinite(chatConfig.temperature)
      ? chatConfig.temperature
      : fallbackConfig.temperature,
  });
  const boundAgent = agent;

  if (branchState) {
    boundAgent.loadState(branchState);
  }
  boundAgent.setLongTermMemory(store.longTermMemory);
  boundAgent.setUserProfile(profileToAgentPrefs(getActiveProfile()));
  syncRagControlsFromAgent(boundAgent);

  boundAgent.onStateChanged = (state) => {
    // Ignore stale callbacks from previously bound agent instances.
    if (agent !== boundAgent) return;
    const now = new Date().toISOString();
    const keepLast = Math.max(
      1,
      Number(state?.contextPolicy?.keepLastMessages) || 12,
    );
    store.longTermMemory = clonePlain(boundAgent.exportLongTermMemory());
    const persistedState = clonePlain(boundAgent.persistState());
    activeBranch.state = persistedState;
    activeBranch.updatedAt = now;
    chat.state = persistedState;
    chat.updatedAt = now;
    persistStore();
    renderFactsPanel({
      long_term: store.longTermMemory,
      working: state.workingMemory || boundAgent.workingMemory,
      short_term: state.shortTermMemory || {
        messages: Array.isArray(state.history)
          ? state.history
              .slice(-keepLast)
              .map((m) => ({ role: m.role, content: String(m.text || "") }))
          : [],
      },
    });
    renderInvariantPanel(
      state.invariants || boundAgent.invariants,
      state.lastInvariantCheck || boundAgent.lastInvariantCheck,
    );
    renderRagPanel(state.lastRagResult || boundAgent.lastRagResult);

    const historyTotals = computeHistoryTotals(state.history || []);
    const globalTotals = mergeTotals(
      historyTotals,
      state.summaryTotals || boundAgent.summaryTotals,
    );
    renderTotalsBar(globalTotals);
    renderTaskStatus(state.taskState, { isBusy: isUiBusy() });
    renderInvariantControls();
  };
  renderFactsPanel({
    long_term: store.longTermMemory,
    working: boundAgent.workingMemory,
    short_term: {
      messages: (() => {
        const keepLast = Math.max(
          1,
          Number(boundAgent.contextPolicy.keepLastMessages) || 12,
        );
        return Array.isArray(boundAgent.history)
          ? boundAgent.history
              .slice(-keepLast)
              .map((m) => ({ role: m.role, content: String(m.text || "") }))
          : [];
      })(),
    },
  });
  renderInvariantPanel(boundAgent.invariants, boundAgent.lastInvariantCheck);
  renderRagPanel(boundAgent.lastRagResult);
  renderInvariantControls();

  if (branchState && branchState.config) {
    $("apiMode").value = apiMode;
    if (typeof branchState.config.baseUrl === "string") {
      $("baseUrl").value = endpointForApiMode(apiMode, branchState.config.baseUrl);
    } else {
      $("baseUrl").value = defaultEndpointForApiMode(apiMode);
    }
    if (typeof branchState.config.model === "string") {
      $("model").value = branchState.config.model;
    } else {
      $("model").value = defaultModelForApiMode(apiMode);
    }
    if (typeof branchState.config.temperature === "number") {
      $("temperature").value = String(branchState.config.temperature);
    }
  }

  if (Array.isArray(boundAgent.history) && boundAgent.history.length > 0) {
    renderHistory(
      boundAgent.history,
      boundAgent.summaryTotals,
      {
        keepLastMessages: boundAgent.contextPolicy.keepLastMessages,
      },
    );
  } else {
    $("messages").innerHTML = "";
    addMessage({
      role: "assistant",
      text: "Чат пуст. Напиши первое сообщение.",
      meta: { statsLines: [] },
    });
    renderTotalsBar(mergeTotals(defaultTotals(), boundAgent.summaryTotals));
  }

  renderTaskStatus(boundAgent.taskState, { isBusy: isUiBusy() });
  renderInvariantControls();
}

function switchToChat(chatId) {
  if (!store.chats.some((c) => c.id === chatId)) return;
  activeChatId = chatId;
  renderChatSelector();
  renderProfileMenu();
  bindAgentToActiveChat();
  persistStore();
}

function switchProfile(profileId) {
  if (!store.profiles.some((p) => p.id === profileId)) return;
  activeProfileId = profileId;
  renderProfileMenu();
  if (agent) {
    agent.setUserProfile(profileToAgentPrefs(getActiveProfile()));
  }
  const menu = $("profileMenu");
  if (menu) menu.open = false;
  persistStore();
}

function parseProfileConstraints(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/\n|,|;/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function promptProfileDraft(initial = null) {
  const base = normalizeProfile(initial || {});
  const nameRaw = window.prompt("Имя профиля:", base.name);
  if (nameRaw == null) return null;
  const name = nameRaw.trim();
  if (!name) {
    window.alert("Имя профиля не может быть пустым.");
    return null;
  }

  const styleRaw = window.prompt("Стиль ответа:", base.style);
  if (styleRaw == null) return null;
  const style = styleRaw.trim() || base.style;

  const formatRaw = window.prompt("Формат ответа:", base.format);
  if (formatRaw == null) return null;
  const format = formatRaw.trim() || base.format;

  const constraintsDefault = Array.isArray(base.constraints)
    ? base.constraints.join("; ")
    : "";
  const constraintsRaw = window.prompt(
    "Ограничения (через ; , или с новой строки):",
    constraintsDefault,
  );
  if (constraintsRaw == null) return null;

  return {
    id: base.id,
    name: name.slice(0, 60),
    style: style.slice(0, 300),
    format: format.slice(0, 300),
    constraints: parseProfileConstraints(constraintsRaw).slice(0, 20),
    createdAt: base.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function createProfile() {
  const next = promptProfileDraft({
    name: `Профиль ${store.profiles.length + 1}`,
    style: "Кратко, по делу, без воды.",
    format: "Структурированный ответ с заголовками при необходимости.",
    constraints: [],
  });
  if (!next) return;

  const profile = normalizeProfile(next, store.profiles.length);
  store.profiles.push(profile);
  switchProfile(profile.id);
}

function deleteProfile(profileId) {
  if (store.profiles.length <= 1) return;
  const target = store.profiles.find((p) => p.id === profileId);
  if (!target) return;
  const ok = window.confirm(`Удалить профиль "${target.name}"?`);
  if (!ok) return;

  const idx = store.profiles.findIndex((p) => p.id === target.id);
  if (idx < 0) return;
  store.profiles.splice(idx, 1);

  if (activeProfileId === target.id) {
    const next = store.profiles[Math.max(0, idx - 1)] || store.profiles[0];
    if (next) {
      switchProfile(next.id);
      return;
    }
  }
  renderProfileMenu();
  persistStore();
}

function createChat() {
  const currentApiKey = getEffectiveApiKey();
  const chatId = makeChatId();

  const newAgent = new Agent({
    apiMode: inferApiMode($("apiMode").value, $("baseUrl").value),
    baseUrl: endpointForApiMode($("apiMode").value, $("baseUrl").value),
    apiKey: currentApiKey,
    model: $("model").value,
    temperature: Number($("temperature").value),
  });

  const initialState = newAgent.exportState();

  const chat = {
    id: chatId,
    title: nextChatTitle(store.chats),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: clonePlain(initialState),
    branching: normalizeBranching(null, initialState),
  };

  store.chats.push(chat);
  switchToChat(chatId);

  addMessage({
    role: "assistant",
    text: "Новый независимый чат создан.",
    meta: { statsLines: [] },
  });
}

function createChatFromCurrent() {
  const sourceChat = getActiveChat();
  if (!sourceChat) return;

  const sourceBranch = getActiveBranch(sourceChat);
  const sourceState =
    sourceBranch && sourceBranch.state
      ? clonePlain(sourceBranch.state)
      : agent
        ? clonePlain(agent.exportState())
        : clonePlain(sourceChat.state || {});

  const now = new Date().toISOString();
  const chatId = makeChatId();

  const chat = {
    id: chatId,
    title: nextChatTitle(store.chats),
    createdAt: now,
    updatedAt: now,
    state: clonePlain(sourceState),
    branching: normalizeBranching(null, sourceState),
  };

  store.chats.push(chat);
  switchToChat(chatId);

  addMessage({
    role: "assistant",
    text: "Создан новый чат на основе текущего. Дальше они независимы.",
    meta: { statsLines: [] },
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
    apiMode: inferApiMode($("apiMode").value, $("baseUrl").value),
    baseUrl: endpointForApiMode($("apiMode").value, $("baseUrl").value),
    apiKey: getEffectiveApiKey(),
    model: $("model").value,
    temperature: Number($("temperature").value),
  });
  agent.setRagConfig(buildRagConfigFromUi(agent.ragConfig));
}

function formatBatchProgress(progress) {
  if (!progress || typeof progress !== "object") {
    return "Идет batch-прогон RAG.";
  }

  const questionNumber = Number(progress.questionIndex) + 1;
  const questionCount = Number(progress.questionCount) || TEST_QUESTIONS.length;
  const modeNumber = Number(progress.modeIndex) + 1;
  const modeCount = Number(progress.modeCount) || RAG_TEST_MODES.length;
  const completedRuns = Number(progress.completedRuns) || 0;
  const totalRuns = Number(progress.totalRuns) || questionCount * modeCount;
  const phase = progress.phase === "completed" ? "Завершено" : "Выполняется";

  return `${phase}: вопрос ${questionNumber}/${questionCount}, режим ${modeNumber}/${modeCount}, выполнено ${completedRuns} из ${totalRuns}.`;
}

async function handleRunRagBatch() {
  if (!agent || isUiBusy()) return;

  syncAgentConfig();
  isBatchRunning = true;
  setBusy(isUiBusy());
  setBatchRunStatus("Подготовка batch-прогона RAG...");

  const generatedAt = new Date();
  try {
    const results = await runRagBatch(agent, {
      questions: TEST_QUESTIONS,
      modes: RAG_TEST_MODES,
      onProgress(progress) {
        setBatchRunStatus(formatBatchProgress(progress));
      },
    });

    const markdown = buildBatchMarkdownReport(results, {
      generatedAt,
      questions: MARKDOWN_EXPORT_QUESTIONS,
      modes: RAG_TEST_MODES,
      model: agent.model,
      indexUrl: agent.ragConfig.indexUrl,
      embeddingModel: agent.ragConfig.embeddingModel,
    });
    downloadMarkdownFile(markdown, buildBatchReportFilename(generatedAt));

    const errorCount = results.filter((item) => item.error).length;
    setBatchRunStatus(
      errorCount > 0
        ? `Отчет сформирован и скачан. Ошибок в прогонах: ${errorCount}.`
        : "Отчет сформирован и скачан.",
      errorCount > 0 ? "error" : "success",
    );
  } catch (error) {
    setBatchRunStatus(
      `Batch-прогон не завершен: ${error && error.message ? error.message : String(error)}`,
      "error",
    );
  } finally {
    isBatchRunning = false;
    setBusy(isUiBusy());
    renderTaskStatus(agent.taskState, { isBusy: isUiBusy() });
  }
}

function parseTaskCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const startMatch = /^start:\s*(.*)$/i.exec(trimmed);
  if (startMatch) {
    const goal = startMatch[1].trim();
    if (!goal) return { type: "start_empty" };
    return { type: "start", goal };
  }
  if (/^pause$/i.test(trimmed)) return { type: "pause" };
  if (/^continue$/i.test(trimmed)) return { type: "continue" };
  if (/^approve$/i.test(trimmed)) return { type: "approve" };
  if (/^reset task$/i.test(trimmed)) return { type: "reset_task" };
  return null;
}

function isActiveTaskStage(stage) {
  return (
    stage === "planning" || stage === "execution" || stage === "validation"
  );
}

function pushAssistantMessage(text) {
  if (!agent) return;
  agent.history.push({
    role: "assistant",
    text: String(text || ""),
    at: new Date().toISOString(),
  });
  agent._emitStateChanged();
}

function pushStageChangedMessage(transition) {
  if (!transition || transition.from === transition.to) return;
  pushAssistantMessage(
    `Task stage changed: ${transition.from} -> ${transition.to}`,
  );
}

async function handleTaskCommandOrStep(text) {
  if (!agent) return false;
  const command = parseTaskCommand(text);
  const taskState = agent.taskState || {};
  const stage = typeof taskState.stage === "string" ? taskState.stage : "idle";

  if (command && command.type === "start") {
    const prevStage = stage;
    agent.startTask(command.goal);
    pushStageChangedMessage({ from: prevStage, to: "planning" });
    const result = await agent.runTaskStep({ userMessage: text });
    pushStageChangedMessage(result.transition);
    pushAssistantMessage(result.text);
    return true;
  }

  if (command && command.type === "start_empty") {
    pushAssistantMessage("Формат команды: start: <описание задачи>");
    return true;
  }

  if (command && command.type === "pause") {
    const ok = agent.pauseTask();
    if (!ok) {
      pushAssistantMessage(
        "Пауза недоступна: нет активного шага planning/execution/validation.",
      );
      return true;
    }
    pushStageChangedMessage({ from: stage, to: "paused" });
    pushAssistantMessage("Задача поставлена на паузу.");
    return true;
  }

  if (command && command.type === "continue") {
    const pausedFrom =
      taskState && taskState.pausedFrom ? taskState.pausedFrom : null;
    const resumed = agent.continueTask();
    if (!resumed) {
      pushAssistantMessage("Продолжение недоступно: задача не на паузе.");
      return true;
    }
    const resumedState = agent.taskState || {};
    pushStageChangedMessage({
      from: "paused",
      to: resumedState.stage || "idle",
    });
    if (isActiveTaskStage(resumedState.stage)) {
      if (resumedState.expectedAction === "await_approval") {
        pushAssistantMessage(
          "Восстановлен этап. Можно отправить доработки текущего этапа или approve для перехода дальше.",
        );
      } else {
        const result = await agent.runTaskStep({ userMessage: text });
        pushStageChangedMessage(result.transition);
        pushAssistantMessage(result.text);
      }
    } else {
      pushAssistantMessage(
        pausedFrom
          ? `Продолжение выполнено. Восстановлен этап ${pausedFrom.stage}, шаг ${pausedFrom.step}.`
          : "Продолжение выполнено.",
      );
    }
    return true;
  }

  if (command && command.type === "approve") {
    if (!isActiveTaskStage(stage)) {
      pushAssistantMessage(
        "Подтверждение перехода недоступно: нет активного этапа planning/execution/validation.",
      );
      return true;
    }
    const ok = agent.approveNextStage();
    if (!ok) {
      pushAssistantMessage(
        "Сначала заверши текущий этап (получи артефакт), затем отправь approve.",
      );
      return true;
    }
    const changed = agent.advanceToNextStage();
    pushStageChangedMessage(changed);
    const nextStage = agent.taskState && agent.taskState.stage
      ? agent.taskState.stage
      : "idle";
    if (isActiveTaskStage(nextStage)) {
      pushAssistantMessage(
        `Переход подтверждён. Текущий этап: ${nextStage}. Отправьте сообщение для выполнения шага.`,
      );
    } else {
      pushAssistantMessage("Переход подтверждён. Задача завершена.");
    }
    return true;
  }

  if (command && command.type === "reset_task") {
    const fromStage = stage;
    agent.resetTask();
    pushStageChangedMessage({ from: fromStage, to: "idle" });
    pushAssistantMessage("Task state сброшен в idle, артефакты очищены.");
    return true;
  }

  if (stage === "paused") {
    pushAssistantMessage(
      "Задача на паузе. Используйте continue или кнопку Continue.",
    );
    return true;
  }

  if (isActiveTaskStage(stage)) {
    const result = await agent.runTaskStep({ userMessage: text });
    pushStageChangedMessage(result.transition);
    pushAssistantMessage(result.text);
    return true;
  }

  return false;
}

async function sendTaskControlCommand(commandText) {
  if (!agent || isUiBusy()) return;
  $("input").value = commandText;
  await handleSend();
}

async function handleSend() {
  const text = $("input").value;
  if (!text.trim() || !agent || isUiBusy()) return;

  syncAgentConfig();
  const historyBaselineLength = Array.isArray(agent.history)
    ? agent.history.length
    : 0;

  const optimisticUser = {
    role: "user",
    text,
    at: new Date().toISOString(),
  };
  agent.history.push(optimisticUser);
  agent._emitStateChanged();

  const chat = getActiveChat();
  renderHistory(agent.history, agent.summaryTotals, {
    keepLastMessages: agent.contextPolicy.keepLastMessages,
  });

  $("input").value = "";
  $("input").focus();

  isSending = true;
  setBusy(isUiBusy());

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

  let handedByTaskMachine = false;
  let poppedForRegularSend = false;
  try {
    handedByTaskMachine = await handleTaskCommandOrStep(text);
    if (!handedByTaskMachine) {
      agent.history.pop();
      poppedForRegularSend = true;
      agent._emitStateChanged();
      await agent.send(text);
    }

    typing.remove();
    const activeChat = getActiveChat();
    renderHistory(agent.history, agent.summaryTotals, {
      keepLastMessages: agent.contextPolicy.keepLastMessages,
    });
  } catch (err) {
    typing.remove();

    if (
      poppedForRegularSend &&
      shouldRestoreOptimisticUserMessage(
        Array.isArray(agent.history) ? agent.history.length : 0,
        historyBaselineLength,
      )
    ) {
      agent.history.push(optimisticUser);
    }
    agent.history.push({
      role: "assistant",
      text: `Ошибка: ${err && err.message ? err.message : String(err)}`,
      at: new Date().toISOString(),
    });
    agent._emitStateChanged();

    const activeChat = getActiveChat();
    renderHistory(agent.history, agent.summaryTotals, {
      keepLastMessages: agent.contextPolicy.keepLastMessages,
    });
  } finally {
    isSending = false;
    setBusy(isUiBusy());
    renderTaskStatus(agent.taskState, { isBusy: isUiBusy() });
    renderChatSelector();
  }
}

renderChatSelector();
renderProfileMenu();
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
    text: "Привет! Можно создавать несколько независимых чатов, переключаться между ними, и они сохраняются в localStorage.",
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

$("pauseTask").addEventListener("click", async () => {
  await sendTaskControlCommand("pause");
});

$("continueTask").addEventListener("click", async () => {
  await sendTaskControlCommand("continue");
});

$("newChat").addEventListener("click", () => {
  createChat();
});

$("branchChat").addEventListener("click", () => {
  createChatFromCurrent();
});

$("renameChat").addEventListener("click", () => {
  renameActiveChat();
});

$("deleteChat").addEventListener("click", () => {
  deleteActiveChat();
});

$("runRagBatch").addEventListener("click", async () => {
  await handleRunRagBatch();
});

$("chatSelect").addEventListener("change", (e) => {
  switchToChat(e.target.value);
});

$("ragEnabled").addEventListener("change", () => {
  if (!agent) return;
  agent.setRagConfig(buildRagConfigFromUi(agent.ragConfig));
});

$("ragRetrievalMode").addEventListener("change", () => {
  if (!agent) return;
  agent.setRagConfig(buildRagConfigFromUi(agent.ragConfig));
});

$("profileMenuCreate").addEventListener("click", () => {
  createProfile();
});

$("profileMenuList").addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const profileId = target.dataset.profileId;
  const action = target.dataset.profileAction;
  if (!profileId || !action) return;
  if (action === "select") {
    switchProfile(profileId);
    return;
  }
  if (action === "delete") {
    deleteProfile(profileId);
  }
});

$("addInvariant").addEventListener("click", () => {
  addInvariant();
});

$("removeInvariant").addEventListener("click", () => {
  removeSelectedInvariant();
});

$("apiMode").addEventListener("change", () => {
  const apiMode = inferApiMode($("apiMode").value, $("baseUrl").value);
  $("baseUrl").value = defaultEndpointForApiMode(apiMode);
  $("model").value = defaultModelForApiMode(apiMode);
  syncAgentConfig();
});

["baseUrl", "model", "temperature"].forEach((id) => {
  $(id).addEventListener("change", syncAgentConfig);
});
