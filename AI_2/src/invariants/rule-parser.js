function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-zа-я0-9+.#_-]+/gi, "");
}

function extractKeywords(text) {
  return Array.from(
    new Set(
      normalizeText(text)
        .toLowerCase()
        .split(/[^a-zа-я0-9_+#.]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4),
    ),
  );
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
    return { kind: "cannot_replace", target: normalizeText(cannotReplaceMatch[1]) };
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
    return { kind: "cannot_replace", target: normalizeText(cannotReplaceRuA[1]) };
  }

  const cannotReplaceRuB = /^нельзя\s+замен(ять|ить)\s+(.+)$/i.exec(text);
  if (cannotReplaceRuB) {
    return { kind: "cannot_replace", target: normalizeText(cannotReplaceRuB[2]) };
  }

  if (/персональн.*данн.*нельзя.*лог|pii.*(cannot|must not).*(log|logs)/i.test(text)) {
    return { kind: "no_pii_logs" };
  }

  return { kind: "generic" };
}

export { extractKeywords, normalizeText, normalizeToken, parseInvariantRule };
