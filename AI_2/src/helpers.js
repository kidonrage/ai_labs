// /src/helpers.js
export function normalizeUsage(dto) {
  const source =
    dto && typeof dto === "object"
      ? dto.usage && typeof dto.usage === "object"
        ? dto.usage
        : dto
      : null;
  const toFiniteNumber = (value) => {
    if (Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const pick = (...values) => {
    for (const v of values) {
      const n = toFiniteNumber(v);
      if (n != null) return n;
    }
    return null;
  };

  const input = source
    ? pick(
        source.input_tokens,
        source.inputTokens,
        source.prompt_tokens,
        source.promptTokens,
        source.prompt_eval_count,
      )
    : null;
  const output = source
    ? pick(
        source.output_tokens,
        source.outputTokens,
        source.completion_tokens,
        source.completionTokens,
        source.eval_count,
      )
    : null;
  const total = source ? pick(source.total_tokens, source.totalTokens) : null;

  if (input == null || output == null) return null;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total != null ? total : input + output,
  };
}

export function computeHistoryTotals(history) {
  // Суммируем usage по всем request'ам.
  // Чтобы не удваивать — учитываем только user сообщения как "request anchor".
  let reqIn = 0;
  let reqOut = 0;
  let reqTotal = 0;
  let costRub = 0;

  for (const m of history) {
    if (m.role !== "user") continue;
    if (Number.isFinite(m.requestInputTokens)) reqIn += m.requestInputTokens;
    if (Number.isFinite(m.requestOutputTokens)) reqOut += m.requestOutputTokens;
    if (Number.isFinite(m.requestTotalTokens)) reqTotal += m.requestTotalTokens;
    if (Number.isFinite(m.costRub)) costRub += m.costRub;
  }

  return {
    requestInputTokens: reqIn,
    requestOutputTokens: reqOut,
    requestTotalTokens: reqTotal,
    costRub,
  };
}

export function mergeTotals(historyTotals, summaryTotals) {
  const h = historyTotals || {
    requestInputTokens: 0,
    requestOutputTokens: 0,
    requestTotalTokens: 0,
    costRub: 0,
  };

  const s = summaryTotals || {
    summaryInputTokens: 0,
    summaryOutputTokens: 0,
    summaryTotalTokens: 0,
    summaryCostRub: 0,
    summaryRequests: 0,
  };

  const totalCost = (Number(h.costRub) || 0) + (Number(s.summaryCostRub) || 0);
  const totalTokens =
    (Number(h.requestTotalTokens) || 0) + (Number(s.summaryTotalTokens) || 0);

  return {
    ...h,
    ...s,
    totalCostRub: totalCost,
    totalTokens,
  };
}

export function round4(x) {
  return Math.round(x * 10_000) / 10_000;
}

export function formatTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatTimeFromISO(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return formatTime();
  }
}

export function shouldRestoreOptimisticUserMessage(
  historyLength,
  baselineLength,
) {
  const current =
    Number.isInteger(historyLength) && historyLength >= 0 ? historyLength : 0;
  const baseline =
    Number.isInteger(baselineLength) && baselineLength >= 0
      ? baselineLength
      : 0;
  return current <= baseline;
}
