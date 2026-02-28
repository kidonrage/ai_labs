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

export function renderHistory(history, summaryTotals) {
  $("messages").innerHTML = "";

  const historyTotals = computeHistoryTotals(history);
  const globalTotals = mergeTotals(historyTotals, summaryTotals);

  for (const m of history) {
    const time = m.at ? formatTimeFromISO(m.at) : formatTime();
    const statsLines = messageStatsLines(m);
    addMessage({ role: m.role, text: m.text, meta: { time, statsLines } });
  }

  renderTotalsBar(globalTotals);
}

export function setBusy(isBusy) {
  const ids = [
    "send",
    "newChat",
    "renameChat",
    "deleteChat",
    "chatSelect",
    "input",
    "model",
    "temperature",
    "baseUrl",
    "apiKey",
  ];

  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = isBusy;
  }

  $("send").textContent = isBusy ? "Sending…" : "Send";
}
