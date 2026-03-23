import { BusyStateView } from "./ui/busy-state-view.js";
import { DebugPanelsView } from "./ui/debug-panels-view.js";
import { MessageListView, messageStatsLines } from "./ui/message-list-view.js";
import { RagPanelView } from "./ui/rag-panel-view.js";
import { TaskStatusView } from "./ui/task-status-view.js";
import { TotalsBarView } from "./ui/totals-bar-view.js";

const totalsBarView = new TotalsBarView();
const messageListView = new MessageListView(totalsBarView);
const debugPanelsView = new DebugPanelsView();
const taskStatusView = new TaskStatusView();
const ragPanelView = new RagPanelView();
const busyStateView = new BusyStateView();

export { messageStatsLines };
export const addMessage = (payload) => messageListView.addMessage(payload);
export const renderHistory = (history, summaryTotals, options = {}) =>
  messageListView.renderHistory(history, summaryTotals, options);
export const renderTotalsBar = (globalTotals) => totalsBarView.render(globalTotals);
export const renderFactsPanel = (memoryLayers) => debugPanelsView.renderFactsPanel(memoryLayers);
export const renderInvariantPanel = (invariants, invariantCheck) =>
  debugPanelsView.renderInvariantPanel(invariants, invariantCheck);
export const renderTaskStatus = (taskState, options = {}) =>
  taskStatusView.render(taskState, options);
export const renderRagPanel = (ragResult) => ragPanelView.render(ragResult);
export const setBusy = (isBusy) => busyStateView.setBusy(isBusy);
