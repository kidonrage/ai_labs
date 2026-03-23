import {
  DEFAULT_ANSWER_MIN_SIMILARITY,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_MODE,
  DEFAULT_TOP_K,
  DEFAULT_TOP_K_AFTER,
  DEFAULT_TOP_K_BEFORE,
} from "./constants.js";
import {
  normalizeBoolean,
  normalizeFiniteNumber,
  normalizePositiveInt,
} from "./shared.js";

function getRagModePreset(mode) {
  const normalizedMode = typeof mode === "string" && mode.trim() ? mode.trim() : DEFAULT_MODE;
  const presets = {
    baseline: { mode: "baseline", rewriteEnabled: false, filteringEnabled: false, topK: 3, topKBefore: 3, topKAfter: 3, minSimilarity: DEFAULT_MIN_SIMILARITY },
    rewrite_only: { mode: "rewrite_only", rewriteEnabled: true, filteringEnabled: false, topK: 3, topKBefore: 3, topKAfter: 3, minSimilarity: DEFAULT_MIN_SIMILARITY },
    filter_only: { mode: "filter_only", rewriteEnabled: false, filteringEnabled: true, topK: 3, topKBefore: 8, topKAfter: 3, minSimilarity: DEFAULT_MIN_SIMILARITY },
    rewrite_and_filter: { mode: "rewrite_and_filter", rewriteEnabled: true, filteringEnabled: true, topK: 3, topKBefore: 8, topKAfter: 3, minSimilarity: DEFAULT_MIN_SIMILARITY },
  };
  return presets[normalizedMode] || presets.baseline;
}

function buildRetrievalConfig(config = {}) {
  const modeConfig = getRagModePreset(config.mode || DEFAULT_MODE);
  const merged = { ...modeConfig, ...config };
  const filteringEnabled =
    typeof merged.filteringEnabled === "boolean"
      ? merged.filteringEnabled
      : Boolean(merged.enableFiltering);
  const rewriteEnabled =
    typeof merged.rewriteEnabled === "boolean"
      ? merged.rewriteEnabled
      : Boolean(merged.enableRewrite);
  const topK = normalizePositiveInt(merged.topK, DEFAULT_TOP_K);
  return {
    ...merged,
    mode: typeof merged.mode === "string" && merged.mode.trim() ? merged.mode : DEFAULT_MODE,
    rewriteEnabled,
    filteringEnabled,
    topK,
    topKBefore: normalizePositiveInt(merged.topKBefore, filteringEnabled ? DEFAULT_TOP_K_BEFORE : topK),
    topKAfter: normalizePositiveInt(merged.topKAfter, topK),
    minSimilarity: normalizeFiniteNumber(merged.minSimilarity, DEFAULT_MIN_SIMILARITY),
    answerMinSimilarity: normalizeFiniteNumber(
      merged.answerMinSimilarity,
      DEFAULT_ANSWER_MIN_SIMILARITY,
    ),
    forceIDontKnowOnWeakContext: normalizeBoolean(merged.forceIDontKnowOnWeakContext, true),
    postProcessingStages: Array.isArray(merged.postProcessingStages)
      ? merged.postProcessingStages.filter((stage) => typeof stage === "function")
      : [],
  };
}

function getRagModeConfig(mode, overrides = {}) {
  const preset = getRagModePreset(mode);
  return buildRetrievalConfig({ ...preset, ...overrides, mode: preset.mode });
}

export { buildRetrievalConfig, getRagModeConfig };
