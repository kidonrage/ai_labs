import {
  allowedTransitions,
  isForwardTaskTransition,
  makeDefaultTaskState,
  nextStageFor,
  normalizeTaskState,
} from "./task-stage-state.js";
import { buildTaskFinalizationInput, buildTaskStepInput } from "./task-stage-prompts.js";

class TaskStageWorkflow {
  static allowedTransitions() {
    return allowedTransitions();
  }

  static _isForwardTaskTransition(fromStage, toStage) {
    return isForwardTaskTransition(fromStage, toStage);
  }

  static _nextStageFor(stage) {
    return nextStageFor(stage);
  }

  static makeDefaultTaskState() {
    return makeDefaultTaskState();
  }

  static normalizeTaskState(value) {
    return normalizeTaskState(value);
  }

  constructor({
    getTaskState,
    setTaskState,
    getInvariants,
    emitStateChanged,
    setLastInvariantCheck,
    computeInvariantDecision,
    formatInvariantRefusal,
    runTaskLLMStep,
    extractJsonObject,
  }) {
    this.getTaskState = getTaskState;
    this.setTaskState = setTaskState;
    this.getInvariants = getInvariants;
    this.emitStateChanged = emitStateChanged;
    this.setLastInvariantCheck = setLastInvariantCheck;
    this.computeInvariantDecision = computeInvariantDecision;
    this.formatInvariantRefusal = formatInvariantRefusal;
    this.runTaskLLMStep = runTaskLLMStep;
    this.extractJsonObject = extractJsonObject;
  }

  _state() {
    return TaskStageWorkflow.normalizeTaskState(this.getTaskState());
  }

  _setState(next) {
    this.setTaskState(TaskStageWorkflow.normalizeTaskState(next));
  }

  _expectedActionForStage(stage) {
    if (stage === "planning") return "generate_plan";
    if (stage === "execution") return "execute";
    if (stage === "validation") return "validate";
    if (stage === "paused") return "continue";
    return null;
  }

  transitionTo(nextStage, expectedAction) {
    const prev = this._state();
    const allowed = TaskStageWorkflow.allowedTransitions();
    const nextAllowed = allowed[prev.stage];
    if (!(nextAllowed instanceof Set) || !nextAllowed.has(nextStage)) {
      throw new Error(
        `Недопустимый переход этапа: ${prev.stage} -> ${nextStage}`,
      );
    }
    if (
      TaskStageWorkflow._isForwardTaskTransition(prev.stage, nextStage) &&
      prev.advanceApprovedFromStage !== prev.stage
    ) {
      throw new Error(
        `Переход ${prev.stage} -> ${nextStage} запрещён: нет явного разрешения пользователя.`,
      );
    }
    this._setState({
      ...prev,
      stage: nextStage,
      expectedAction,
      advanceApprovedFromStage: null,
      pausedFrom: nextStage === "paused" ? prev.pausedFrom : null,
    });
    this.emitStateChanged();
    return { from: prev.stage, to: this._state().stage };
  }

  startTask(userGoal) {
    const goal = typeof userGoal === "string" ? userGoal.trim() : "";
    if (!goal) throw new Error("Пустое описание задачи для start.");
    this._setState({
      stage: "planning",
      step: 1,
      expectedAction: "generate_plan",
      advanceApprovedFromStage: null,
      pausedFrom: null,
      artifacts: {
        userGoal: goal,
        plan: null,
        draft: null,
        validation: null,
      },
    });
    this.emitStateChanged();
    return this._state();
  }

  pauseTask() {
    const state = this._state();
    if (!["planning", "execution", "validation"].includes(state.stage)) return false;
    this._setState({
      ...state,
      pausedFrom: {
        stage: state.stage,
        step: state.step,
        expectedAction: state.expectedAction,
        advanceApprovedFromStage: state.advanceApprovedFromStage,
      },
    });
    this.transitionTo("paused", "continue");
    return true;
  }

