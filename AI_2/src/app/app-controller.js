import { defaultEndpointForApiMode, defaultModelForApiMode, endpointForApiMode, inferApiMode } from "../api-profiles.js";
import { addMessage, setBusy } from "../ui.js";
import { ChatRepository } from "./chat-repository.js";
import { ChatSessionController } from "./chat-session-controller.js";
import { ComposerController } from "./composer-controller.js";
import { getPrivateApiKey, loadPrivateConfig } from "./private-config.js";
import { ProfileRegistry } from "./profile-registry.js";
import { promptInvariantDraft, promptProfileDraft } from "./prompts.js";
import { buildRagConfigFromUi, populateRagModeSelect, syncRagModeVisibility } from "./rag-config.js";
import { RagBatchController } from "./rag-batch-controller.js";
import { renderChatList, renderInvariantControls, renderProfileMenu } from "./ui-renderers.js";
import { $, clonePlain } from "./utils.js";
import { WorkspaceStore } from "./workspace-store.js";

class AppController {
  static async bootstrap() {
    const controller = new AppController(await loadPrivateConfig());
    controller.init();
    return controller;
  }

  constructor(privateConfig) {
    this.privateApiKey = getPrivateApiKey(privateConfig);
    this.isSending = false;
    this.isBatchRunning = false;
    populateRagModeSelect();
    this.fallbackConfig = {
      apiMode: inferApiMode($("apiMode").value, $("baseUrl").value),
      baseUrl: endpointForApiMode($("apiMode").value, $("baseUrl").value),
      model: defaultModelForApiMode(inferApiMode($("apiMode").value, $("baseUrl").value), $("model").value),
      temperature: Number($("temperature").value),
    };
    this.repository = new ChatRepository(this.fallbackConfig);
    this.workspace = new WorkspaceStore(this.repository.load(), this.repository);
    this.session = new ChatSessionController({
      workspace: this.workspace,
      fallbackConfig: this.fallbackConfig,
      getEffectiveApiKey: () => this.privateApiKey,
      isUiBusy: () => this.isUiBusy(),
    });
    this.composer = new ComposerController({
      session: this.session,
      isUiBusy: () => this.isUiBusy(),
      setSending: (value) => this.setSending(value),
      renderWorkspaceChrome: () => this.renderWorkspaceChrome(),
    });
    this.ragBatch = new RagBatchController({
      session: this.session,
      isUiBusy: () => this.isUiBusy(),
      setBatchRunning: (value) => this.setBatchRunning(value),
    });
  }

