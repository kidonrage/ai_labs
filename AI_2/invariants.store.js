const DEFAULT_INVARIANTS = [
  {
    id: "backend_stack",
    title: "Стек backend",
    rule: "Для backend-сервисов использовать только Node.js",
    type: "technical",
    check: {
      policy: {
        type: "fixed_stack_scope",
        allowed: "Node.js",
        scope: "backend-сервисы",
      },
      forbiddenPhrases: [],
      safeAlternative:
        "Сохраняем backend на Node.js и улучшаем архитектуру/модули без смены стека.",
    },
  },
  {
    id: "db_fixed",
    title: "База данных",
    rule: "PostgreSQL нельзя заменять",
    type: "technical",
    check: {
      policy: {
        type: "cannot_replace",
        target: "PostgreSQL",
      },
      forbiddenPhrases: [],
      safeAlternative:
        "Оставляем PostgreSQL и улучшаем схему, индексы и запросы без замены СУБД.",
    },
  },
  {
    id: "privacy_logs",
    title: "Приватность",
    rule: "Персональные данные нельзя хранить в логах",
    type: "business",
    check: {
      forbiddenPhrases: [
        "log personal data",
        "store pii in logs",
        "write user passport to logs",
        "логируй персональные данные",
        "сохраняй персональные данные в логах",
      ],
      safeAlternative:
        "Используйте маскирование/редакцию логов, а персональные данные храните только в защищённом хранилище.",
    },
  },
];

function normalizeInvariant(raw, index = 0) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const normalizeString = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : "";
  const checkRaw = src.check && typeof src.check === "object" && !Array.isArray(src.check) ? src.check : {};
  const policyRaw =
    checkRaw.policy && typeof checkRaw.policy === "object" && !Array.isArray(checkRaw.policy)
      ? checkRaw.policy
      : null;
  const forbiddenPhrases = Array.from(
    new Set(
      (Array.isArray(checkRaw.forbiddenPhrases) ? checkRaw.forbiddenPhrases : [])
        .filter((x) => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x.toLowerCase()),
    ),
  );

  return {
    id: normalizeString(src.id) || `invariant_${index + 1}`,
    title: normalizeString(src.title) || `Invariant ${index + 1}`,
    rule: normalizeString(src.rule),
    type: normalizeString(src.type) || "general",
    check: {
      forbiddenPhrases,
      safeAlternative: normalizeString(checkRaw.safeAlternative),
      policy: policyRaw
        ? {
            type: normalizeString(policyRaw.type),
            allowed: normalizeString(policyRaw.allowed),
            scope: normalizeString(policyRaw.scope),
            target: normalizeString(policyRaw.target),
          }
        : null,
    },
  };
}

function normalizeInvariants(input, options = {}) {
  const mergeWithDefaults = Boolean(options && options.mergeWithDefaults);
  const defaults = DEFAULT_INVARIANTS.map((item, idx) => normalizeInvariant(item, idx));
  if (!Array.isArray(input)) {
    return defaults;
  }

  const provided = input
    .map((item, idx) => normalizeInvariant(item, idx))
    .filter((item) => item.rule);
  if (!mergeWithDefaults) {
    return provided;
  }

  const byId = new Map(provided.map((item) => [item.id, item]));

  const merged = defaults.map((def) => {
    const cur = byId.get(def.id);
    if (!cur) return def;
    byId.delete(def.id);
    return {
      id: def.id,
      title: cur.title || def.title,
      rule: cur.rule || def.rule,
      type: cur.type || def.type,
      check: {
        forbiddenPhrases: Array.from(
          new Set([...(def.check.forbiddenPhrases || []), ...(cur.check.forbiddenPhrases || [])]),
        ),
        safeAlternative: cur.check.safeAlternative || def.check.safeAlternative,
      },
    };
  });

  for (const extra of byId.values()) {
    merged.push(extra);
  }
  return merged;
}

export { DEFAULT_INVARIANTS, normalizeInvariants };
