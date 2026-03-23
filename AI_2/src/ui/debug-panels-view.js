import { $ } from "./dom.js";

class DebugPanelsView {
  renderFactsPanel(memoryLayers) {
    const panel = $("factsPanel");
    const content = $("factsContent");
    if (!panel || !content) return;
    panel.hidden = false;
    const normalized =
      memoryLayers && typeof memoryLayers === "object" && !Array.isArray(memoryLayers)
        ? memoryLayers
        : {};
    content.textContent = JSON.stringify(normalized, null, 2);
  }

  renderInvariantPanel(invariants, invariantCheck) {
    const panel = $("invariantPanel");
    const content = $("invariantContent");
    if (!panel || !content) return;
    panel.hidden = false;
    const check =
      invariantCheck && typeof invariantCheck === "object" && !Array.isArray(invariantCheck)
        ? invariantCheck
        : null;
    content.textContent = JSON.stringify(
      {
        invariants: Array.isArray(invariants) ? invariants : [],
        invariantCheck: check,
        decision: check
          ? {
              state: check.conflict ? "conflict" : "no_conflict",
              violatedInvariants: Array.isArray(check.violatedInvariants)
                ? check.violatedInvariants.map((item) => item.invariant)
                : [],
              allowedAlternative:
                typeof check.safeAlternative === "string" && check.safeAlternative.trim()
                  ? check.safeAlternative
                  : "",
            }
          : null,
      },
      null,
      2,
    );
  }
}

export { DebugPanelsView };
