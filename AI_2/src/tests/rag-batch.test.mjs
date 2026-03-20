import assert from "node:assert/strict";
import {
  buildBatchMarkdownReport,
  buildBatchReportFilename,
  MARKDOWN_EXPORT_QUESTIONS,
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
      answerResult: {
        answer: "Тестовый ответ",
        sources: [{ source: "doc", section: "Analytics", chunk_id: "c1" }],
        quotes: [
          {
            source: "doc",
            section: "Analytics",
            chunk_id: "c1",
            quote: "preview text",
          },
        ],
        needsClarification: false,
        weakContext: false,
      },
      retrievalQuery: "analytics alternatives google analytics",
      rewriteApplied: false,
      candidatesBeforeFilterCount: 3,
      finalChunksCount: 2,
      maxSimilarity: 0.91,
      averageSimilarity: 0.895,
      needsClarification: false,
      weakContext: false,
      sourcesPresent: true,
      quotesPresent: true,
      evidenceConsistent: true,
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
      answerResult: null,
      retrievalQuery: "",
      rewriteApplied: false,
      candidatesBeforeFilterCount: 0,
      finalChunksCount: 0,
      maxSimilarity: null,
      averageSimilarity: null,
      needsClarification: false,
      weakContext: false,
      sourcesPresent: false,
      quotesPresent: false,
      evidenceConsistent: false,
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
  assert.match(markdown, /Sources present: yes/);
  assert.match(markdown, /Quotes present: yes/);
  assert.match(markdown, /#### Sources/);
  assert.match(markdown, /#### Quotes/);
  assert.match(markdown, /network error/);
  assert.match(markdown, /# Summary/);
  assert.match(markdown, /Ответов с источниками: 1/);
  assert.match(markdown, /Ответов с цитатами: 1/);
  assert.equal(MARKDOWN_EXPORT_QUESTIONS.length, 5);
  assert.deepEqual(MARKDOWN_EXPORT_QUESTIONS, TEST_QUESTIONS.slice(0, 5));

  const filename = buildBatchReportFilename(new Date("2026-03-19T12:34:00"));
  assert.equal(filename, "rag-batch-report-2026-03-19-12-34.md");
}

main();
