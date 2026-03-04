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

function addContextSummarySeparator(summary) {
  const wrap = document.createElement("div");
  wrap.className = "ctx-separator";

  const label = document.createElement("span");
  const at = summary && typeof summary.at === "string"
    ? formatTimeFromISO(summary.at)
    : formatTime();
  label.textContent = `Контекст суммаризирован (${at})`;
  wrap.appendChild(label);

  $("messages").appendChild(wrap);
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
  summaries = [],
  options = {},
) {
  $("messages").innerHTML = "";

  const historyTotals = computeHistoryTotals(history);
  const globalTotals = mergeTotals(historyTotals, summaryTotals);
  const contextStrategy =
    options && typeof options.contextStrategy === "string"
      ? options.contextStrategy
      : "";
  const keepLastMessages = Math.max(
    1,
    Number(options && options.keepLastMessages) || 12,
  );
  const separatorsByIndex = new Map();
  const addSeparator = (sep) => {
    if (!sep || !Number.isFinite(sep.toIndex)) return;
    const idx = Number(sep.toIndex);
    if (!separatorsByIndex.has(idx)) separatorsByIndex.set(idx, []);
    separatorsByIndex.get(idx).push(sep);
  };

  const summaryList = Array.isArray(summaries) ? summaries : [];
  for (const s of summaryList) {
    addSeparator(s);
  }

  const boundaryIndex =
    contextStrategy === "sliding_window" && history.length > keepLastMessages
      ? history.length - keepLastMessages
      : -1;
  const boundaryAt =
    boundaryIndex >= 0 &&
    history[boundaryIndex] &&
    typeof history[boundaryIndex].at === "string"
      ? history[boundaryIndex].at
      : new Date().toISOString();

  for (let idx = 0; idx < history.length; idx += 1) {
    if (idx === boundaryIndex) {
      addContextSummarySeparator({ at: boundaryAt });
    }
    const m = history[idx];
    const time = m.at ? formatTimeFromISO(m.at) : formatTime();
    const statsLines = messageStatsLines(m);
    addMessage({ role: m.role, text: m.text, meta: { time, statsLines } });
    const separators = separatorsByIndex.get(idx) || [];
    for (const s of separators) {
      addContextSummarySeparator(s);
    }
  }

  renderTotalsBar(globalTotals);
}

export function renderFactsPanel(contextStrategy, memoryLayers) {
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
