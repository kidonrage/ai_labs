import { normalizeInvariantCheck } from "./invariants/check-normalizer.js";
import { detectInvariantConflicts } from "./invariants/conflict-detector.js";
import { createDraftPlan } from "./invariants/draft-plan.js";
import { buildSafeAlternative } from "./invariants/safe-alternative-builder.js";

const MANDATORY_INVARIANT_LABEL = "Обязательность инвариантов";

function checkInvariantConflicts({ request, draftPlan, taskState, invariants }) {
  const draft =
    draftPlan && typeof draftPlan === "object" && !Array.isArray(draftPlan)
      ? draftPlan
      : createDraftPlan({ userRequest: request, taskState });
  const detected = detectInvariantConflicts({
    request,
    draft,
    invariants,
    mandatoryInvariantLabel: MANDATORY_INVARIANT_LABEL,
  });

  return normalizeInvariantCheck({
    request: detected.request,
    relevantInvariants: detected.relevantInvariants,
    conflict: detected.violatedInvariants.length > 0,
    violatedInvariants: detected.violatedInvariants,
    explanation:
      detected.violatedInvariants.length > 0
        ? "Request conflicts with one or more mandatory invariants."
        : "No invariant conflicts detected for the current request.",
    safeAlternative:
      detected.violatedInvariants.length > 0
        ? buildSafeAlternative(
            detected.violatedInvariants,
            MANDATORY_INVARIANT_LABEL,
          )
        : "",
  });
}

export {
  MANDATORY_INVARIANT_LABEL,
  createDraftPlan,
  checkInvariantConflicts,
  normalizeInvariantCheck,
};
