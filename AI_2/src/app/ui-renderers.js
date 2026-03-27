import { $ } from "./utils.js";

function makeChatSubtitle(chat) {
  const activeBranch =
    chat &&
    chat.branching &&
    Array.isArray(chat.branching.branches)
      ? chat.branching.branches.find((branch) => branch.id === chat.branching.activeBranchId) ||
        chat.branching.branches[0]
      : null;
  const state =
    activeBranch && activeBranch.state && typeof activeBranch.state === "object"
      ? activeBranch.state
      : chat && chat.state && typeof chat.state === "object"
        ? chat.state
        : {};
  const history = Array.isArray(state.history) ? state.history : [];
  const lastMessage = history.length > 0 ? history[history.length - 1] : null;
  const raw = lastMessage && typeof lastMessage.text === "string" ? lastMessage.text.trim() : "";
  if (!raw) return "Чат пуст";
  return raw.replace(/\s+/g, " ");
}

function renderChatList(chats, activeChatId) {
  const list = $("chatList");
  if (!list) return;
  list.innerHTML = "";
  for (const chat of [...chats].reverse()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `chat-list-item${chat.id === activeChatId ? " active" : ""}`;
    item.dataset.chatId = chat.id;
    item.dataset.chatAction = "select";
    item.innerHTML = `
      <span class="chat-list-title">${chat.title}</span>
      <span class="chat-list-subtitle">${makeChatSubtitle(chat)}</span>
    `;
    list.appendChild(item);
  }
  $("deleteChat").disabled = chats.length <= 1;
}

function renderProfileMenu(profiles, activeProfileId) {
  const menu = $("profileMenu");
  const trigger = $("profileMenuTrigger");
  const list = $("profileMenuList");
  const createBtn = $("profileMenuCreate");
  if (!menu || !trigger || !list || !createBtn) return;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || profiles[0] || null;
  trigger.textContent = `Профиль: ${activeProfile ? activeProfile.name : "—"}`;
  list.innerHTML = "";
  for (const profile of profiles) {
    const row = document.createElement("div");
    row.className = "profile-menu-item";
    row.innerHTML = `<button type="button" class="profile-select-btn${profile.id === activeProfileId ? " active" : ""}" data-profile-id="${profile.id}" data-profile-action="select">${profile.name}</button>`;
    if (profile.id !== activeProfileId && profiles.length > 1) {
      row.insertAdjacentHTML("beforeend", `<button type="button" class="profile-delete-btn" data-profile-id="${profile.id}" data-profile-action="delete">Удалить</button>`);
    }
    list.appendChild(row);
  }
}

function renderInvariantControls(agent) {
  const select = $("invariantSelect");
  const removeBtn = $("removeInvariant");
  if (!select || !agent) return;
  const invariants = Array.isArray(agent.invariants) ? agent.invariants : [];
  const prevValue = select.value;
  select.innerHTML = "";
  for (const invariant of invariants) {
    const option = document.createElement("option");
    option.value = invariant;
    option.textContent = invariant;
    select.appendChild(option);
  }
  select.value = invariants.some((item) => item === prevValue) ? prevValue : invariants[0] || "";
  if (removeBtn) removeBtn.disabled = invariants.length === 0;
}

function setBatchRunStatus(text, tone = "idle") {
  const el = $("batchRunStatus");
  if (!el) return;
  const normalizedText = String(text || "").trim();
  el.hidden = !normalizedText;
  el.textContent = normalizedText;
  el.classList.remove("is-error", "is-success");
  if (tone === "error") el.classList.add("is-error");
  if (tone === "success") el.classList.add("is-success");
}

function setLlmConfigTestStatus(state = "idle", detail = "") {
  const el = $("llmConfigTestStatus");
  if (!el) return;
  const normalizedState = String(state || "idle").trim() || "idle";
  const normalizedDetail = String(detail || "").trim();
  el.hidden = false;
  el.textContent = normalizedDetail
    ? `Status: ${normalizedState} • ${normalizedDetail}`
    : `Status: ${normalizedState}`;
  el.classList.remove("is-error", "is-success");
  if (normalizedState === "error") el.classList.add("is-error");
  if (normalizedState === "done") el.classList.add("is-success");
}

function setLlmConfigTestDownloadState(ready, filename = "") {
  const button = $("downloadLlmConfigTestReport");
  if (!button) return;
  button.hidden = !ready;
  button.disabled = !ready;
  button.textContent = ready && filename
    ? `Download report: ${filename}`
    : "Download markdown report";
}

export {
  renderChatList,
  renderInvariantControls,
  renderProfileMenu,
  setBatchRunStatus,
  setLlmConfigTestDownloadState,
  setLlmConfigTestStatus,
};
