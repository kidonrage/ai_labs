import assert from "node:assert/strict";
import {
  buildAnswerResultFromResponse,
  buildRagAnswerPolicy,
  buildCitedAnswerPrompt,
  evaluateContextStrength,
  cosineSimilarity,
  filterChunksBySimilarity,
  generateAnswerWithSourcesAndQuotes,
  getRagModeConfig,
  validateAnswerEvidence,
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

  const retrieval = {
    chunks: [
      {
        chunk_id: "chunk-1",
        source: "doc-1",
        section: "A",
        text: "alpha beta gamma",
        similarity: 0.72,
      },
    ],
    contextText:
      "[Chunk 1]\nchunk_id: chunk-1\nsource: doc-1\nsection: A\ntext:\nalpha beta gamma",
  };
  const diagnostics = evaluateContextStrength(retrieval, {
    answerMinSimilarity: 0.45,
  });
  assert.equal(diagnostics.weakContext, false);
  assert.equal(diagnostics.finalChunksCount, 1);
  assert.equal(diagnostics.maxSimilarity, 0.72);

  const prompt = buildCitedAnswerPrompt("Что найдено?", retrieval.contextText);
  assert.match(prompt, /chunk_id: chunk-1/);
  assert.match(prompt, /Нужен обычный короткий ответ/);
  assert.doesNotMatch(prompt, /JSON:/);

  const answerPolicy = buildRagAnswerPolicy();
  assert.match(answerPolicy, /RETRIEVED CONTEXT/);
  assert.match(answerPolicy, /без markdown и без JSON/);

  let requestCalls = 0;
  const cited = await generateAnswerWithSourcesAndQuotes("Что найдено?", retrieval, {
    requestCompletion: async (promptSpec) => {
      requestCalls += 1;
      assert.equal(promptSpec.question, "Что найдено?");
      assert.match(promptSpec.contextText, /chunk_id: chunk-1/);
      assert.match(promptSpec.answerPolicy, /RETRIEVED CONTEXT/);
      assert.match(promptSpec.prompt, /RAG-контекст:/);
      return JSON.stringify({
        answer: "Найден alpha.",
        sources: [{ source: "doc-1", section: "A", chunk_id: "chunk-1" }],
        quotes: [
          {
            source: "doc-1",
            section: "A",
            chunk_id: "chunk-1",
            quote: "alpha beta",
          },
        ],
        needsClarification: false,
      });
    },
  });
  assert.equal(requestCalls, 1);
  assert.equal(cited.answer, "Найден alpha.");
  assert.equal(cited.sources.length, 1);
  assert.equal(cited.quotes.length, 1);
  assert.equal(cited.weakContext, false);

  const weak = await generateAnswerWithSourcesAndQuotes(
    "Что найдено?",
    { chunks: [], contextText: "" },
    {
      requestCompletion: async () => {
        throw new Error("must not be called");
      },
    },
  );
  assert.equal(weak.weakContext, true);
  assert.equal(weak.needsClarification, true);
  assert.equal(weak.sources.length, 0);
  assert.equal(weak.quotes.length, 0);

  const repaired = await generateAnswerWithSourcesAndQuotes("Что найдено?", retrieval, {
    requestCompletion: async () =>
      JSON.stringify({
        answer: "Найден alpha.",
        sources: [{ source: "broken", section: "broken", chunk_id: "chunk-1" }],
        quotes: [
          {
            source: "broken",
            section: "broken",
            chunk_id: "chunk-1",
            quote: "not exact",
          },
        ],
        needsClarification: false,
      }),
  });
  assert.equal(repaired.answer, "Найден alpha.");
  assert.equal(repaired.sources[0].source, "doc-1");
  assert.equal(repaired.quotes[0].chunk_id, "chunk-1");
  assert.match(repaired.quotes[0].quote, /alpha beta gamma/);

  const plainTextFallback = await generateAnswerWithSourcesAndQuotes("Что найдено?", retrieval, {
    requestCompletion: async () => "Найден alpha в документе.",
  });
  assert.equal(plainTextFallback.answer, "Найден alpha в документе.");
  assert.equal(plainTextFallback.sources.length, 1);
  assert.equal(plainTextFallback.quotes.length, 1);

  const derived = buildAnswerResultFromResponse("Найден alpha в документе.", retrieval);
  assert.equal(derived.answer, "Найден alpha в документе.");
  assert.equal(derived.sources.length, 1);
  assert.equal(derived.quotes.length, 1);
  assert.equal(derived.needsClarification, false);

  const invalidEvidence = validateAnswerEvidence(
    {
      answer: "ok",
      sources: [{ source: "doc-1", section: "A", chunk_id: "chunk-1" }],
      quotes: [
        {
          source: "doc-1",
          section: "A",
          chunk_id: "chunk-1",
          quote: "missing quote",
        },
      ],
      needsClarification: false,
      weakContext: false,
    },
    retrieval.chunks,
  );
  assert.equal(invalidEvidence.valid, false);
  assert.match(invalidEvidence.issues.join(","), /quote_not_in_chunk/);
}

main();
