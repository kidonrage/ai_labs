import { normalizeInvariants } from "../invariants.store.js";
import {
  extractKeywords,
  normalizeText,
  normalizeToken,
  parseInvariantRule,
} from "./rule-parser.js";

const BLOCK_INVARIANT_IGNORE_RE =
  /(ignore|игнорир(уй|овать)|обойди|отмени)[\s\S]{0,80}(invariant|инвариант|огранич|правил)/i;

function isRelevantInvariant(invariant, combinedText) {
  const words = extractKeywords(invariant);
  return words.some((word) => combinedText.includes(word));
}

function extractTechCandidates(text) {
  const src = normalizeText(text);
  const candidates = new Set();
  const patterns = [
    /(?:на|on|in|using|use)\s+([a-zA-Z][a-zA-Z0-9+.#_-]{1,40})/gi,
    /(?:rewrite|rebuild|migrate|перепиши|переведи|реализуй|напиши)[^.\n]{0,80}?(?:на|on|in|using)\s+([a-zA-Z][a-zA-Z0-9+.#_-]{1,40})/gi,
  ];

  for (const re of patterns) {
    for (const match of src.matchAll(re)) {
      const token = normalizeText(match[1]);
      if (token) candidates.add(token);
    }
  }

  return Array.from(candidates);
}

function requestTouchesScope(requestText, scopeText) {
  const req = normalizeText(requestText).toLowerCase();
  return extractKeywords(scopeText).some((word) => req.includes(word));
}

function hasReplaceIntent(text) {
  return /replace|switch|swap|migrate|замени|заменить|переведи|мигрир|подмени/i.test(
    normalizeText(text),
  );
}

function asksToLogPii(text) {
  const src = normalizeText(text).toLowerCase();
  const hasLog = /(log|logs|logging|лог|логи|логах|логировать|логируй)/i.test(src);
  const hasPii =
    /(pii|personal data|passport|паспорт|персональн|личн(ые|ые данные)?|email|телефон)/i.test(src);
  const hasStoreIntent = /(store|write|save|record|храни|сохрани|запиши|пиши)/i.test(src);
  return hasLog && hasPii && hasStoreIntent;
}

function detectInvariantConflicts({
  request,
  draft,
  invariants,
  mandatoryInvariantLabel,
}) {
  const normalizedRequest = normalizeText(request);
  const normalizedInvariants = normalizeInvariants(invariants, { mergeWithDefaults: false });
  const combinedText = [
    normalizedRequest,
    normalizeText(draft.summary),
    Array.isArray(draft.steps) ? draft.steps.join("\n") : "",
  ]
    .join("\n")
    .toLowerCase();
  const requestText = normalizedRequest.toLowerCase();
  const relevant = normalizedInvariants.filter((inv) => isRelevantInvariant(inv, combinedText));
  const relevantInvariants = relevant.length > 0 ? relevant : normalizedInvariants;
  const violatedInvariants = [];

  if (BLOCK_INVARIANT_IGNORE_RE.test(normalizedRequest)) {
    violatedInvariants.push({
      invariant: mandatoryInvariantLabel,
      reason:
        "Request asks to ignore mandatory invariants, but invariants are enforced system constraints.",
    });
  }

  for (const inv of normalizedInvariants) {
    const ruleSpec = parseInvariantRule(inv);
    if (ruleSpec.kind === "fixed_stack_scope" && requestTouchesScope(requestText, ruleSpec.scope)) {
      const allowed = normalizeToken(ruleSpec.allowed);
      const conflictCandidate = extractTechCandidates(requestText)
        .map((item) => ({ raw: item, token: normalizeToken(item) }))
        .filter((item) => item.token)
        .find((item) => item.token !== allowed);
      if (conflictCandidate) {
        violatedInvariants.push({
          invariant: inv,
          reason:
            `Request proposes ${conflictCandidate.raw}, but invariant fixes ${ruleSpec.scope} to ${ruleSpec.allowed}.`,
        });
      }
      continue;
    }

    if (ruleSpec.kind === "cannot_replace") {
      const target = normalizeToken(ruleSpec.target);
      const targetMentioned = normalizeToken(requestText).includes(target);
      if (hasReplaceIntent(requestText) && targetMentioned) {
        const replacement = extractTechCandidates(requestText)
          .map((item) => ({ raw: item, token: normalizeToken(item) }))
          .filter((item) => item.token)
          .find((item) => item.token !== target);
        violatedInvariants.push({
          invariant: inv,
          reason: replacement
            ? `Request replaces ${ruleSpec.target} with ${replacement.raw}, which violates fixed technology invariant.`
            : `Request attempts to replace ${ruleSpec.target}, which is not allowed by invariant.`,
        });
      }
      continue;
    }

    if (ruleSpec.kind === "no_pii_logs" && asksToLogPii(requestText)) {
      violatedInvariants.push({
        invariant: inv,
        reason: "Request asks to store personal data in logs, which violates privacy invariant.",
      });
    }
  }

  return {
    request: normalizedRequest,
    relevantInvariants,
    violatedInvariants: Array.from(
      new Map(violatedInvariants.map((item) => [item.invariant, item])).values(),
    ),
  };
}

export { detectInvariantConflicts };
