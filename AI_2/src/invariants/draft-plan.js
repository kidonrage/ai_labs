import { normalizeText } from "./rule-parser.js";

function createDraftPlan(agentContext = {}) {
  const request = normalizeText(agentContext.userRequest);
  const taskState =
    agentContext.taskState && typeof agentContext.taskState === "object"
      ? agentContext.taskState
      : {};
  const stage = typeof taskState.stage === "string" ? taskState.stage : "idle";
  const steps = [];

  if (request) {
    steps.push(`Clarify requested outcome: ${request}`);
    steps.push("Map constraints from runtime context before proposing implementation steps.");
    steps.push("Produce implementation guidance that stays within accepted architecture and data rules.");
  }

  return {
    request,
    stage,
    summary: request ? `Draft plan for request: ${request}` : "Draft plan is empty",
    steps,
  };
}

export { createDraftPlan };
