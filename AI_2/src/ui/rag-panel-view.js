import { getRagModeLabel } from "../rag-modes.js";
import { $ } from "./dom.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeRagSnippet(text, maxLength = 220) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

class RagPanelView {
  render(ragResult) {
    const panel = $("ragPanel");
    const summary = $("ragSummary");
    const meta = $("ragMeta");
    const chunksWrap = $("ragChunks");
    if (!panel || !summary || !meta || !chunksWrap) return;
    const result =
      ragResult && typeof ragResult === "object" && !Array.isArray(ragResult)
        ? ragResult
        : { enabled: false, chunks: [], error: null };
    if (!result.enabled) {
      panel.hidden = true;
      panel.open = false;
      summary.textContent = "RAG выключен";
      meta.hidden = true;
      meta.innerHTML = "";
      chunksWrap.innerHTML = "";
      return;
    }
    if (typeof result.error === "string" && result.error.trim()) {
      panel.hidden = false;
      panel.open = false;
      summary.textContent = `Ошибка RAG: ${result.error}`;
      meta.hidden = true;
      meta.innerHTML = "";
      chunksWrap.innerHTML = "";
      return;
    }
    const chunks = Array.isArray(result.chunks) ? result.chunks : [];
    const candidatesBefore = Array.isArray(result.candidatesBeforeFilter) ? result.candidatesBeforeFilter : [];
    const configUsed = result.configUsed && typeof result.configUsed === "object" ? result.configUsed : {};
    const diagnostics = result.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {};
    const answerResult = result.answerResult && typeof result.answerResult === "object" ? result.answerResult : null;
    const filteringMeta = result.debug?.filteringMeta && typeof result.debug.filteringMeta === "object" ? result.debug.filteringMeta : null;
    const modeLabel = getRagModeLabel(configUsed.mode);
    panel.hidden = false;
    panel.open = false;
    summary.textContent = `Режим: ${modeLabel} • Чанков: ${chunks.length}`;
    meta.hidden = false;
    meta.innerHTML = [
      ["Режим", modeLabel],
      ["Retrieval query", result.retrievalQuery || "—"],
      ["Rewrite", result.rewriteApplied ? "Да" : "Нет"],
      ["Фильтрация", configUsed.filteringEnabled ? "Да" : "Нет"],
      ["Кандидатов до фильтра", String(candidatesBefore.length)],
      ["Чанков после отбора", String(chunks.length)],
      ["Max similarity", Number.isFinite(diagnostics.maxSimilarity) ? diagnostics.maxSimilarity.toFixed(4) : "—"],
      ["Average similarity", Number.isFinite(diagnostics.averageSimilarity) ? diagnostics.averageSimilarity.toFixed(4) : "—"],
      ["Weak context", answerResult?.weakContext ? "Да" : "Нет"],
      ["Needs clarification", answerResult?.needsClarification ? "Да" : "Нет"],
      ["Threshold", filteringMeta && Number.isFinite(filteringMeta.threshold) ? filteringMeta.threshold.toFixed(2) : "—"],
    ]
      .map(([label, value]) => `<div class="rag-meta-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join("");
    chunksWrap.innerHTML =
      chunks.length === 0
        ? '<div class="rag-empty">Подходящие чанки не найдены.</div>'
        : chunks
            .map(
              (chunk, index) => `
        <article class="rag-chunk">
          <div class="rag-chunk-row"><strong>Rank:</strong> ${index + 1}</div>
          <div class="rag-chunk-row"><strong>Chunk:</strong> ${escapeHtml(chunk.chunk_id || "unknown")}</div>
          <div class="rag-chunk-row"><strong>Similarity:</strong> ${Number.isFinite(chunk.similarity) ? chunk.similarity.toFixed(4) : "n/a"}</div>
          <div class="rag-chunk-row"><strong>Source:</strong> ${escapeHtml(chunk.source || "unknown")}</div>
          <div class="rag-chunk-row"><strong>Section:</strong> ${escapeHtml(chunk.section || "unknown")}</div>
          <div class="rag-chunk-text">${escapeHtml(makeRagSnippet(chunk.text))}</div>
        </article>`,
            )
            .join("");
  }
}

export { RagPanelView };
