import { OpenAIModelPricing } from "./pricing.js";
import {
  computeHistoryTotals,
  mergeTotals,
  round4,
  formatTime,
  formatTimeFromISO,
} from "./helpers.js";

const $ = (id) => document.getElementById(id);

function formatCost(x) {
  if (!Number.isFinite(x)) return null;
  return `${round4(x).toFixed(4)} ₽`;
}

export function messageStatsLines(message) {
  const lines = [];

  const model = message.model;
  const hasUsage =
    Number.isFinite(message.requestInputTokens) &&
    Number.isFinite(message.requestOutputTokens);

  if (hasUsage) {
    const inTok = message.requestInputTokens;
    const outTok = message.requestOutputTokens;
    const totalTok = Number.isFinite(message.requestTotalTokens)
      ? message.requestTotalTokens
      : inTok + outTok;

    if (message.role === "user") {
      const perMsgCost = OpenAIModelPricing.costPartsRub(model || "", inTok, 0);
      const c = perMsgCost ? perMsgCost.inCost : null;

      lines.push(
        `request tokens: in ${inTok}, out ${outTok}, total ${totalTok}`,
      );
      if (model) lines.push(`model: ${model}`);
      if (c != null)
        lines.push(`this message cost: ${formatCost(c)} (input only)`);
    } else {
      const perMsgCost = OpenAIModelPricing.costPartsRub(
        model || "",
        0,
        outTok,
      );
      const c = perMsgCost ? perMsgCost.outCost : null;

      lines.push(
        `request tokens: in ${inTok}, out ${outTok}, total ${totalTok}`,
      );
      if (model) lines.push(`model: ${model}`);
      if (c != null)
        lines.push(`this message cost: ${formatCost(c)} (output only)`);
    }

    if (message.durationSeconds != null) {
      lines.push(`duration: ${message.durationSeconds}s`);
    }
  } else {
    if (model) lines.push(`model: ${model}`);
  }

  return lines;
}

export function addMessage({ role, text, meta = {} }) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;

  const metaRow = document.createElement("div");
  metaRow.className = "meta";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = role === "user" ? "USER" : "ASSISTANT";
  metaRow.appendChild(badge);

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = meta.time || formatTime();
  metaRow.appendChild(time);

  wrap.appendChild(metaRow);

  const textDiv = document.createElement("div");
  textDiv.className = "text";
  textDiv.textContent = text;
  wrap.appendChild(textDiv);

  const statsLines = meta.statsLines || [];
  if (statsLines.length > 0) {
    const stats = document.createElement("div");
    stats.className = "stats";

    for (const line of statsLines) {
      const el = document.createElement("span");
      el.textContent = line;
      stats.appendChild(el);
    }
    wrap.appendChild(stats);
  }

  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

export function renderTotalsBar(globalTotals) {
  const el = $("totals");
  if (!el) return;

  const hasAny =
    globalTotals &&
    (globalTotals.requestTotalTokens > 0 ||
      globalTotals.summaryTotalTokens > 0 ||
      (Number.isFinite(globalTotals.totalCostRub) &&
        globalTotals.totalCostRub > 0));

  if (!hasAny) {
    el.textContent = "History totals: —";
    return;
  }

  const historyPart =
    `History — tokens: ${globalTotals.requestTotalTokens} ` +
    `(in ${globalTotals.requestInputTokens}, out ${globalTotals.requestOutputTokens}) • ` +
    `cost: ${formatCost(globalTotals.costRub)}`;

  const hasSummary =
    (globalTotals.summaryRequests || 0) > 0 ||
    (globalTotals.summaryTotalTokens || 0) > 0 ||
    (globalTotals.summaryCostRub || 0) > 0;

  const summaryPart = hasSummary
    ? ` • Summary — tokens: ${globalTotals.summaryTotalTokens} (${globalTotals.summaryRequests} req) • cost: ${formatCost(
        globalTotals.summaryCostRub,
      )} • Total: ${formatCost(globalTotals.totalCostRub)}`
    : "";

  el.textContent = historyPart + summaryPart;
}

export function renderHistory(
  history,
  summaryTotals,
  options = {},
) {
  $("messages").innerHTML = "";

  const historyTotals = computeHistoryTotals(history);
  const globalTotals = mergeTotals(historyTotals, summaryTotals);

  for (let idx = 0; idx < history.length; idx += 1) {
    const m = history[idx];
    const time = m.at ? formatTimeFromISO(m.at) : formatTime();
    const statsLines = messageStatsLines(m);
    addMessage({ role: m.role, text: m.text, meta: { time, statsLines } });
  }

  renderTotalsBar(globalTotals);
}

export function renderFactsPanel(memoryLayers) {
  const panel = $("factsPanel");
  const content = $("factsContent");
  if (!panel || !content) return;

  panel.hidden = false;
  const normalized =
    memoryLayers && typeof memoryLayers === "object" && !Array.isArray(memoryLayers)
      ? memoryLayers
      : {};
  content.textContent = JSON.stringify(normalized, null, 2);
}

