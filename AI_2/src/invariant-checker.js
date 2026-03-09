import { normalizeInvariants } from "./invariants.store.js";

const BLOCK_INVARIANT_IGNORE_RE =
  /(ignore|игнорир(уй|овать)|обойди|отмени)[\s\S]{0,80}(invariant|инвариант|огранич|правил)/i;
const MANDATORY_INVARIANT_LABEL = "Обязательность инвариантов";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeInvariantCheck(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const violated = Array.isArray(raw.violatedInvariants) ? raw.violatedInvariants : [];
  return {
    request: normalizeText(raw.request),
    relevantInvariants: Array.isArray(raw.relevantInvariants)
      ? raw.relevantInvariants.filter((x) => typeof x === "string")
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

function extractKeywords(text) {
  return Array.from(
    new Set(
      normalizeText(text)
        .toLowerCase()
        .split(/[^a-zа-я0-9_+#.]+/i)
        .map((x) => x.trim())
        .filter((x) => x.length >= 4),
    ),
  );
}

function isRelevantInvariant(invariant, combinedText) {
  const words = extractKeywords(invariant);
  if (words.length === 0) return false;
  for (const w of words) {
    if (combinedText.includes(w)) return true;
  }
  return false;
}

function normalizeToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-zа-я0-9+.#_-]+/gi, "");
}

function parseInvariantRule(rule) {
  const text = normalizeText(rule);
  const onlyMatch = /^use\s+(.+?)\s+only\s+for\s+(.+)$/i.exec(text);
  if (onlyMatch) {
    return {
      kind: "fixed_stack_scope",
      allowed: normalizeText(onlyMatch[1]),
      scope: normalizeText(onlyMatch[2]),
    };
  }

  const cannotReplaceMatch = /^(.+?)\s+cannot\s+be\s+replaced$/i.exec(text);
  if (cannotReplaceMatch) {
    return {
      kind: "cannot_replace",
      target: normalizeText(cannotReplaceMatch[1]),
    };
  }

  const onlyRuMatchA = /^для\s+(.+?)\s+использовать\s+только\s+(.+)$/i.exec(text);
  if (onlyRuMatchA) {
    return {
      kind: "fixed_stack_scope",
      allowed: normalizeText(onlyRuMatchA[2]),
      scope: normalizeText(onlyRuMatchA[1]),
    };
  }
  const onlyRuMatchB = /^использовать\s+только\s+(.+?)\s+для\s+(.+)$/i.exec(text);
  if (onlyRuMatchB) {
    return {
      kind: "fixed_stack_scope",
      allowed: normalizeText(onlyRuMatchB[1]),
      scope: normalizeText(onlyRuMatchB[2]),
    };
  }
  const cannotReplaceRuA = /^(.+?)\s+нельзя\s+замен(ять|ить)$/i.exec(text);
  if (cannotReplaceRuA) {
    return {
      kind: "cannot_replace",
      target: normalizeText(cannotReplaceRuA[1]),
    };
  }
  const cannotReplaceRuB = /^нельзя\s+замен(ять|ить)\s+(.+)$/i.exec(text);
  if (cannotReplaceRuB) {
    return {
      kind: "cannot_replace",
      target: normalizeText(cannotReplaceRuB[2]),
    };
  }
  if (/персональн.*данн.*нельзя.*лог|pii.*(cannot|must not).*(log|logs)/i.test(text)) {
    return { kind: "no_pii_logs" };
  }

  return { kind: "generic" };
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
  const scopeWords = extractKeywords(scopeText);
  return scopeWords.some((word) => req.includes(word));
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

function createDraftPlan(agentContext = {}) {
  const request = normalizeText(agentContext.userRequest);
  const taskState = agentContext.taskState && typeof agentContext.taskState === "object"
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

function buildSafeAlternative(violatedInvariants) {
  const source = Array.isArray(violatedInvariants) ? violatedInvariants : [];
  const lines = [];
  if (source.some((item) => /node\.js/i.test(item.invariant))) {
    lines.push("Сохраняем backend на Node.js и улучшаем архитектуру внутри текущего стека.");
  }
  if (source.some((item) => /postgresql/i.test(item.invariant))) {
    lines.push("Оставляем PostgreSQL и улучшаем схему, индексы и запросы без замены СУБД.");
  }
  if (source.some((item) => /персональн.*данн.*лог/i.test(item.invariant))) {
    lines.push("Убираем персональные данные из логов, используем маскирование и защищенное хранилище.");
  }
  if (source.some((item) => item.invariant === MANDATORY_INVARIANT_LABEL)) {
    lines.push("Сформулируйте цель без запроса на отключение обязательных ограничений.");
  }
  if (lines.length === 0) {
    return "Сохраняем текущие ограничения архитектуры, стека и данных и предлагаем безопасный вариант в этих рамках.";
  }
  return lines.join(" ");
}

function checkInvariantConflicts({ request, draftPlan, taskState, invariants }) {
  const normalizedRequest = normalizeText(request);
  const normalizedInvariants = normalizeInvariants(invariants, { mergeWithDefaults: false });
  const draft =
    draftPlan && typeof draftPlan === "object" && !Array.isArray(draftPlan)
      ? draftPlan
      : createDraftPlan({ userRequest: normalizedRequest, taskState });

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
      invariant: MANDATORY_INVARIANT_LABEL,
      reason:
        "Request asks to ignore mandatory invariants, but invariants are enforced system constraints.",
    });
  }

  for (const inv of normalizedInvariants) {
    const ruleSpec = parseInvariantRule(inv);
    if (ruleSpec.kind === "fixed_stack_scope") {
      const shouldCheck = requestTouchesScope(requestText, ruleSpec.scope);
      if (shouldCheck) {
        const allowed = normalizeToken(ruleSpec.allowed);
        const candidates = extractTechCandidates(requestText)
          .map((item) => ({ raw: item, token: normalizeToken(item) }))
          .filter((item) => item.token);
        const conflictCandidate = candidates.find((item) => item.token !== allowed);
        if (conflictCandidate) {
          violatedInvariants.push({
            invariant: inv,
            reason:
              `Request proposes ${conflictCandidate.raw}, but invariant fixes ${ruleSpec.scope} to ${ruleSpec.allowed}.`,
          });
          continue;
        }
      }
    }

    if (ruleSpec.kind === "cannot_replace") {
      const target = normalizeToken(ruleSpec.target);
      const targetMentioned = normalizeToken(requestText).includes(target);
      if (hasReplaceIntent(requestText) && targetMentioned) {
        const candidates = extractTechCandidates(requestText)
          .map((item) => ({ raw: item, token: normalizeToken(item) }))
          .filter((item) => item.token);
        const replacement = candidates.find((item) => item.token !== target);
        if (replacement) {
          violatedInvariants.push({
            invariant: inv,
            reason:
              `Request replaces ${ruleSpec.target} with ${replacement.raw}, which violates fixed technology invariant.`,
          });
          continue;
        }
        violatedInvariants.push({
          invariant: inv,
          reason: `Request attempts to replace ${ruleSpec.target}, which is not allowed by invariant.`,
        });
      }
    }

    if (ruleSpec.kind === "no_pii_logs" && asksToLogPii(requestText)) {
      violatedInvariants.push({
        invariant: inv,
        reason: "Request asks to store personal data in logs, which violates privacy invariant.",
      });
    }
  }

  const uniqueViolated = Array.from(
    new Map(violatedInvariants.map((item) => [item.invariant, item])).values(),
  );

  return normalizeInvariantCheck({
    request: normalizedRequest,
    relevantInvariants,
    conflict: uniqueViolated.length > 0,
    violatedInvariants: uniqueViolated,
    explanation:
      uniqueViolated.length > 0
        ? "Request conflicts with one or more mandatory invariants."
        : "No invariant conflicts detected for the current request.",
    safeAlternative: uniqueViolated.length > 0 ? buildSafeAlternative(uniqueViolated) : "",
  });
}

export {
  MANDATORY_INVARIANT_LABEL,
  createDraftPlan,
  checkInvariantConflicts,
  normalizeInvariantCheck,
};
