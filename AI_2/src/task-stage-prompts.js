function buildTaskStepInput(state, invariants, stage, context = {}) {
  const artifacts = state.artifacts || {};
  const userHint = typeof context.userMessage === "string" ? context.userMessage.trim() : "";
  const instructionByStage = {
    planning:
      "Сформируй короткий план (outline) по цели пользователя. Верни только план, без вступлений.",
    execution:
      "На основе цели и плана создай черновик результата. Используй уже сохранённые артефакты, не повторяй лишних объяснений.",
    validation:
      "Сделай проверку/ревью черновика: кратко укажи сильные стороны, риски и список правок.",
  };
  return [
    "SYSTEM: Ты выполняешь шаг конечного автомата задачи.",
    "Межэтапный переход выполняется только после явной команды пользователя approve.",
    `STAGE: ${stage}`,
    `STEP: ${state.step}`,
    `EXPECTED_ACTION: ${state.expectedAction || "null"}`,
    `GOAL: ${artifacts.userGoal || "(empty)"}`,
    `PLAN: ${artifacts.plan || "(empty)"}`,
    `DRAFT: ${artifacts.draft || "(empty)"}`,
    `VALIDATION: ${artifacts.validation || "(empty)"}`,
    "INVARIANTS:",
    JSON.stringify(invariants, null, 2),
    ...(userHint ? [`USER_HINT: ${userHint}`] : []),
    `INSTRUCTION: ${instructionByStage[stage] || "Сделай следующий шаг задачи."}`,
    "ASSISTANT:",
  ].join("\n");
}

function buildTaskFinalizationInput(state, invariants, context = {}, validationText = "") {
  const artifacts = state.artifacts || {};
  const userRemarks =
    typeof context.userMessage === "string" && context.userMessage.trim()
      ? context.userMessage.trim()
      : "";
  return [
    "SYSTEM: Ты завершаешь задачу после этапа validation.",
    "Собери финальный результат, исправив черновик с учетом замечаний.",
    "Верни СТРОГО JSON без markdown и без пояснений:",
    '{"final":"<готовый финальный результат>"}',
    "Запрещено возвращать review, комментарии и списки замечаний.",
    `GOAL: ${artifacts.userGoal || "(empty)"}`,
    `PLAN: ${artifacts.plan || "(empty)"}`,
    `DRAFT_BEFORE_FIX: ${artifacts.draft || "(empty)"}`,
    `VALIDATION_REVIEW: ${validationText || "(empty)"}`,
    "INVARIANTS:",
    JSON.stringify(invariants, null, 2),
    `USER_REMARKS: ${userRemarks || "(empty)"}`,
    "INSTRUCTION: Верни только поле final с итоговым текстом.",
    "ASSISTANT:",
  ].join("\n");
}

export { buildTaskFinalizationInput, buildTaskStepInput };
