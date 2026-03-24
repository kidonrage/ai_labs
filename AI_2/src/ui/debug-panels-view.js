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

class DebugPanelsView {
  constructor(getRagModeLabel) {
    this.getRagModeLabel = getRagModeLabel;
    this.activeTab = "memory";
    this.bindTabEvents();
  }

  bindTabEvents() {
    const tabsWrap = $("debugPanel");
    if (!tabsWrap) return;
    tabsWrap.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tab = target.closest("[data-debug-tab]");
      if (!(tab instanceof HTMLButtonElement)) return;
      this.setActiveTab(tab.dataset.debugTab || "memory");
    });
  }

  setActiveTab(tabId) {
    const nextTab = ["memory", "invariant", "rag"].includes(tabId) ? tabId : "memory";
    this.activeTab = nextTab;
    for (const [name, buttonId, panelId] of [
      ["memory", "debugTabMemory", "debugPanelMemory"],
      ["invariant", "debugTabInvariant", "debugPanelInvariant"],
      ["rag", "debugTabRag", "debugPanelRag"],
    ]) {
      const button = $(buttonId);
      const panel = $(panelId);
      const isActive = name === nextTab;
      if (button) {
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      }
      if (panel) panel.hidden = !isActive;
    }
  }

  showPanel() {
    const panel = $("debugPanel");
    if (!panel) return;
    panel.hidden = false;
    this.setActiveTab(this.activeTab);
  }

  renderFactsPanel(memoryLayers) {
    const content = $("factsContent");
    if (!content) return;
    this.showPanel();
    const normalized =
      memoryLayers && typeof memoryLayers === "object" && !Array.isArray(memoryLayers)
        ? memoryLayers
        : {};
    content.textContent = JSON.stringify(normalized, null, 2);
  }

  renderInvariantPanel(invariants, invariantCheck) {
    const content = $("invariantContent");
    if (!content) return;
    this.showPanel();
    const check =
      invariantCheck && typeof invariantCheck === "object" && !Array.isArray(invariantCheck)
        ? invariantCheck
        : null;
    content.textContent = JSON.stringify(
      {
        invariants: Array.isArray(invariants) ? invariants : [],
        invariantCheck: check,
        decision: check
          ? {
              state: check.conflict ? "conflict" : "no_conflict",
              violatedInvariants: Array.isArray(check.violatedInvariants)
                ? check.violatedInvariants.map((item) => item.invariant)
                : [],
              allowedAlternative:
                typeof check.safeAlternative === "string" && check.safeAlternative.trim()
                  ? check.safeAlternative
                  : "",
            }
          : null,
      },
      null,
      2,
    );
  }

  renderRagPanel(ragResult) {
    const summary = $("ragSummary");
    const meta = $("ragMeta");
    const chunksWrap = $("ragChunks");
    if (!summary || !meta || !chunksWrap) return;
    this.showPanel();
    const result =
      ragResult && typeof ragResult === "object" && !Array.isArray(ragResult)
        ? ragResult
        : { enabled: false, chunks: [], error: null };
    if (!result.enabled) {
      summary.textContent = "RAG выключен";
      meta.hidden = true;
      meta.innerHTML = "";
      chunksWrap.innerHTML = '<div class="rag-empty">RAG выключен для текущего чата.</div>';
      return;
    }
    if (typeof result.error === "string" && result.error.trim()) {
      summary.textContent = `Ошибка RAG: ${result.error}`;
      meta.hidden = true;
      meta.innerHTML = "";
      chunksWrap.innerHTML = '<div class="rag-empty">RAG завершился с ошибкой.</div>';
      return;
    }
    const chunks = Array.isArray(result.chunks) ? result.chunks : [];
    const candidatesBefore = Array.isArray(result.candidatesBeforeFilter)
      ? result.candidatesBeforeFilter
      : [];
    const configUsed = result.configUsed && typeof result.configUsed === "object" ? result.configUsed : {};
    const diagnostics = result.diagnostics && typeof result.diagnostics === "object" ? result.diagnostics : {};
    const answerResult = result.answerResult && typeof result.answerResult === "object" ? result.answerResult : null;
    const filteringMeta =
      result.debug?.filteringMeta && typeof result.debug.filteringMeta === "object"
        ? result.debug.filteringMeta
        : null;
    const modeLabel = this.getRagModeLabel(configUsed.mode);
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
      .map(
        ([label, value]) =>
          `<div class="rag-meta-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
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

export { DebugPanelsView };
