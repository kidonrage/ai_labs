function makeDefaultLongTermMemory() {
  return {
    profile: { name: null, language: "ru", role: null },
    preferences: { verbosity: "normal", format: ["structured"] },
    facts: [],
    stable_decisions: [],
  };
}

function makeDefaultWorkingMemory() {
  return {
    task: {
      goal: null,
      constraints: [],
      entities: {},
      decisions: [],
      open_questions: [],
      artifacts: [],
    },
  };
}

function normalizeStringArray(arr) {
  return Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeLongTermMemory(value) {
  const base = makeDefaultLongTermMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const profileRaw = value.profile && typeof value.profile === "object" ? value.profile : {};
  const preferencesRaw =
    value.preferences && typeof value.preferences === "object" ? value.preferences : {};
  return {
    profile: {
      name: typeof profileRaw.name === "string" && profileRaw.name.trim() ? profileRaw.name.trim() : null,
      language:
        typeof profileRaw.language === "string" && profileRaw.language.trim()
          ? profileRaw.language.trim()
          : base.profile.language,
      role: typeof profileRaw.role === "string" && profileRaw.role.trim() ? profileRaw.role.trim() : null,
    },
    preferences: {
      verbosity:
        typeof preferencesRaw.verbosity === "string" && preferencesRaw.verbosity.trim()
          ? preferencesRaw.verbosity.trim()
          : base.preferences.verbosity,
      format: (() => {
        const format = normalizeStringArray(preferencesRaw.format);
        return format.length > 0 ? format : base.preferences.format;
      })(),
    },
    facts: normalizeStringArray(value.facts),
    stable_decisions: normalizeStringArray(value.stable_decisions),
  };
}

function normalizeWorkingMemory(value) {
  const base = makeDefaultWorkingMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const taskRaw = value.task && typeof value.task === "object" ? value.task : {};
  const rawEntities =
    taskRaw.entities && typeof taskRaw.entities === "object" && !Array.isArray(taskRaw.entities)
      ? taskRaw.entities
      : {};
  const entities = {};
  for (const [key, item] of Object.entries(rawEntities)) {
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (!normalizedKey) continue;
    if (["string", "number", "boolean"].includes(typeof item) || item === null) {
      entities[normalizedKey] = item;
    }
  }
  return {
    task: {
      goal: typeof taskRaw.goal === "string" && taskRaw.goal.trim() ? taskRaw.goal.trim() : null,
      constraints: normalizeStringArray(taskRaw.constraints),
      entities,
      decisions: normalizeStringArray(taskRaw.decisions),
      open_questions: normalizeStringArray(taskRaw.open_questions),
      artifacts: normalizeStringArray(taskRaw.artifacts),
    },
  };
}

const makeDefaultSummaryTotals = () => ({
  summaryRequests: 0,
  summaryInputTokens: 0,
  summaryOutputTokens: 0,
  summaryTotalTokens: 0,
  summaryCostRub: 0,
});

const makeDefaultContextPolicy = () => ({
  keepLastMessages: 20,
  memoryModel: "gpt-3.5-turbo",
  memoryTemperature: 0.1,
});

const makeDefaultRagConfig = () => ({
  enabled: false,
  mode: "baseline",
  indexUrl: "./static/index_structured.json",
  embeddingApiUrl: "http://localhost:11434/api/embed",
  embeddingModel: "embeddinggemma",
  topK: 3,
  topKBefore: 8,
  topKAfter: 3,
  minSimilarity: 0.45,
  answerMinSimilarity: 0.05,
  forceIDontKnowOnWeakContext: true,
  rewriteEnabled: false,
  filteringEnabled: false,
  rewriteApiMode: "ollama_chat",
  rewriteBaseUrl: "http://localhost:11434",
  rewriteModel: "gemma3",
  rewriteTemperature: 0,
});

const makeDefaultLastRagResult = () => ({
  enabled: false,
  chunks: [],
  question: "",
  retrievalQuery: "",
  contextText: "",
  candidatesBeforeFilter: [],
  diagnostics: null,
  answerResult: null,
  configUsed: null,
  debug: null,
  error: null,
});

export {
  makeDefaultContextPolicy,
  makeDefaultLastRagResult,
  makeDefaultLongTermMemory,
  makeDefaultRagConfig,
  makeDefaultSummaryTotals,
  makeDefaultWorkingMemory,
  normalizeLongTermMemory,
  normalizeWorkingMemory,
};
