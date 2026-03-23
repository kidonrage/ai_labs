const ALLOWED_TASK_STAGES = new Set([
  "idle",
  "planning",
  "execution",
  "validation",
  "done",
  "paused",
]);

function makeDefaultTaskState() {
  return {
    stage: "idle",
    step: 0,
    expectedAction: null,
    advanceApprovedFromStage: null,
    pausedFrom: null,
    artifacts: {
      userGoal: null,
      plan: null,
      draft: null,
      validation: null,
    },
  };
}

function normalizeTaskState(value) {
  const base = makeDefaultTaskState();
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const pausedFromRaw =
    raw.pausedFrom && typeof raw.pausedFrom === "object" && !Array.isArray(raw.pausedFrom)
      ? raw.pausedFrom
      : null;
  const artifactsRaw =
    raw.artifacts && typeof raw.artifacts === "object" && !Array.isArray(raw.artifacts)
      ? raw.artifacts
      : {};
  const normalizeArtifact = (item) =>
    typeof item === "string" && item.trim() ? item.trim() : null;

  return {
    stage: typeof raw.stage === "string" && ALLOWED_TASK_STAGES.has(raw.stage) ? raw.stage : base.stage,
    step: Number.isFinite(raw.step) ? Math.max(0, Math.floor(raw.step)) : base.step,
    expectedAction:
      typeof raw.expectedAction === "string" && raw.expectedAction.trim()
        ? raw.expectedAction.trim()
        : null,
    advanceApprovedFromStage:
      typeof raw.advanceApprovedFromStage === "string" && raw.advanceApprovedFromStage.trim()
        ? raw.advanceApprovedFromStage.trim()
        : null,
    pausedFrom:
      pausedFromRaw &&
      typeof pausedFromRaw.stage === "string" &&
      Number.isFinite(pausedFromRaw.step)
        ? {
            stage: pausedFromRaw.stage,
            step: Math.max(0, Math.floor(pausedFromRaw.step)),
            expectedAction: normalizeArtifact(pausedFromRaw.expectedAction),
            advanceApprovedFromStage: normalizeArtifact(
              pausedFromRaw.advanceApprovedFromStage,
            ),
          }
        : null,
    artifacts: {
      userGoal: normalizeArtifact(artifactsRaw.userGoal),
      plan: normalizeArtifact(artifactsRaw.plan),
      draft: normalizeArtifact(artifactsRaw.draft),
      validation: normalizeArtifact(artifactsRaw.validation),
    },
  };
}

function allowedTransitions() {
  return {
    idle: new Set(["planning"]),
    planning: new Set(["execution", "paused"]),
    execution: new Set(["validation", "paused"]),
    validation: new Set(["done", "paused"]),
    paused: new Set(["planning", "execution", "validation"]),
    done: new Set([]),
  };
}

function isForwardTaskTransition(fromStage, toStage) {
  return (
    (fromStage === "planning" && toStage === "execution") ||
    (fromStage === "execution" && toStage === "validation") ||
    (fromStage === "validation" && toStage === "done")
  );
}

function nextStageFor(stage) {
  if (stage === "planning") return "execution";
  if (stage === "execution") return "validation";
  if (stage === "validation") return "done";
  return null;
}

export {
  allowedTransitions,
  isForwardTaskTransition,
  makeDefaultTaskState,
  nextStageFor,
  normalizeTaskState,
};
