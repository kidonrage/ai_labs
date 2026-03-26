import { getRagModeConfig } from "../rag.js";
import { DEFAULT_EMBEDDING_API_URL } from "../rag/constants.js";
import { DEFAULT_RAG_MODE, normalizeRagMode, RAG_MODE_OPTIONS } from "../rag-modes.js";
import { $ } from "./utils.js";

function syncRagModeVisibility() {
  const ragModeField = $("ragModeField");
  const ragEnabled = $("ragEnabled");
  if (!ragModeField || !ragEnabled) return;
  ragModeField.hidden = ragEnabled.value !== "on";
}

function populateRagModeSelect() {
  const select = $("ragRetrievalMode");
  if (!select) return;
  select.innerHTML = RAG_MODE_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join("");
  select.value = DEFAULT_RAG_MODE;
}

function pickRagConfigOverrides(source) {
  const raw = source && typeof source === "object" ? source : {};
  return {
    indexUrl: raw.indexUrl,
    embeddingApiUrl: raw.embeddingApiUrl,
    embeddingModel: raw.embeddingModel,
    minSimilarity: raw.minSimilarity,
    answerMinSimilarity: raw.answerMinSimilarity,
    forceIDontKnowOnWeakContext: raw.forceIDontKnowOnWeakContext,
    rewriteApiMode: raw.rewriteApiMode,
    rewriteBaseUrl: raw.rewriteBaseUrl,
    rewriteModel: raw.rewriteModel,
    rewriteTemperature: raw.rewriteTemperature,
  };
}

function normalizeEmbeddingApiUrl(value, fallback = DEFAULT_EMBEDDING_API_URL) {
  const candidate = String(value || fallback || "").trim();
  if (!candidate) return DEFAULT_EMBEDDING_API_URL;
  return /\/api\/embed\/?$/i.test(candidate)
    ? candidate
    : `${candidate.replace(/\/+$/, "")}/api/embed`;
}

function buildRagConfigFromUi(baseConfig = {}) {
  const selectedMode = normalizeRagMode($("ragRetrievalMode")?.value);
  return {
    ...getRagModeConfig(selectedMode, pickRagConfigOverrides(baseConfig)),
    enabled: $("ragEnabled")?.value === "on",
    embeddingApiUrl: normalizeEmbeddingApiUrl(
      $("ragEmbeddingBaseUrl")?.value,
      baseConfig.embeddingApiUrl,
    ),
  };
}

function syncRagControlsFromAgent(boundAgent) {
  const ragConfig = boundAgent?.ragConfig && typeof boundAgent.ragConfig === "object" ? boundAgent.ragConfig : {};
  if ($("ragEnabled")) $("ragEnabled").value = ragConfig.enabled ? "on" : "off";
  if ($("ragRetrievalMode")) $("ragRetrievalMode").value = normalizeRagMode(ragConfig.mode);
  if ($("ragEmbeddingBaseUrl")) {
    $("ragEmbeddingBaseUrl").value = normalizeEmbeddingApiUrl(ragConfig.embeddingApiUrl);
  }
  syncRagModeVisibility();
}

export { buildRagConfigFromUi, populateRagModeSelect, syncRagControlsFromAgent, syncRagModeVisibility };
