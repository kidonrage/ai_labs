import { $ } from "./dom.js";
import { round4 } from "../helpers.js";

function formatCost(value) {
  if (!Number.isFinite(value)) return null;
  return `${round4(value).toFixed(4)} ₽`;
}

class TotalsBarView {
  render(globalTotals) {
    const el = $("totals");
    if (!el) return;
    const hasAny =
      globalTotals &&
      (globalTotals.requestTotalTokens > 0 ||
        globalTotals.summaryTotalTokens > 0 ||
        (Number.isFinite(globalTotals.totalCostRub) && globalTotals.totalCostRub > 0));
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
      ? ` • Summary — tokens: ${globalTotals.summaryTotalTokens} (${globalTotals.summaryRequests} req) • cost: ${formatCost(globalTotals.summaryCostRub)} • Total: ${formatCost(globalTotals.totalCostRub)}`
      : "";
    el.textContent = historyPart + summaryPart;
  }
}

export { TotalsBarView };
