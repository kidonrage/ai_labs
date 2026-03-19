import assert from "node:assert/strict";
import {
  cosineSimilarity,
  filterChunksBySimilarity,
  getRagModeConfig,
} from "../rag.js";

async function main() {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 2], [1]), -1);

  const candidates = [
    {
      chunk_id: "chunk-1",
      source: "doc-1",
      section: "A",
      text: "alpha",
      similarity: 0.91,
    },
    {
      chunk_id: "chunk-2",
      source: "doc-2",
      section: "B",
      text: "beta",
      similarity: 0.62,
    },
    {
      chunk_id: "chunk-3",
      source: "doc-3",
      section: "C",
      text: "gamma",
      similarity: 0.31,
    },
  ];

  const filtered = filterChunksBySimilarity(candidates, 0.5, 2);
  assert.equal(filtered.length, 2);
  assert.deepEqual(
    filtered.map((chunk) => chunk.chunk_id),
    ["chunk-1", "chunk-2"],
  );

  const fallback = filterChunksBySimilarity(candidates, 0.99, 3);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].chunk_id, "chunk-1");

  const baseline = getRagModeConfig("baseline");
  assert.equal(baseline.rewriteEnabled, false);
  assert.equal(baseline.filteringEnabled, false);
  assert.equal(baseline.topK, 3);
  assert.equal(baseline.topKAfter, 3);

  const combined = getRagModeConfig("rewrite_and_filter", {
    minSimilarity: 0.6,
    topKAfter: 2,
  });
  assert.equal(combined.rewriteEnabled, true);
  assert.equal(combined.filteringEnabled, true);
  assert.equal(combined.topKBefore, 8);
  assert.equal(combined.topKAfter, 2);
  assert.equal(combined.minSimilarity, 0.6);
}

main();
