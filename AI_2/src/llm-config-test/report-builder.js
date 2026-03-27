import { LLM_CONFIG_TEST_CONFIGS } from "./configs.js";
import { normalizeRunError } from "./runner.js";

function formatIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toISOString();
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
          `- Question: ${run.questionText}`,
          `- Started at: ${formatIso(run.startedAt)}`,
          `- Finished at: ${formatIso(run.finishedAt)}`,
          `- Duration: ${run.durationMs} ms`,
          formatSources(run.sources),
          `- Error: ${run.error ? normalizeRunError(run.error) : "none"}`,
          "- Answer:",
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