  continueTask() {
    const state = this._state();
    if (state.stage !== "paused" || !state.pausedFrom) return false;
    const restoredStage = state.pausedFrom.stage;
    const restoredStep = state.pausedFrom.step;
    this._setState({
      ...state,
      stage: restoredStage,
      step: restoredStep,
      pausedFrom: null,
      advanceApprovedFromStage:
        typeof state.pausedFrom.advanceApprovedFromStage === "string" &&
        state.pausedFrom.advanceApprovedFromStage.trim()
          ? state.pausedFrom.advanceApprovedFromStage.trim()
          : null,
      expectedAction:
        typeof state.pausedFrom.expectedAction === "string" &&
        state.pausedFrom.expectedAction.trim()
          ? state.pausedFrom.expectedAction.trim()
          : this._expectedActionForStage(restoredStage),
    });
    this.emitStateChanged();
    return true;
  }

  resetTask() {
    this._setState(TaskStageWorkflow.makeDefaultTaskState());
    this.emitStateChanged();
  }

  approveNextStage() {
    const state = this._state();
    if (!["planning", "execution", "validation"].includes(state.stage)) {
      return false;
    }
    const requiredArtifactByStage = {
      planning: "plan",
      execution: "draft",
      validation: "validation",
    };
    const artifactKey = requiredArtifactByStage[state.stage];
    const artifactValue =
      state.artifacts && typeof state.artifacts[artifactKey] === "string"
        ? state.artifacts[artifactKey].trim()
        : "";
    if (!artifactValue) {
      return false;
    }
    this._setState({
      ...state,
      advanceApprovedFromStage: state.stage,
      expectedAction: "advance_stage",
    });
    this.emitStateChanged();
    return true;
  }

  advanceToNextStage() {
    const state = this._state();
    const nextStage = TaskStageWorkflow._nextStageFor(state.stage);
    if (!nextStage) {
      throw new Error(
        `Невозможно перейти к следующему этапу из состояния ${state.stage}.`,
      );
    }
    return this.transitionTo(nextStage, this._expectedActionForStage(nextStage));
  }

  async runTaskStep(context = {}) {
    const state = this._state();
    const stage = state.stage;

    if (!["planning", "execution", "validation"].includes(stage)) {
      throw new Error("Нет активного шага задачи для выполнения.");
    }

    const userHint = typeof context.userMessage === "string" ? context.userMessage.trim() : "";
    const invariantInput = userHint || (state.artifacts && state.artifacts.userGoal) || "";
    if (invariantInput) {
      const decision = this.computeInvariantDecision(invariantInput);
      this.setLastInvariantCheck(decision.invariantCheck);
      this.emitStateChanged();
      if (decision.invariantCheck.conflict) {
        return {
          text: this.formatInvariantRefusal(decision.invariantCheck),
          transition: { from: stage, to: stage },
          invariantCheck: decision.invariantCheck,
        };
      }
    }

    const answerText = await this.runTaskLLMStep(
      buildTaskStepInput(this._state(), this.getInvariants(), stage, context),
    );

    const next = this._state();
    if (stage === "planning") {
      next.artifacts.plan = answerText;
      next.step += 1;
      next.expectedAction = "await_approval";
      next.advanceApprovedFromStage = null;
      this._setState(next);
      this.emitStateChanged();
      return { text: answerText, transition: { from: stage, to: stage } };
    }
    if (stage === "execution") {
      next.artifacts.draft = answerText;
      next.step += 1;
      next.expectedAction = "await_approval";
      next.advanceApprovedFromStage = null;
      this._setState(next);
      this.emitStateChanged();
      return { text: answerText, transition: { from: stage, to: stage } };
    }

    const finalRawText = await this.runTaskLLMStep(
      buildTaskFinalizationInput(this._state(), this.getInvariants(), context, answerText),
    );
    let finalText = String(finalRawText || "").trim();
    const parsedFinal = this.extractJsonObject(finalRawText);
    if (
      parsedFinal &&
      typeof parsedFinal === "object" &&
      !Array.isArray(parsedFinal) &&
      typeof parsedFinal.final === "string" &&
      parsedFinal.final.trim()
    ) {
      finalText = parsedFinal.final.trim();
    }
    next.artifacts.validation = answerText;
    next.artifacts.draft = finalText;
    next.step += 1;
    next.expectedAction = "await_approval";
    next.advanceApprovedFromStage = null;
    this._setState(next);
    const combinedText =
      `Validation review:\n${answerText}\n\nFinal result:\n${finalText}`;
    this.emitStateChanged();
    return { text: combinedText, transition: { from: stage, to: stage } };
  }
}

export { TaskStageWorkflow };
