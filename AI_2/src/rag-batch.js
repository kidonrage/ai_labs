import { Agent } from "./agent.js";
import {
  getRagModeConfig,
  hasQuotes,
  hasSources,
  isConsistentEnough,
  isWeakContext,
} from "./rag.js";
import { getRagModeLabel } from "./rag-modes.js";

export const RAG_TEST_MODES = Object.freeze([
  "baseline",
  "rewrite_only",
  "filter_only",
  "rewrite_and_filter",
]);

export const TEST_QUESTIONS = Object.freeze([
  {
    id: "q1",
    question:
      "Какие self-hosted альтернативы Google Analytics перечислены в разделе Analytics?",
    expectedFocus:
      "Найти раздел Analytics и перечислить альтернативы Google Analytics.",
  },
  {
    id: "q2",
    question:
      "Найди в разделе Analytics инструмент с лицензией EUPL-1.2 и скажи, на каком языке он написан.",
    expectedFocus:
      "Проверяем поиск по лицензии EUPL-1.2 и извлечение языка реализации.",
  },
  {
    id: "q3",
    question:
      "Какие аналитические инструменты из списка написаны на Nodejs/Docker?",
    expectedFocus:
      "Нужно отфильтровать analytics-инструменты по тегу Nodejs/Docker.",
  },
  {
    id: "q4",
    question:
      "Есть ли в документе self-hosted инструмент для локального запуска LLM-моделей и какие примеры таких инструментов перечислены?",
    expectedFocus:
      "Проверяем поиск по GenAI/LLM разделам и примерам локального запуска моделей.",
  },
  {
    id: "q5",
    question:
      "Какие решения для CalDAV/CardDAV перечислены в разделе Calendar & Contacts?",
    expectedFocus:
      "Найти раздел Calendar & Contacts и вытащить решения для CalDAV/CardDAV.",
  },
  {
    id: "q6",
    question:
      "Мне нужен self-hosted почтовый сервер в Docker с современным web UI. Какие варианты есть в разделе Communication - Email - Complete Solutions?",
    expectedFocus:
      "Ищем complete email solutions с Docker и современным web UI.",
  },
  {
    id: "q7",
    question:
      "Какие решения в разделе Communication - Custom Communication Systems являются альтернативами Slack или Discord?",
    expectedFocus:
      "Проверяем, какие custom communication systems позиционируются как Slack/Discord alternatives.",
  },
  {
    id: "q8",
    question:
      "Найди инструменты с пометкой ⚠ в разделе Automation.",
    expectedFocus:
      "Ищем warning-marked инструменты внутри Automation.",
  },
  {
    id: "q9",
    question:
      "Какой инструмент в разделе Automation описан как “IFTTT for Ops” и что про него сказано?",
    expectedFocus:
      "Проверяем точный поиск по фразе IFTTT for Ops и извлечение описания.",
  },
  {
    id: "q10",
    question:
      "Я хочу self-hosted bookmark manager на Docker, желательно минималистичный и быстрый. Какие варианты из раздела Bookmarks and Link Sharing подходят лучше всего?",
    expectedFocus:
      "Нужно найти подходящие bookmark managers по Docker и признакам minimal/fast.",
  },
]);

export const MARKDOWN_EXPORT_QUESTIONS = Object.freeze(TEST_QUESTIONS.slice(0, 5));

function pickRagOverrides(ragConfig = {}) {
  return {
    indexUrl: ragConfig.indexUrl,
    embeddingApiUrl: ragConfig.embeddingApiUrl,
    embeddingModel: ragConfig.embeddingModel,
    minSimilarity: ragConfig.minSimilarity,
    rewriteApiMode: ragConfig.rewriteApiMode,
    rewriteBaseUrl: ragConfig.rewriteBaseUrl,
    rewriteModel: ragConfig.rewriteModel,
    rewriteTemperature: ragConfig.rewriteTemperature,
  };
}

function createDetachedAgent(sourceAgent, mode) {
  const snapshot = sourceAgent.persistState();
  const detached = new Agent({
    apiMode: sourceAgent.apiMode,
    baseUrl: sourceAgent.baseUrl,
    apiKey: sourceAgent.apiKey,
    model: sourceAgent.model,
    temperature: sourceAgent.temperature,
  });

  detached.loadState(snapshot);
  detached.onStateChanged = null;
  detached.setConfig({
    apiMode: sourceAgent.apiMode,
    baseUrl: sourceAgent.baseUrl,
    apiKey: sourceAgent.apiKey,
    model: sourceAgent.model,
    temperature: sourceAgent.temperature,
  });
  detached.setRagConfig({
    ...getRagModeConfig(mode, pickRagOverrides(sourceAgent.ragConfig)),
    enabled: true,
  });

  return detached;
}