  isUiBusy() { return this.isSending || this.isBatchRunning; }
  setSending(value) { this.isSending = value; setBusy(this.isUiBusy()); }
  setBatchRunning(value) { this.isBatchRunning = value; setBusy(this.isUiBusy()); }
  syncComposerOffset() {
    const composer = document.querySelector(".composer");
    if (!(composer instanceof HTMLElement)) return;
    const height = Math.ceil(composer.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--composer-height", `${height}px`);
  }
  openSettingsDialog() {
    const dialog = $("settingsDialog");
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  closeSettingsDialog() {
    const dialog = $("settingsDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    if ($("profileMenu")) $("profileMenu").open = false;
  }

  renderWorkspaceChrome() {
    renderChatList(this.workspace.store.chats, this.workspace.store.activeChatId);
    renderProfileMenu(this.workspace.store.profiles, this.workspace.store.activeProfileId);
    renderInvariantControls(this.session.agent);
    this.workspace.persist();
  }

  init() {
    this.syncComposerOffset();
    this.renderWorkspaceChrome();
    this.session.bindAgentToActiveChat();
    addMessage({
      role: "assistant",
      text: this.repository.hadPersistedState
        ? this.privateApiKey
          ? "Чаты восстановлены из localStorage. API key загружен из private.config.js."
          : "Чаты восстановлены из localStorage. API key не сохраняется, его нужно вводить заново."
        : "Привет! Можно создавать несколько независимых чатов, переключаться между ними, и они сохраняются в localStorage.",
      meta: { statsLines: [] },
    });
    this.bindEvents();
    if (typeof ResizeObserver === "function") {
      const composer = document.querySelector(".composer");
      if (composer instanceof HTMLElement) {
        this.composerResizeObserver = new ResizeObserver(() => this.syncComposerOffset());
        this.composerResizeObserver.observe(composer);
      }
    }
  }

  handleCreateProfile() {
    const draft = promptProfileDraft({
      name: `Профиль ${this.workspace.store.profiles.length + 1}`,
      style: "Кратко, по делу, без воды.",
      format: "Структурированный ответ с заголовками при необходимости.",
      constraints: [],
    });
    if (!draft) return;
    const profile = this.workspace.profileRegistry.create(draft);
    if (!profile) return;
    this.renderWorkspaceChrome();
    this.session.agent?.setUserProfile(ProfileRegistry.toAgentPrefs(this.workspace.getActiveProfile()));
  }

  bindEvents() {
    window.addEventListener("resize", () => this.syncComposerOffset());
    $("send").addEventListener("click", () => this.composer.handleSend());
    $("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.composer.handleSend(); } });
    $("pauseTask").addEventListener("click", () => this.composer.sendTaskControlCommand("pause"));
    $("continueTask").addEventListener("click", () => this.composer.sendTaskControlCommand("continue"));
    $("newChat").addEventListener("click", () => { this.workspace.createChat({ ...this.fallbackConfig }); this.renderWorkspaceChrome(); this.session.bindAgentToActiveChat(); addMessage({ role: "assistant", text: "Новый независимый чат создан.", meta: { statsLines: [] } }); });
    $("branchChat").addEventListener("click", () => { const sourceBranch = this.workspace.getActiveBranch(); const sourceState = sourceBranch?.state ? clonePlain(sourceBranch.state) : clonePlain(this.session.agent?.exportState() || this.workspace.getActiveChat()?.state || {}); this.workspace.cloneChatFromCurrent(sourceState); this.renderWorkspaceChrome(); this.session.bindAgentToActiveChat(); addMessage({ role: "assistant", text: "Создан новый чат на основе текущего. Дальше они независимы.", meta: { statsLines: [] } }); });
    $("renameChat").addEventListener("click", () => { const chat = this.workspace.getActiveChat(); const value = window.prompt("Новое имя чата:", chat?.title || ""); if (value != null && value.trim()) { this.workspace.renameActiveChat(value.trim().slice(0, 60)); this.renderWorkspaceChrome(); } else if (value != null) window.alert("Имя чата не может быть пустым."); });
    $("deleteChat").addEventListener("click", () => { if (this.workspace.deleteActiveChat()) { this.renderWorkspaceChrome(); this.session.bindAgentToActiveChat(); } });
    $("openSettings").addEventListener("click", () => this.openSettingsDialog());
    $("closeSettings").addEventListener("click", () => this.closeSettingsDialog());
    $("settingsDialog").addEventListener("cancel", () => { if ($("profileMenu")) $("profileMenu").open = false; });
    $("settingsDialog").addEventListener("click", (e) => { if (e.target === $("settingsDialog")) this.closeSettingsDialog(); });
    $("runRagBatch").addEventListener("click", () => this.ragBatch.handleRun());
    $("chatList").addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const chatButton = target.closest("[data-chat-action='select']");
      if (!(chatButton instanceof HTMLButtonElement)) return;
      const { chatId } = chatButton.dataset;
      if (!chatId) return;
      this.workspace.switchChat(chatId);
      this.renderWorkspaceChrome();
      this.session.bindAgentToActiveChat();
    });
    $("ragEnabled").addEventListener("change", () => {
      syncRagModeVisibility();
      this.session.agent?.setRagConfig(buildRagConfigFromUi(this.session.agent.ragConfig));
    });
    $("ragRetrievalMode").addEventListener("change", () => this.session.agent?.setRagConfig(buildRagConfigFromUi(this.session.agent.ragConfig)));
    $("profileMenuCreate").addEventListener("click", () => this.handleCreateProfile());
    $("profileMenuList").addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const { profileId, profileAction } = target.dataset;
      if (!profileId || !profileAction) return;
      if (profileAction === "select") { this.workspace.switchProfile(profileId); this.renderWorkspaceChrome(); this.session.agent?.setUserProfile(ProfileRegistry.toAgentPrefs(this.workspace.getActiveProfile())); $("profileMenu").open = false; return; }
      if (profileAction === "delete") { const targetProfile = this.workspace.store.profiles.find((profile) => profile.id === profileId); if (targetProfile && window.confirm(`Удалить профиль "${targetProfile.name}"?`)) { this.workspace.profileRegistry.delete(profileId); this.renderWorkspaceChrome(); this.session.agent?.setUserProfile(ProfileRegistry.toAgentPrefs(this.workspace.getActiveProfile())); } }
    });
    $("addInvariant").addEventListener("click", () => { const draft = promptInvariantDraft(); if (!draft || !this.session.agent) return; const current = Array.isArray(this.session.agent.invariants) ? clonePlain(this.session.agent.invariants) : []; if (current.some((item) => item.toLowerCase() === draft.toLowerCase())) return window.alert("Такой инвариант уже существует."); current.push(draft); this.session.agent.setInvariants(current); renderInvariantControls(this.session.agent); });
    $("removeInvariant").addEventListener("click", () => { if (!this.session.agent || !$("invariantSelect").value) return; const invariant = $("invariantSelect").value; if (!window.confirm(`Удалить инвариант "${invariant}"?`)) return; this.session.agent.setInvariants((Array.isArray(this.session.agent.invariants) ? clonePlain(this.session.agent.invariants) : []).filter((item) => item !== invariant)); renderInvariantControls(this.session.agent); });
    $("apiMode").addEventListener("change", () => { const apiMode = inferApiMode($("apiMode").value, $("baseUrl").value); $("baseUrl").value = defaultEndpointForApiMode(apiMode); $("model").value = defaultModelForApiMode(apiMode); this.session.syncAgentConfig(); });
    for (const id of ["baseUrl", "model", "temperature", "ragEmbeddingBaseUrl", "summaryBaseUrl"]) $(id).addEventListener("change", () => this.session.syncAgentConfig());
  }
}

export { AppController };
