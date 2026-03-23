import {
  computeHistoryTotals,
  mergeTotals,
} from "../helpers.js";
import {
  addMessage,
  renderFactsPanel,
  renderHistory,
  renderInvariantPanel,
  renderRagPanel,
  renderTaskStatus,
  renderTotalsBar,
} from "../ui.js";
import { defaultEndpointForApiMode, defaultModelForApiMode, endpointForApiMode, inferApiMode } from "../api-profiles.js";
import { Agent } from "../agent.js";
import { buildRagConfigFromUi, syncRagControlsFromAgent } from "./rag-config.js";
import { renderInvariantControls } from "./ui-renderers.js";
import { $ } from "./utils.js";
import { ProfileRegistry } from "./profile-registry.js";
import { defaultTotals, clonePlain } from "./utils.js";

class ChatSessionController {
  constructor({ workspace, fallbackConfig, getEffectiveApiKey, isUiBusy }) {
    this.workspace = workspace;
    this.fallbackConfig = fallbackConfig;
    this.getEffectiveApiKey = getEffectiveApiKey;
    this.isUiBusy = isUiBusy;
    this.agent = null;
  }

  bindAgentToActiveChat() {
    const chat = this.workspace.getActiveChat();
    const branch = this.workspace.getActiveBranch(chat);
    if (!chat || !branch) return;
    const branchState = branch.state && typeof branch.state === "object" ? branch.state : chat.state || {};
    const chatConfig = branchState.config || {};
    const apiMode = inferApiMode(chatConfig.apiMode, chatConfig.baseUrl);
    const agent = new Agent({
      apiMode,
      baseUrl: typeof chatConfig.baseUrl === "string" ? endpointForApiMode(apiMode, chatConfig.baseUrl) : this.fallbackConfig.baseUrl,
      apiKey: this.getEffectiveApiKey(),
      model: typeof chatConfig.model === "string" ? chatConfig.model : this.fallbackConfig.model,
      temperature: Number.isFinite(chatConfig.temperature) ? chatConfig.temperature : this.fallbackConfig.temperature,
    });
    agent.loadState(branchState);
    agent.setLongTermMemory(this.workspace.store.longTermMemory);
    agent.setUserProfile(ProfileRegistry.toAgentPrefs(this.workspace.getActiveProfile()));
    syncRagControlsFromAgent(agent);
    agent.onStateChanged = (state) => {
      if (this.agent !== agent) return;
      const keepLast = Math.max(1, Number(state?.contextPolicy?.keepLastMessages) || 12);
      const persistedState = clonePlain(agent.persistState());
      const now = new Date().toISOString();
      this.workspace.store.longTermMemory = clonePlain(agent.exportLongTermMemory());
      branch.state = persistedState;
      branch.updatedAt = now;
      chat.state = persistedState;
      chat.updatedAt = now;
      this.workspace.persist();
      renderFactsPanel({
        long_term: this.workspace.store.longTermMemory,
        working: state.workingMemory || agent.workingMemory,
        short_term: { messages: Array.isArray(state.history) ? state.history.slice(-keepLast).map((item) => ({ role: item.role, content: String(item.text || "") })) : [] },
      });
      renderInvariantPanel(state.invariants || agent.invariants, state.lastInvariantCheck || agent.lastInvariantCheck);
      renderRagPanel(state.lastRagResult || agent.lastRagResult);
      renderTotalsBar(mergeTotals(computeHistoryTotals(state.history || []), state.summaryTotals || agent.summaryTotals));
      renderTaskStatus(state.taskState, { isBusy: this.isUiBusy() });
      renderInvariantControls(agent);
    };
    this.agent = agent;
    this.renderBoundState(chatConfig, branchState);
  }

  renderBoundState(chatConfig, branchState) {
    renderFactsPanel({
      long_term: this.workspace.store.longTermMemory,
      working: this.agent.workingMemory,
      short_term: {
        messages: this.agent.history.slice(-Math.max(1, Number(this.agent.contextPolicy.keepLastMessages) || 12)).map((item) => ({ role: item.role, content: String(item.text || "") })),
      },
    });
    renderInvariantPanel(this.agent.invariants, this.agent.lastInvariantCheck);
    renderRagPanel(this.agent.lastRagResult);
    renderInvariantControls(this.agent);
    if (branchState?.config) {
      $("apiMode").value = inferApiMode(chatConfig.apiMode, chatConfig.baseUrl);
      $("baseUrl").value = typeof branchState.config.baseUrl === "string" ? endpointForApiMode($("apiMode").value, branchState.config.baseUrl) : defaultEndpointForApiMode($("apiMode").value);
      $("model").value = typeof branchState.config.model === "string" ? branchState.config.model : defaultModelForApiMode($("apiMode").value);
      if (typeof branchState.config.temperature === "number") $("temperature").value = String(branchState.config.temperature);
    }
    if (Array.isArray(this.agent.history) && this.agent.history.length > 0) {
      renderHistory(this.agent.history, this.agent.summaryTotals, { keepLastMessages: this.agent.contextPolicy.keepLastMessages });
    } else {
      $("messages").innerHTML = "";
      addMessage({ role: "assistant", text: "Чат пуст. Напиши первое сообщение.", meta: { statsLines: [] } });
      renderTotalsBar(mergeTotals(defaultTotals(), this.agent.summaryTotals));
    }
    renderTaskStatus(this.agent.taskState, { isBusy: this.isUiBusy() });
  }

  syncAgentConfig() {
    if (!this.agent) return;
    this.agent.setConfig({
      apiMode: inferApiMode($("apiMode").value, $("baseUrl").value),
      baseUrl: endpointForApiMode($("apiMode").value, $("baseUrl").value),
      apiKey: this.getEffectiveApiKey(),
      model: $("model").value,
      temperature: Number($("temperature").value),
    });
    this.agent.setRagConfig(buildRagConfigFromUi(this.agent.ragConfig));
  }
}

export { ChatSessionController };
