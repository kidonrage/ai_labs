export const OpenAIModelPricing = {
  // ₽ per 1M tokens
  rates: {
    "gpt-5.2": { input: 531.0, output: 4245.0 },
    "gpt-4.1": { input: 516.0, output: 2062.0 },
    "gpt-3.5-turbo": { input: 129.0, output: 387.0 },
  },

  key(model) {
    if (!model) return null;
    if (model.startsWith("gpt-5.2")) return "gpt-5.2";
    if (model.startsWith("gpt-4.1")) return "gpt-4.1";
    if (model.startsWith("gpt-3.5-turbo")) return "gpt-3.5-turbo";
    return null;
  },

  costRub(model, inputTokens, outputTokens) {
    const k = this.key(model);
    if (!k || !this.rates[k]) return null;
    const r = this.rates[k];
    const inCost = (Number(inputTokens || 0) / 1_000_000) * r.input;
    const outCost = (Number(outputTokens || 0) / 1_000_000) * r.output;
    return inCost + outCost;
  },

  costPartsRub(model, inputTokens, outputTokens) {
    const k = this.key(model);
    if (!k || !this.rates[k]) return null;
    const r = this.rates[k];
    const inCost = (Number(inputTokens || 0) / 1_000_000) * r.input;
    const outCost = (Number(outputTokens || 0) / 1_000_000) * r.output;
    return { inCost, outCost, total: inCost + outCost, key: k };
  },
};
