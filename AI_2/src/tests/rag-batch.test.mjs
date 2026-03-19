import assert from "node:assert/strict";
import {
  buildBatchMarkdownReport,
  buildBatchReportFilename,
  RAG_TEST_MODES,
  TEST_QUESTIONS,
} from "../rag-batch.js";

async function main() {
  const sampleResults = [
    {
      questionId: TEST_QUESTIONS[0].id,
      question: TEST_QUESTIONS[0].question,
      expectedFocus: TEST_QUESTIONS[0].expectedFocus,
      notes: "",
      mode: RAG_TEST_MODES[0],
      answerText: "Тестовый ответ",
      retrievalQuery: "analytics alternatives google analytics",
      rewriteApplied: false,
      candidatesBeforeFilterCount: 3,
      finalChunksCount: 2,
      topChunkIds: ["c1", "c2"],
      topSimilarities: [0.91, 0.88],
      minSimilarity: null,
      topKBefore: 3,
      topKAfter: 3,
      chunks: [
        {
          chunk_id: "c1",
          source: "doc",
          section: "Analytics",
          similarity: 0.91,
          preview: "preview text",
        },
      ],
      contextText: "",
      debug: null,
      error: null,
    },
    {
      questionId: TEST_QUESTIONS[0].id,
      question: TEST_QUESTIONS[0].question,
      expectedFocus: TEST_QUESTIONS[0].expectedFocus,
      notes: "",
      mode: RAG_TEST_MODES[1],
      answerText: "",
      retrievalQuery: "",
      rewriteApplied: false,
      candidatesBeforeFilterCount: 0,
      finalChunksCount: 0,
      topChunkIds: [],
      topSimilarities: [],
      minSimilarity: null,
      topKBefore: null,
      topKAfter: null,
      chunks: [],
      contextText: "",
      debug: null,
      error: "network error",
    },
  ];

  const markdown = buildBatchMarkdownReport(sampleResults, {
    generatedAt: new Date("2026-03-19T12:00:00Z"),
    questions: [TEST_QUESTIONS[0]],
    modes: [RAG_TEST_MODES[0], RAG_TEST_MODES[1]],
    model: "gemma3",
    indexUrl: "./static/index_structured.json",
    embeddingModel: "embeddinggemma",
  });

  assert.match(markdown, /# RAG Batch Test Report/);
  assert.match(markdown, /## Вопрос 1/);
  assert.match(markdown, /### baseline/);
  assert.match(markdown, /Тестовый ответ/);
  assert.match(markdown, /network error/);
  assert.match(markdown, /# Summary/);

  const filename = buildBatchReportFilename(new Date("2026-03-19T12:34:00"));
  assert.equal(filename, "rag-batch-report-2026-03-19-12-34.md");
}

main();
