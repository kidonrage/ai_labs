import { OpenAIModelPricing } from "../pricing.js";
import {
  computeHistoryTotals,
  formatTime,
  formatTimeFromISO,
  mergeTotals,
  round4,
} from "../helpers.js";
import { $ } from "./dom.js";

function formatCost(value) {
  if (!Number.isFinite(value)) return null;
  return `${round4(value).toFixed(4)} ₽`;
}

function formatEvidenceQuote(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function messageStatsLines(message) {
  const lines = [];
  const hasUsage =
    Number.isFinite(message.requestInputTokens) && Number.isFinite(message.requestOutputTokens);
  if (hasUsage) {
    const inTok = message.requestInputTokens;
    const outTok = message.requestOutputTokens;
    const totalTok = Number.isFinite(message.requestTotalTokens)
      ? message.requestTotalTokens
      : inTok + outTok;
    const perMsgCost =
      message.role === "user"
        ? OpenAIModelPricing.costPartsRub(message.model || "", inTok, 0)
        : OpenAIModelPricing.costPartsRub(message.model || "", 0, outTok);
    lines.push(`request tokens: in ${inTok}, out ${outTok}, total ${totalTok}`);
    if (message.model) lines.push(`model: ${message.model}`);
    if (perMsgCost) {
      lines.push(
        `this message cost: ${formatCost(message.role === "user" ? perMsgCost.inCost : perMsgCost.outCost)} (${message.role === "user" ? "input only" : "output only"})`,
      );
    }
    if (message.durationSeconds != null) lines.push(`duration: ${message.durationSeconds}s`);
  } else if (message.model) {
    lines.push(`model: ${message.model}`);
  }
  return lines;
}

class MessageListView {
  constructor(totalsBarView) {
    this.totalsBarView = totalsBarView;
  }

  scrollToBottom() {
    const messages = $("messages");
    if (!messages) return;
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }

  addMessage({ role, text, meta = {} }) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    wrap.innerHTML = `<div class="meta"><span class="badge">${role === "user" ? "USER" : "ASSISTANT"}</span><span class="time">${meta.time || formatTime()}</span></div><div class="text"></div>`;
    wrap.querySelector(".text").textContent = text;
    const answerResult = meta.answerResult && typeof meta.answerResult === "object" ? meta.answerResult : null;
    if (answerResult) {
      const evidence = document.createElement("div");
      evidence.className = "evidence";
      if (answerResult.needsClarification) {
        const el = document.createElement("span");
        el.className = "evidence-note";
        el.textContent = answerResult.weakContext ? "Недостаточно контекста, нужен уточняющий вопрос." : "Нужно уточнение.";
        evidence.appendChild(el);
      }
      for (const [title, list, map] of [
        ["Источники:", Array.isArray(answerResult.sources) ? answerResult.sources : [], (item) => `${item.source || "unknown"} | ${item.section || "unknown"} | ${item.chunk_id || "unknown"}`],
        ["Цитаты:", Array.isArray(answerResult.quotes) ? answerResult.quotes : [], (item) => `[${item.chunk_id || "unknown"}] "${formatEvidenceQuote(item.quote)}"`],
      ]) {
        if (list.length === 0) continue;
        const header = document.createElement("div");
        header.className = "evidence-title";
        header.textContent = title;
        evidence.appendChild(header);
        for (const item of list) {
          const row = document.createElement("div");
          row.className = "evidence-item";
          row.textContent = map(item);
          evidence.appendChild(row);
        }
      }
      if (evidence.childElementCount > 0) wrap.appendChild(evidence);
    }
    if (Array.isArray(meta.statsLines) && meta.statsLines.length > 0) {
      const stats = document.createElement("div");
      stats.className = "stats";
      for (const line of meta.statsLines) {
        const el = document.createElement("span");
        el.textContent = line;
        stats.appendChild(el);
      }
      wrap.appendChild(stats);
    }
    $("messages").appendChild(wrap);
    this.scrollToBottom();
  }

  renderHistory(history, summaryTotals, options = {}) {
    $("messages").innerHTML = "";
    const globalTotals = mergeTotals(computeHistoryTotals(history), summaryTotals);
    for (const message of history) {
      this.addMessage({
        role: message.role,
        text: message.text,
        meta: {
          time: message.at ? formatTimeFromISO(message.at) : formatTime(),
          statsLines: messageStatsLines(message),
          answerResult: message.answerResult && typeof message.answerResult === "object" ? message.answerResult : null,
        },
      });
    }
    this.scrollToBottom();
    this.totalsBarView.render(globalTotals, options);
  }
}

export { MessageListView, messageStatsLines };