export function renderInvariantPanel(invariants, invariantCheck) {
  const panel = $("invariantPanel");
  const content = $("invariantContent");
  if (!panel || !content) return;

  panel.hidden = false;
  const normalizedInvariants = Array.isArray(invariants) ? invariants : [];
  const check =
    invariantCheck && typeof invariantCheck === "object" && !Array.isArray(invariantCheck)
      ? invariantCheck
      : null;

  const decision = check
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
    : null;

  content.textContent = JSON.stringify(
    {
      invariants: normalizedInvariants,
      invariantCheck: check,
      decision,
    },
    null,
    2,
  );
}

export function renderTaskStatus(taskState, options = {}) {
  const stageEl = $("taskStage");
  const stepEl = $("taskStep");
  const expectedEl = $("taskExpectedAction");
  const pausedFromEl = $("taskPausedFrom");
  const pausedBadge = $("taskPausedBadge");
  const pauseBtn = $("pauseTask");
  const continueBtn = $("continueTask");
  const panel = $("taskStatusPanel");
  if (!stageEl || !stepEl || !expectedEl || !pausedFromEl || !pausedBadge || !pauseBtn || !continueBtn || !panel) {
    return;
  }

  const raw = taskState && typeof taskState === "object" && !Array.isArray(taskState)
    ? taskState
    : {};
  const stage = typeof raw.stage === "string" ? raw.stage : "idle";
  const step = Number.isFinite(raw.step) ? raw.step : 0;
  const expectedAction =
    typeof raw.expectedAction === "string" && raw.expectedAction.trim()
      ? raw.expectedAction
      : "null";
  const pausedFrom = raw.pausedFrom && typeof raw.pausedFrom === "object" && !Array.isArray(raw.pausedFrom)
    ? raw.pausedFrom
    : null;
  const pausedFromText =
    pausedFrom && typeof pausedFrom.stage === "string" && Number.isFinite(pausedFrom.step)
      ? `${pausedFrom.stage} (step ${pausedFrom.step})`
      : "—";
  const isBusy = Boolean(options && options.isBusy);
  const canPause =
    stage === "planning" || stage === "execution" || stage === "validation";
  const canContinue = stage === "paused";
  const isTaskActive = canPause || canContinue;

  panel.hidden = !isTaskActive;

  stageEl.textContent = stage;
  stepEl.textContent = String(step);
  expectedEl.textContent = expectedAction;
  pausedFromEl.textContent = pausedFromText;
  pausedBadge.hidden = stage !== "paused";

  pauseBtn.disabled = isBusy || !canPause;
  continueBtn.disabled = isBusy || !canContinue;
}

/**
 * Makes a short one-line chunk preview for the retrieval panel.
 */
function makeRagSnippet(text, maxLength = 220) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

/**
 * Renders the latest retrieved chunks for the current chat.
 */
export function renderRagPanel(ragResult) {
  const panel = $("ragPanel");
  const summary = $("ragSummary");
  const chunksWrap = $("ragChunks");
  if (!panel || !summary || !chunksWrap) return;

  const result =
    ragResult && typeof ragResult === "object" && !Array.isArray(ragResult)
      ? ragResult
      : { enabled: false, chunks: [], error: null };

  if (!result.enabled) {
    panel.hidden = true;
    summary.textContent = "RAG выключен";
    chunksWrap.innerHTML = "";
    return;
  }

  panel.hidden = false;

  if (typeof result.error === "string" && result.error.trim()) {
    summary.textContent = `Ошибка RAG: ${result.error}`;
    chunksWrap.innerHTML = "";
    return;
  }

  const chunks = Array.isArray(result.chunks) ? result.chunks : [];
  summary.textContent = `Найдено чанков: ${chunks.length}`;

  if (chunks.length === 0) {
    chunksWrap.innerHTML = '<div class="rag-empty">Подходящие чанки не найдены.</div>';
    return;
  }

  chunksWrap.innerHTML = chunks
    .map(
      (chunk, index) => `
        <article class="rag-chunk">
          <div class="rag-chunk-row"><strong>Rank:</strong> ${index + 1}</div>
          <div class="rag-chunk-row"><strong>Similarity:</strong> ${
            Number.isFinite(chunk.similarity) ? chunk.similarity.toFixed(4) : "n/a"
          }</div>
          <div class="rag-chunk-row"><strong>Source:</strong> ${chunk.source || "unknown"}</div>
          <div class="rag-chunk-row"><strong>Section:</strong> ${chunk.section || "unknown"}</div>
          <div class="rag-chunk-text">${makeRagSnippet(chunk.text)}</div>
        </article>
      `,
    )
    .join("");
}

export function setBusy(isBusy) {
  const ids = [
    "send",
    "newChat",
    "branchChat",
    "profileMenuCreate",
    "renameChat",
    "deleteChat",
    "chatSelect",
    "profileMenuTrigger",
    "input",
    "model",
    "temperature",
    "baseUrl",
    "ragMode",
    "pauseTask",
    "continueTask",
    "invariantSelect",
    "addInvariant",
    "removeInvariant",
  ];

  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = isBusy;
  }

  const profileActionButtons = document.querySelectorAll("[data-profile-action]");
  for (const btn of profileActionButtons) {
    if (btn instanceof HTMLButtonElement) btn.disabled = isBusy;
  }

  $("send").textContent = isBusy ? "Sending…" : "Send";
}