function normalizeError(error) {
  if (!error) return "Неизвестная ошибка.";
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function formatPreview(text, maxLength = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

/**
 * Runs one question through the full detached agent pipeline for a given RAG mode.
 */
export async function runAgentForQuestion(sourceAgent, questionCase, mode) {
  const detached = createDetachedAgent(sourceAgent, mode);
  const questionText = String(questionCase && questionCase.question ? questionCase.question : "").trim();
  if (!questionText) {
    throw new Error("Пустой batch-вопрос.");
  }

  const response = await detached.send(questionText);
  const rag = detached.lastRagResult || {};
  const chunks = Array.isArray(rag.chunks) ? rag.chunks : [];
  const candidatesBeforeFilter = Array.isArray(rag.candidatesBeforeFilter)
    ? rag.candidatesBeforeFilter
    : [];
  const configUsed =
    rag.configUsed && typeof rag.configUsed === "object" ? rag.configUsed : {};
  const answerResult =
    response && response.answerResult && typeof response.answerResult === "object"
      ? response.answerResult
      : null;
  const diagnostics =
    rag.diagnostics && typeof rag.diagnostics === "object" ? rag.diagnostics : {};

  return {
    questionId: questionCase.id,
    question: questionText,
    expectedFocus:
      typeof questionCase.expectedFocus === "string" ? questionCase.expectedFocus : "",
    notes: typeof questionCase.notes === "string" ? questionCase.notes : "",
    mode,
    answerText: response && typeof response.answer === "string" ? response.answer : "",
    answerResult,
    retrievalQuery: typeof rag.retrievalQuery === "string" ? rag.retrievalQuery : "",
    rewriteApplied: Boolean(rag.rewriteApplied),
    candidatesBeforeFilterCount: candidatesBeforeFilter.length,
    finalChunksCount: chunks.length,
    maxSimilarity: Number.isFinite(diagnostics.maxSimilarity) ? diagnostics.maxSimilarity : null,
    averageSimilarity: Number.isFinite(diagnostics.averageSimilarity)
      ? diagnostics.averageSimilarity
      : null,
    needsClarification: Boolean(answerResult && answerResult.needsClarification),
    weakContext: isWeakContext(answerResult),
    sourcesPresent: hasSources(answerResult),
    quotesPresent: hasQuotes(answerResult),
    evidenceConsistent: isConsistentEnough(answerResult, chunks),
    topChunkIds: chunks.map((chunk) => chunk.chunk_id).filter(Boolean),
    topSimilarities: chunks
      .map((chunk) => chunk.similarity)
      .filter((value) => Number.isFinite(value)),
    minSimilarity: Number.isFinite(configUsed.minSimilarity)
      ? configUsed.minSimilarity
      : null,
    topKBefore: Number.isFinite(configUsed.topKBefore) ? configUsed.topKBefore : null,
    topKAfter: Number.isFinite(configUsed.topKAfter) ? configUsed.topKAfter : null,
    chunks: chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id || null,
      source: chunk.source || "unknown",
      section: chunk.section || "unknown",
      similarity: Number.isFinite(chunk.similarity) ? chunk.similarity : null,
      preview: formatPreview(chunk.text),
    })),
    contextText: typeof rag.contextText === "string" ? rag.contextText : "",
    debug: rag.debug || null,
    error: null,
  };
}

/**
 * Sequentially runs all test questions through all configured RAG modes.
 */
export async function runRagBatch(sourceAgent, options = {}) {
  if (!sourceAgent) {
    throw new Error("Agent не передан для batch-прогона.");
  }

  const questions = Array.isArray(options.questions) && options.questions.length > 0
    ? options.questions
    : TEST_QUESTIONS;
  const modes = Array.isArray(options.modes) && options.modes.length > 0
    ? options.modes
    : RAG_TEST_MODES;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const totalRuns = questions.length * modes.length;
  const results = [];
  let completedRuns = 0;

  for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
    const questionCase = questions[questionIndex];
    for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
      const mode = modes[modeIndex];
      if (onProgress) {
        onProgress({
          questionIndex,
          questionCount: questions.length,
          modeIndex,
          modeCount: modes.length,
          completedRuns,
          totalRuns,
          questionCase,
          mode,
          phase: "running",
        });
      }

      try {
        const runResult = await runAgentForQuestion(sourceAgent, questionCase, mode);
        results.push(runResult);
      } catch (error) {
        results.push({
          questionId: questionCase.id,
          question: questionCase.question,
          expectedFocus:
            typeof questionCase.expectedFocus === "string"
              ? questionCase.expectedFocus
              : "",
          notes: typeof questionCase.notes === "string" ? questionCase.notes : "",
          mode,
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
          error: normalizeError(error),
        });
      }

      completedRuns += 1;
      if (onProgress) {
        onProgress({
          questionIndex,
          questionCount: questions.length,
          modeIndex,
          modeCount: modes.length,
          completedRuns,
          totalRuns,
          questionCase,
          mode,
          phase: "completed",
        });
      }
    }
  }

  return results;
}

