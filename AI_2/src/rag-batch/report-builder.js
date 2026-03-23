import { getRagModeLabel } from "../rag-modes.js";
import { MARKDOWN_EXPORT_QUESTIONS, RAG_TEST_MODES } from "./constants.js";
import { normalizeError } from "./runner.js";

function formatTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const formatModeLabel = (mode) => `${getRagModeLabel(mode)} (\`${mode}\`)`;
const formatErrorBlock = (error) => [`- Ошибка: да`, "", "```text", normalizeError(error), "```"].join("\n");

function formatChunkList(chunks) {
  const list = Array.isArray(chunks) ? chunks : [];
  if (list.length === 0) return "- Итоговые чанки: не выбраны";
  const lines = ["- Итоговые чанки:"];
  for (const chunk of list) {
    const header = [chunk.chunk_id || "unknown", chunk.source || "unknown", chunk.section || "unknown", Number.isFinite(chunk.similarity) ? chunk.similarity.toFixed(4) : "n/a"].join(" | ");
    lines.push(`  - ${header}`);
    if (chunk.preview) lines.push(`    - preview: ${chunk.preview}`);
  }
  return lines.join("\n");
}

const formatNumberList = (values) =>
  (Array.isArray(values) ? values : []).length === 0
    ? "—"
    : values.map((value) => (Number.isFinite(value) ? value.toFixed(4) : String(value))).join(", ");

const formatIdList = (values) => {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return list.length > 0 ? list.join(", ") : "—";
};

const formatSourcesList = (answerResult) => {
  const list = answerResult && Array.isArray(answerResult.sources) ? answerResult.sources : [];
  return ["#### Sources", ...(list.length === 0 ? ["- none"] : list.map((source) => `- ${source.source || "unknown"} | ${source.section || "unknown"} | ${source.chunk_id || "unknown"}`))].join("\n");
};

const formatQuotesList = (answerResult) => {
  const list = answerResult && Array.isArray(answerResult.quotes) ? answerResult.quotes : [];
  return ["#### Quotes", ...(list.length === 0 ? ["- none"] : list.map((quote) => `- [${quote.chunk_id || "unknown"}] "${quote.quote || ""}"`))].join("\n");
};

class RagBatchReportBuilder {
  buildMarkdownReport(results, metadata = {}) {
    const normalizedResults = Array.isArray(results) ? results : [];
    const questionCases = Array.isArray(metadata.questions) ? metadata.questions : MARKDOWN_EXPORT_QUESTIONS;
    const modes = Array.isArray(metadata.modes) ? metadata.modes : RAG_TEST_MODES;
    const lines = [
      "# RAG Batch Test Report",
      "",
      `Дата/время генерации: ${formatTimestamp(metadata.generatedAt || new Date())}`,
      `Модель: ${metadata.model || "—"}`,
      `Источник индекса: ${metadata.indexUrl || "—"}`,
      `Embedding model: ${metadata.embeddingModel || "—"}`,
      `Количество вопросов: ${questionCases.length}`,
      `Режимы: ${modes.join(", ")}`,
      "",
      "---",
      "",
    ];
    for (let questionIndex = 0; questionIndex < questionCases.length; questionIndex += 1) {
      const questionCase = questionCases[questionIndex];
      lines.push(`## Вопрос ${questionIndex + 1}`, `**ID:** ${questionCase.id}`, `**Текст вопроса:** ${questionCase.question}`);
      if (questionCase.expectedFocus) lines.push(`**Что проверяем:** ${questionCase.expectedFocus}`);
      else if (questionCase.notes) lines.push(`**Примечание:** ${questionCase.notes}`);
      lines.push("");
      for (const mode of modes) {
        const run = normalizedResults.find((item) => item.questionId === questionCase.id && item.mode === mode);
        lines.push(`### ${mode}`);
        if (!run) { lines.push("- Результат: отсутствует", ""); continue; }
        lines.push(
          `- Режим: ${formatModeLabel(mode)}`,
          `- Retrieval query: ${run.retrievalQuery || "—"}`,
          `- Rewrite applied: ${run.rewriteApplied ? "true" : "false"}`,
          `- Candidates before filter: ${run.candidatesBeforeFilterCount}`,
          `- Final chunks count: ${run.finalChunksCount}`,
          `- Max similarity: ${run.maxSimilarity ?? "—"}`,
          `- Average similarity: ${run.averageSimilarity ?? "—"}`,
          `- Top chunk ids: ${formatIdList(run.topChunkIds)}`,
          `- Top similarities: ${formatNumberList(run.topSimilarities)}`,
          `- topKBefore: ${run.topKBefore ?? "—"}`,
          `- topKAfter: ${run.topKAfter ?? "—"}`,
          `- minSimilarity: ${run.minSimilarity ?? "—"}`,
          `- Sources present: ${run.sourcesPresent ? "yes" : "no"}`,
          `- Quotes present: ${run.quotesPresent ? "yes" : "no"}`,
          `- Needs clarification: ${run.needsClarification ? "true" : "false"}`,
          `- Weak context: ${run.weakContext ? "true" : "false"}`,
          `- Evidence consistent: ${run.evidenceConsistent ? "true" : "false"}`,
          formatChunkList(run.chunks),
          "",
        );
        if (run.error) { lines.push(formatErrorBlock(run.error), ""); continue; }
        lines.push("- Answer:", "", run.answerText || "(пустой ответ)", "", formatSourcesList(run.answerResult), "", formatQuotesList(run.answerResult), "");
      }
      lines.push("---", "");
    }
    const successRuns = normalizedResults.filter((item) => !item.error);
    const errorRuns = normalizedResults.filter((item) => item.error);
    lines.push("# Summary", "", "## Статистика", `- Всего вопросов: ${questionCases.length}`, `- Всего прогонов: ${questionCases.length * modes.length}`, `- Успешных: ${successRuns.length}`, `- Ошибок: ${errorRuns.length}`, "", "## Краткая сводка по режимам");
    for (const mode of modes) {
      const modeRuns = normalizedResults.filter((item) => item.mode === mode);
      const okRuns = modeRuns.filter((item) => !item.error);
      const avgFinalChunks = okRuns.length > 0 ? okRuns.reduce((sum, item) => sum + item.finalChunksCount, 0) / okRuns.length : 0;
      const avgCandidates = okRuns.length > 0 ? okRuns.reduce((sum, item) => sum + item.candidatesBeforeFilterCount, 0) / okRuns.length : 0;
      lines.push(
        `### ${mode}`,
        `- Успешных: ${okRuns.length}`,
        `- Ошибок: ${modeRuns.length - okRuns.length}`,
        `- Среднее число итоговых чанков: ${avgFinalChunks.toFixed(2)}`,
        `- Среднее число кандидатов до фильтра: ${avgCandidates.toFixed(2)}`,
        `- Rewrite applied: ${okRuns.filter((item) => item.rewriteApplied).length}`,
        `- Пустых ответов: ${okRuns.filter((item) => !String(item.answerText || "").trim()).length}`,
        `- Ответов с источниками: ${okRuns.filter((item) => item.sourcesPresent).length}`,
        `- Ответов с цитатами: ${okRuns.filter((item) => item.quotesPresent).length}`,
        `- Срабатываний weakContext: ${okRuns.filter((item) => item.weakContext).length}`,
        `- Needs clarification: ${okRuns.filter((item) => item.needsClarification).length}`,
        "",
      );
    }
    return lines.join("\n");
  }
}

export {
  RagBatchReportBuilder,
  formatChunkList,
  formatErrorBlock,
  formatModeLabel,
  formatTimestamp,
};
