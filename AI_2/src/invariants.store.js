const DEFAULT_INVARIANTS = [
  "Для backend-сервисов использовать только Node.js",
  "PostgreSQL нельзя заменять",
  "Персональные данные нельзя хранить в логах",
];

function normalizeInvariantString(raw) {
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  // Legacy migration path: previous format stored rules inside objects.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.rule === "string" && raw.rule.trim()) return raw.rule.trim();
  }
  return "";
}

function uniqueStrings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeInvariants(input, options = {}) {
  const mergeWithDefaults = Boolean(options && options.mergeWithDefaults);
  const defaults = [...DEFAULT_INVARIANTS];

  if (!Array.isArray(input)) {
    return defaults;
  }

  const provided = uniqueStrings(
    input.map((item) => normalizeInvariantString(item)).filter(Boolean),
  );
  if (!mergeWithDefaults) {
    return provided;
  }

  return uniqueStrings([...defaults, ...provided]);
}

export { DEFAULT_INVARIANTS, normalizeInvariants };
