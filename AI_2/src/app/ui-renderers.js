import { $ } from "./utils.js";

function renderChatSelector(chats, activeChatId) {
  const select = $("chatSelect");
  select.innerHTML = "";
  for (const chat of chats) {
    const option = document.createElement("option");
    option.value = chat.id;
    option.textContent = chat.title;
    select.appendChild(option);
  }
  select.value = activeChatId;
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

export { renderChatSelector, renderInvariantControls, renderProfileMenu, setBatchRunStatus };
