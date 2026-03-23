import { normalizeText } from "./rule-parser.js";

function normalizeInvariantCheck(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const violated = Array.isArray(raw.violatedInvariants) ? raw.violatedInvariants : [];
  return {
    request: normalizeText(raw.request),
    relevantInvariants: Array.isArray(raw.relevantInvariants)
      ? raw.relevantInvariants.filter((item) => typeof item === "string")
      : [],
    conflict: Boolean(raw.conflict),
    violatedInvariants: violated
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        invariant:
          typeof item.invariant === "string" && item.invariant.trim()
            ? item.invariant.trim()
            : "Неизвестный инвариант",
        reason: typeof item.reason === "string" ? item.reason : "Unknown reason",
      })),
    explanation: normalizeText(raw.explanation),
    safeAlternative: normalizeText(raw.safeAlternative),
    decision: raw.conflict ? "conflict" : "no_conflict",
  };
}

export { normalizeInvariantCheck };
