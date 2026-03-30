import { LLM_CONFIG_TEST_CONFIGS } from "./configs.js";
import { normalizeRunError } from "./runner.js";

function formatIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toISOString();
}

function formatBlock(label, value, emptyValue = "none") {
  const text = String(value || "").trim();
  return `${label}: ${text || emptyValue}`;
}

function formatSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (list.length === 0) return "- Sources: none";
  return [
    "- Sources:",
    ...list.map(
      (source) =>
        `  - ${source.source || "unknown"} | ${source.section || "unknown"} | ${source.chunk_id || "unknown"}`,
    ),
  ].join("\n");
}

function formatRetrievedChunks(run) {
  const list = Array.isArray(run?.retrievedChunksPreview) ? run.retrievedChunksPreview : [];
  const count = Number.isFinite(run?.retrievedChunkCount) ? run.retrievedChunkCount : 0;
  if (list.length === 0) return `- Retrieved chunks preview: none (count: ${count})`;
  return [
    `- Retrieved chunks preview (count: ${count}):`,
    ...list.map((chunk) => {
      const similarity = Number.isFinite(chunk.similarity) ? chunk.similarity.toFixed(4) : "n/a";
      return `  - ${chunk.chunkId} | ${chunk.source} | ${chunk.section} | similarity: ${similarity} | ${chunk.preview || "no preview"}`;
    }),
  ].join("\n");
}

function buildSummaryRow(config, runs) {
  const total = runs.length;
  const successCount = runs.filter((item) => !item.error).length;
  const errorCount = total - successCount;
  const avgDuration = total > 0
    ? Math.round(runs.reduce((sum, item) => sum + (Number.isFinite(item.durationMs) ? item.durationMs : 0), 0) / total)
    : 0;
  return `| ${config.name} | ${total} | ${avgDuration} | ${successCount} | ${errorCount} |`;
}

class LlmConfigTestReportBuilder {
  build(results, metadata = {}) {
    const configs = Array.isArray(metadata.configs) ? metadata.configs : LLM_CONFIG_TEST_CONFIGS;
    const questionCount = Number(metadata.questionCount) || 0;
    const totalRuns = Number(metadata.totalRuns) || 0;
    const lines = [
      "# LLM Config Test Report",
      "",
      "## Test metadata",
      `- model: ${metadata.model || "qwen3-8b"}`,
      `- total questions: ${questionCount}`,
      `- total configs: ${configs.length}`,
      `- total runs: ${totalRuns}`,
      `- generated at: ${formatIso(metadata.generatedAt || new Date())}`,
      `- rag document: ${metadata.ragDocument || "awesome-selfhosted-readme.md"}`,
      "",
      "## Configs",
      "",
    ];

    for (const config of configs) {
      lines.push(
        `### ${config.name}`,
        `- model: ${config.reportModel || config.model || "qwen3-8b"}`,
        `- temperature: ${config.temperature}`,
        `- maxTokens: ${config.maxTokens}`,
        `- contextWindow: ${config.contextWindow}`,
        "",
      );
    }

    lines.push(
      "## Summary table",
      "",
      "| Config | Runs | Avg duration ms | Success count | Error count |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...configs.map((config) =>
        buildSummaryRow(
          config,
          results.filter((item) => item.configName === config.name),
        ),
      ),
      "",
    );

    for (const config of configs) {
      lines.push(`## Config: ${config.name}`, "");
      const runs = results.filter((item) => item.configName === config.name);
      for (const run of runs) {
        lines.push(
          `### ${run.questionId}`,
          `- Config: ${run.configName}`,
          `- Question: ${run.questionText}`,
          `- Started at: ${formatIso(run.startedAt)}`,
          `- Finished at: ${formatIso(run.finishedAt)}`,
          `- Duration: ${run.durationMs} ms`,
          formatSources(run.sources),
          formatRetrievedChunks(run),
          `- ${formatBlock("Error type", run.errorType)}`,
          `- ${formatBlock("Error message", run.errorMessage ? normalizeRunError(run.errorMessage) : "", "none")}`,
          `- ${formatBlock("Warning message", run.warningMessage)}`,
          `- ${formatBlock("Raw response preview", run.rawResponsePreview)}`,
          "- Final answer:",
          "",
          run.answerText || "(empty answer)",
          "",
        );
      }
    }

    return lines.join("\n");
  }
}

export { LlmConfigTestReportBuilder };