/**
 * Formats timestamp for report headers and filenames.
 */
export function formatTimestamp(value = new Date()) {
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

/**
 * Returns a readable label for a mode.
 */
export function formatModeLabel(mode) {
  return `${getRagModeLabel(mode)} (\`${mode}\`)`;
}

/**
 * Formats a markdown error block for a failed run.
 */
export function formatErrorBlock(error) {
  return [`- Ошибка: да`, "", "```text", normalizeError(error), "```"].join("\n");
}

/**
 * Formats a concise markdown list of selected chunks.
 */
export function formatChunkList(chunks) {
  const list = Array.isArray(chunks) ? chunks : [];
  if (list.length === 0) {
    return "- Итоговые чанки: не выбраны";
  }

  const lines = ["- Итоговые чанки:"];
  for (const chunk of list) {
    const header = [
      chunk.chunk_id || "unknown",
      chunk.source || "unknown",
      chunk.section || "unknown",
      Number.isFinite(chunk.similarity) ? chunk.similarity.toFixed(4) : "n/a",
    ].join(" | ");
    lines.push(`  - ${header}`);
    if (chunk.preview) {
      lines.push(`    - preview: ${chunk.preview}`);
    }
  }
  return lines.join("\n");
}

function formatNumberList(values) {
  const list = Array.isArray(values) ? values : [];
  if (list.length === 0) return "—";
  return list
    .map((value) => (Number.isFinite(value) ? value.toFixed(4) : String(value)))
    .join(", ");
}

function formatIdList(values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return list.length > 0 ? list.join(", ") : "—";
}

function formatSourcesList(answerResult) {
  const list =
    answerResult && Array.isArray(answerResult.sources) ? answerResult.sources : [];
  const lines = ["#### Sources"];
  if (list.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }
  for (const source of list) {
    lines.push(
      `- ${source.source || "unknown"} | ${source.section || "unknown"} | ${
        source.chunk_id || "unknown"
      }`,
    );
  }
  return lines.join("\n");
}

function formatQuotesList(answerResult) {
  const list = answerResult && Array.isArray(answerResult.quotes) ? answerResult.quotes : [];
  const lines = ["#### Quotes"];
  if (list.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }
  for (const quote of list) {
    lines.push(`- [${quote.chunk_id || "unknown"}] "${quote.quote || ""}"`);
  }
  return lines.join("\n");
}

/**
 * Builds a markdown report from batch-run results.
 */
export function buildBatchMarkdownReport(results, metadata = {}) {
  const normalizedResults = Array.isArray(results) ? results : [];
  const generatedAt = metadata.generatedAt || new Date();
  const questionCases = Array.isArray(metadata.questions)
    ? metadata.questions
    : MARKDOWN_EXPORT_QUESTIONS;
  const modes = Array.isArray(metadata.modes) ? metadata.modes : RAG_TEST_MODES;

  const lines = [
    "# RAG Batch Test Report",
    "",
    `Дата/время генерации: ${formatTimestamp(generatedAt)}`,
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
    lines.push(`## Вопрос ${questionIndex + 1}`);
    lines.push(`**ID:** ${questionCase.id}`);
    lines.push(`**Текст вопроса:** ${questionCase.question}`);
    if (questionCase.expectedFocus) {
      lines.push(`**Что проверяем:** ${questionCase.expectedFocus}`);
    } else if (questionCase.notes) {
      lines.push(`**Примечание:** ${questionCase.notes}`);
    }
    lines.push("");

    for (const mode of modes) {
      const run = normalizedResults.find(
        (item) => item.questionId === questionCase.id && item.mode === mode,
      );
      lines.push(`### ${mode}`);
      if (!run) {
        lines.push("- Результат: отсутствует");
        lines.push("");
        continue;
      }

      lines.push(`- Режим: ${formatModeLabel(mode)}`);
      lines.push(`- Retrieval query: ${run.retrievalQuery || "—"}`);
      lines.push(`- Rewrite applied: ${run.rewriteApplied ? "true" : "false"}`);
      lines.push(`- Candidates before filter: ${run.candidatesBeforeFilterCount}`);
      lines.push(`- Final chunks count: ${run.finalChunksCount}`);
      lines.push(`- Max similarity: ${run.maxSimilarity ?? "—"}`);
      lines.push(`- Average similarity: ${run.averageSimilarity ?? "—"}`);
      lines.push(`- Top chunk ids: ${formatIdList(run.topChunkIds)}`);
      lines.push(`- Top similarities: ${formatNumberList(run.topSimilarities)}`);
      lines.push(`- topKBefore: ${run.topKBefore ?? "—"}`);
      lines.push(`- topKAfter: ${run.topKAfter ?? "—"}`);
      lines.push(`- minSimilarity: ${run.minSimilarity ?? "—"}`);
      lines.push(`- Sources present: ${run.sourcesPresent ? "yes" : "no"}`);
      lines.push(`- Quotes present: ${run.quotesPresent ? "yes" : "no"}`);
      lines.push(`- Needs clarification: ${run.needsClarification ? "true" : "false"}`);
      lines.push(`- Weak context: ${run.weakContext ? "true" : "false"}`);
      lines.push(`- Evidence consistent: ${run.evidenceConsistent ? "true" : "false"}`);
      lines.push(formatChunkList(run.chunks));
      lines.push("");

      if (run.error) {
        lines.push(formatErrorBlock(run.error));
        lines.push("");
        continue;
      }

      lines.push("- Answer:");
      lines.push("");
      lines.push(run.answerText || "(пустой ответ)");
      lines.push("");
      lines.push(formatSourcesList(run.answerResult));
      lines.push("");
      lines.push(formatQuotesList(run.answerResult));
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  const successRuns = normalizedResults.filter((item) => !item.error);
  const errorRuns = normalizedResults.filter((item) => item.error);
  lines.push("# Summary");
  lines.push("");
  lines.push("## Статистика");
  lines.push(`- Всего вопросов: ${questionCases.length}`);
  lines.push(`- Всего прогонов: ${questionCases.length * modes.length}`);
  lines.push(`- Успешных: ${successRuns.length}`);
  lines.push(`- Ошибок: ${errorRuns.length}`);
  lines.push("");
  lines.push("## Краткая сводка по режимам");

  for (const mode of modes) {
    const modeRuns = normalizedResults.filter((item) => item.mode === mode);
    const okRuns = modeRuns.filter((item) => !item.error);
    const avgFinalChunks =
      okRuns.length > 0
        ? okRuns.reduce((sum, item) => sum + item.finalChunksCount, 0) / okRuns.length
        : 0;
    const avgCandidates =
      okRuns.length > 0
        ? okRuns.reduce((sum, item) => sum + item.candidatesBeforeFilterCount, 0) /
          okRuns.length
        : 0;
    const rewriteAppliedCount = okRuns.filter((item) => item.rewriteApplied).length;
    const emptyAnswers = okRuns.filter((item) => !String(item.answerText || "").trim()).length;
    const withSources = okRuns.filter((item) => item.sourcesPresent).length;
    const withQuotes = okRuns.filter((item) => item.quotesPresent).length;
    const weakContextCount = okRuns.filter((item) => item.weakContext).length;
    const clarificationCount = okRuns.filter((item) => item.needsClarification).length;

    lines.push(`### ${mode}`);
    lines.push(`- Успешных: ${okRuns.length}`);
    lines.push(`- Ошибок: ${modeRuns.length - okRuns.length}`);
    lines.push(`- Среднее число итоговых чанков: ${avgFinalChunks.toFixed(2)}`);
    lines.push(`- Среднее число кандидатов до фильтра: ${avgCandidates.toFixed(2)}`);
    lines.push(`- Rewrite applied: ${rewriteAppliedCount}`);
    lines.push(`- Пустых ответов: ${emptyAnswers}`);
    lines.push(`- Ответов с источниками: ${withSources}`);
    lines.push(`- Ответов с цитатами: ${withQuotes}`);
    lines.push(`- Срабатываний weakContext: ${weakContextCount}`);
    lines.push(`- Needs clarification: ${clarificationCount}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Downloads a markdown file in the browser using Blob + object URL.
 */
export function downloadMarkdownFile(markdown, filename) {
  const blob = new Blob([String(markdown || "")], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Builds a readable default filename for markdown export.
 */
export function buildBatchReportFilename(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    "rag-batch-report",
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
  ].join("-") + ".md";
}
