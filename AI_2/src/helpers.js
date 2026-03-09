// /src/helpers.js
export function normalizeUsage(dto) {
  const u = dto && dto.usage ? dto.usage : null;
  const input = u && Number.isFinite(u.input_tokens) ? u.input_tokens : null;
  const output = u && Number.isFinite(u.output_tokens) ? u.output_tokens : null;
  const total = u && Number.isFinite(u.total_tokens) ? u.total_tokens : null;

  if (input == null || output == null || total == null) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
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
