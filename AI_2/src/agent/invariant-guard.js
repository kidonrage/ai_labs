import {
  checkInvariantConflicts as runInvariantChecker,
  createDraftPlan as createInvariantDraftPlan,
} from "../invariant-checker.js";
import { formatInvariantRefusal as buildInvariantRefusalText } from "../refusal-formatter.js";
import { normalizeInvariants } from "../invariants.store.js";

class InvariantGuard {
  buildAgentContext(agent, userRequest = "") {
    return {
      userRequest: String(userRequest || "").trim(),
      memory: {
        longTerm: agent.constructor.normalizeLongTermMemory(agent.longTermMemory),
        working: agent.constructor.normalizeWorkingMemory(agent.workingMemory),
      },
      taskState: agent.constructor.normalizeTaskState(agent.taskState),
      invariants: normalizeInvariants(agent.invariants, { mergeWithDefaults: false }),
    };
  }

  createDraftPlan(agentContext) {
    return createInvariantDraftPlan(agentContext);
  }

  checkInvariantConflicts(agentContext, draftPlan) {
    const ctx =
      agentContext && typeof agentContext === "object" && !Array.isArray(agentContext)
        ? agentContext
        : this.buildAgentContext({ longTermMemory: {}, workingMemory: {}, taskState: {}, invariants: [] });
    return runInvariantChecker({
      request: ctx.userRequest,
      draftPlan,
      taskState: ctx.taskState,
      invariants: ctx.invariants,
    });
  }

  formatInvariantRefusal(checkResult) {
    return buildInvariantRefusalText(checkResult);
  }

  computeDecision(agent, userRequest = "") {
    const agentContext = this.buildAgentContext(agent, userRequest);
    const draftPlan = this.createDraftPlan(agentContext);
    const invariantCheck = this.checkInvariantConflicts(agentContext, draftPlan);
    return { agentContext, draftPlan, invariantCheck };
  }
}

export { InvariantGuard };
