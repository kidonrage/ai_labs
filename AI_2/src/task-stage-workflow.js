class TaskStageWorkflow {
  static makeDefaultTaskState() {
    return {
      stage: "idle",
      step: 0,
      expectedAction: null,
      pausedFrom: null,
      artifacts: {
        userGoal: null,
        plan: null,
        draft: null,
        validation: null,
      },
    };
  }

  static normalizeTaskState(value) {
    const base = TaskStageWorkflow.makeDefaultTaskState();
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const allowedStages = new Set([
      "idle",
      "planning",
      "execution",
      "validation",
      "done",
      "paused",
    ]);

    const stage = typeof raw.stage === "string" && allowedStages.has(raw.stage)
      ? raw.stage
      : base.stage;
    const step = Number.isFinite(raw.step) ? Math.max(0, Math.floor(raw.step)) : base.step;
    const expectedAction = typeof raw.expectedAction === "string" && raw.expectedAction.trim()
      ? raw.expectedAction.trim()
      : null;

    const pausedFromRaw = raw.pausedFrom && typeof raw.pausedFrom === "object" && !Array.isArray(raw.pausedFrom)
      ? raw.pausedFrom
      : null;
    const pausedFrom = pausedFromRaw && typeof pausedFromRaw.stage === "string" && Number.isFinite(pausedFromRaw.step)
      ? {
          stage: pausedFromRaw.stage,
          step: Math.max(0, Math.floor(pausedFromRaw.step)),
        }
      : null;

    const artifactsRaw = raw.artifacts && typeof raw.artifacts === "object" && !Array.isArray(raw.artifacts)
      ? raw.artifacts
      : {};
    const normalizeArtifact = (v) =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    return {
      stage,
      step,
      expectedAction,
      pausedFrom,
      artifacts: {
        userGoal: normalizeArtifact(artifactsRaw.userGoal),
        plan: normalizeArtifact(artifactsRaw.plan),
        draft: normalizeArtifact(artifactsRaw.draft),
        validation: normalizeArtifact(artifactsRaw.validation),
      },
    };
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
    this._setState({
      ...prev,
      stage: nextStage,
      expectedAction,
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
      expectedAction: this._expectedActionForStage(restoredStage),
    });
    this.emitStateChanged();
    return true;
  }

  resetTask() {
    this._setState(TaskStageWorkflow.makeDefaultTaskState());
    this.emitStateChanged();
  }

  _buildTaskStepInput(stage, context = {}) {
    const ts = this._state();
    const artifacts = ts.artifacts || {};
    const userHint = typeof context.userMessage === "string" ? context.userMessage.trim() : "";
    const instructionByStage = {
      planning:
        "Сформируй короткий план (outline) по цели пользователя. Верни только план, без вступлений.",
      execution:
        "На основе цели и плана создай черновик результата. Используй уже сохранённые артефакты, не повторяй лишних объяснений.",
      validation:
        "Сделай проверку/ревью черновика: кратко укажи сильные стороны, риски и список правок.",
    };

    const parts = [];
    parts.push("SYSTEM: Ты выполняешь шаг конечного автомата задачи.");
    parts.push(`STAGE: ${stage}`);
    parts.push(`STEP: ${ts.step}`);
    parts.push(`EXPECTED_ACTION: ${ts.expectedAction || "null"}`);
    parts.push(`GOAL: ${artifacts.userGoal || "(empty)"}`);
    parts.push(`PLAN: ${artifacts.plan || "(empty)"}`);
    parts.push(`DRAFT: ${artifacts.draft || "(empty)"}`);
    parts.push(`VALIDATION: ${artifacts.validation || "(empty)"}`);
    parts.push("INVARIANTS:");
    parts.push(JSON.stringify(this.getInvariants(), null, 2));
    if (userHint) {
      parts.push(`USER_HINT: ${userHint}`);
    }
    parts.push(`INSTRUCTION: ${instructionByStage[stage] || "Сделай следующий шаг задачи."}`);
    parts.push("ASSISTANT:");
    return parts.join("\n");
  }

  _buildTaskFinalizationInput(context = {}, validationText = "") {
    const ts = this._state();
    const artifacts = ts.artifacts || {};
    const userRemarks =
      typeof context.userMessage === "string" && context.userMessage.trim()
        ? context.userMessage.trim()
        : "";

    const parts = [];
    parts.push("SYSTEM: Ты завершаешь задачу после этапа validation.");
    parts.push("Собери финальный результат, исправив черновик с учетом замечаний.");
    parts.push("Верни СТРОГО JSON без markdown и без пояснений:");
    parts.push('{"final":"<готовый финальный результат>"}');
    parts.push("Запрещено возвращать review, комментарии и списки замечаний.");
    parts.push(`GOAL: ${artifacts.userGoal || "(empty)"}`);
    parts.push(`PLAN: ${artifacts.plan || "(empty)"}`);
    parts.push(`DRAFT_BEFORE_FIX: ${artifacts.draft || "(empty)"}`);
    parts.push(`VALIDATION_REVIEW: ${validationText || "(empty)"}`);
    parts.push("INVARIANTS:");
    parts.push(JSON.stringify(this.getInvariants(), null, 2));
    parts.push(`USER_REMARKS: ${userRemarks || "(empty)"}`);
    parts.push("INSTRUCTION: Верни только поле final с итоговым текстом.");
    parts.push("ASSISTANT:");
    return parts.join("\n");
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
      this._buildTaskStepInput(stage, context),
    );

    const next = this._state();
    if (stage === "planning") {
      next.artifacts.plan = answerText;
      next.step += 1;
      this._setState(next);
      const changed = this.transitionTo("execution", "execute");
      return { text: answerText, transition: changed };
    }
    if (stage === "execution") {
      next.artifacts.draft = answerText;
      next.step += 1;
      this._setState(next);
      const changed = this.transitionTo("validation", "validate");
      return { text: answerText, transition: changed };
    }

    const finalRawText = await this.runTaskLLMStep(
      this._buildTaskFinalizationInput(context, answerText),
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
    this._setState(next);
    const changed = this.transitionTo("done", null);
    const combinedText =
      `Validation review:\n${answerText}\n\nFinal result:\n${finalText}`;
    return { text: combinedText, transition: changed };
  }
}

export { TaskStageWorkflow };
