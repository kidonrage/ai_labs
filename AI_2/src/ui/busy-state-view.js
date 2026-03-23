import { $ } from "./dom.js";

class BusyStateView {
  setBusy(isBusy) {
    const ids = [
      "send", "newChat", "branchChat", "profileMenuCreate", "renameChat", "deleteChat",
      "chatSelect", "profileMenuTrigger", "input", "model", "temperature", "baseUrl",
      "ragEnabled", "ragRetrievalMode", "pauseTask", "continueTask", "invariantSelect",
      "addInvariant", "removeInvariant", "runRagBatch",
    ];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = isBusy;
    }
    for (const button of document.querySelectorAll("[data-profile-action]")) {
      if (button instanceof HTMLButtonElement) button.disabled = isBusy;
    }
    if ($("send")) $("send").textContent = isBusy ? "Sending…" : "Send";
  }
}

export { BusyStateView };
