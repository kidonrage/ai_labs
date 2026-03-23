import { $ } from "./dom.js";

class TaskStatusView {
  render(taskState, options = {}) {
    const refs = {
      stageEl: $("taskStage"),
      stepEl: $("taskStep"),
      expectedEl: $("taskExpectedAction"),
      pausedFromEl: $("taskPausedFrom"),
      pausedBadge: $("taskPausedBadge"),
      pauseBtn: $("pauseTask"),
      continueBtn: $("continueTask"),
      panel: $("taskStatusPanel"),
    };
    if (Object.values(refs).some((value) => !value)) return;
    const raw = taskState && typeof taskState === "object" && !Array.isArray(taskState) ? taskState : {};
    const stage = typeof raw.stage === "string" ? raw.stage : "idle";
    const pausedFrom =
      raw.pausedFrom && typeof raw.pausedFrom === "object" && !Array.isArray(raw.pausedFrom)
        ? raw.pausedFrom
        : null;
    const canPause = ["planning", "execution", "validation"].includes(stage);
    const canContinue = stage === "paused";
    refs.panel.hidden = !(canPause || canContinue);
    refs.stageEl.textContent = stage;
    refs.stepEl.textContent = String(Number.isFinite(raw.step) ? raw.step : 0);
    refs.expectedEl.textContent =
      typeof raw.expectedAction === "string" && raw.expectedAction.trim() ? raw.expectedAction : "null";
    refs.pausedFromEl.textContent =
      pausedFrom && typeof pausedFrom.stage === "string" && Number.isFinite(pausedFrom.step)
        ? `${pausedFrom.stage} (step ${pausedFrom.step})`
        : "—";
    refs.pausedBadge.hidden = stage !== "paused";
    refs.pauseBtn.disabled = Boolean(options.isBusy) || !canPause;
    refs.continueBtn.disabled = Boolean(options.isBusy) || !canContinue;
  }
}

export { TaskStatusView };
