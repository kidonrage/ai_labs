import assert from "node:assert/strict";
import { normalizeUsage } from "../helpers.js";

async function main() {
  assert.deepEqual(
    normalizeUsage({
      usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
    }),
    { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
  );

  assert.deepEqual(
    normalizeUsage({
      usage: { inputTokens: 2000, outputTokens: 500, totalTokens: 2500 },
    }),
    { inputTokens: 2000, outputTokens: 500, totalTokens: 2500 },
  );

  assert.deepEqual(
    normalizeUsage({
      usage: {
        prompt_tokens: "900",
        completion_tokens: "100",
        total_tokens: "1000",
      },
    }),
    { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
  );

  assert.deepEqual(
    normalizeUsage({
      usage: { input_tokens: 700, output_tokens: 50 },
    }),
    { inputTokens: 700, outputTokens: 50, totalTokens: 750 },
  );

  assert.deepEqual(
    normalizeUsage({
      prompt_eval_count: 42,
      eval_count: 9,
    }),
    { inputTokens: 42, outputTokens: 9, totalTokens: 51 },
  );

  assert.equal(normalizeUsage({ usage: { input_tokens: "abc" } }), null);
  assert.equal(normalizeUsage({}), null);
}

main();
