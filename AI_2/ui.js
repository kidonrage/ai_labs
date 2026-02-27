// /src/ui.js
import { OpenAIModelPricing } from "./pricing.js";
import {
  computeHistoryTotals,
  round4,
  formatTime,
  formatTimeFromISO,
} from "./helpers.js";

const $ = (id) => document.getElementById(id);

function formatCost(x) {
  if (!Number.isFinite(x)) return null;
  return `${round4(x).toFixed(4)} ₽`;
}

export function messageStatsLines(message, historyTotals) {
  const lines = [];

  const model = message.model;
  const hasUsage =
    Number.isFinite(message.requestInputTokens) &&
    Number.isFinite(message.requestOutputTokens);

  // Per-message: tokens/cost
  if (hasUsage) {
    const inTok = message.requestInputTokens;
    const outTok = message.requestOutputTokens;
    const totalTok = Number.isFinite(message.requestTotalTokens)
      ? message.requestTotalTokens
      : inTok + outTok;

    if (message.role === "user") {
      // "для текущего запроса" — это input_tokens
      const perMsgCost = OpenAIModelPricing.costPartsRub(model || "", inTok, 0);
      const c = perMsgCost ? perMsgCost.inCost : null;

      lines.push(
        `request tokens: in ${inTok}, out ${outTok}, total ${totalTok}`,
      );
      if (model) lines.push(`model: ${model}`);
      if (c != null)
        lines.push(`this message cost: ${formatCost(c)} (input only)`);
    } else {
      // assistant message cost is output part
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

    // optional duration
    if (message.durationSeconds != null) {
      lines.push(`duration: ${message.durationSeconds}s`);
    }

    // History totals (global)
    if (historyTotals) {
      lines.push(
        `history total: in ${historyTotals.requestInputTokens}, out ${historyTotals.requestOutputTokens}, total ${historyTotals.requestTotalTokens}`,
      );
      lines.push(`history cost: ${formatCost(historyTotals.costRub)}`);
    }
  } else {
    // No usage available (e.g., restored old history without usage)
    if (model) lines.push(`model: ${model}`);
    if (historyTotals) {
      lines.push(
        `history total: in ${historyTotals.requestInputTokens}, out ${historyTotals.requestOutputTokens}, total ${historyTotals.requestTotalTokens}`,
      );
      lines.push(`history cost: ${formatCost(historyTotals.costRub)}`);
    }
  }

  return lines;
}

export function addMessage({ role, text, meta = {} }, historyTotals = null) {
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

  // Stats
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

export function renderTotalsBar(totals) {
  const el = $("totals");
  if (!el) return;

  const hasAny =
    totals &&
    (totals.requestTotalTokens > 0 ||
      (Number.isFinite(totals.costRub) && totals.costRub > 0));

  if (!hasAny) {
    el.textContent = "History totals: —";
    return;
  }

  el.textContent =
    `History totals — tokens: in ${totals.requestInputTokens}, out ${totals.requestOutputTokens}, total ${totals.requestTotalTokens} • ` +
    `cost: ${formatCost(totals.costRub)}`;
}

export function renderHistory(history) {
  $("messages").innerHTML = "";

  const totals = computeHistoryTotals(history);

  for (const m of history) {
    const time = m.at ? formatTimeFromISO(m.at) : formatTime();
    const statsLines = messageStatsLines(m, totals);
    addMessage(
      { role: m.role, text: m.text, meta: { time, statsLines } },
      totals,
    );
  }

  // Sticky footer total
  renderTotalsBar(totals);
}

export function setBusy(isBusy) {
  $("send").disabled = isBusy;
  $("newChat").disabled = isBusy;
  $("input").disabled = isBusy;
  $("model").disabled = isBusy;
  $("temperature").disabled = isBusy;
  $("baseUrl").disabled = isBusy;
  $("apiKey").disabled = isBusy;
  $("send").textContent = isBusy ? "Sending…" : "Send";
}
