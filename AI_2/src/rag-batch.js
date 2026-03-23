import { RagBatchReportBuilder, formatChunkList, formatErrorBlock, formatModeLabel, formatTimestamp } from "./rag-batch/report-builder.js";
import { RagBatchRunner } from "./rag-batch/runner.js";

export { MARKDOWN_EXPORT_QUESTIONS, RAG_TEST_MODES, TEST_QUESTIONS } from "./rag-batch/constants.js";
export { buildBatchReportFilename, downloadMarkdownFile } from "./rag-batch/download.js";
export { formatChunkList, formatErrorBlock, formatModeLabel, formatTimestamp };

const runner = new RagBatchRunner();
const reportBuilder = new RagBatchReportBuilder();

export const runAgentForQuestion = (sourceAgent, questionCase, mode) =>
  runner.runAgentForQuestion(sourceAgent, questionCase, mode);
export const runRagBatch = (sourceAgent, options = {}) => runner.runBatch(sourceAgent, options);
export const buildBatchMarkdownReport = (results, metadata = {}) =>
  reportBuilder.buildMarkdownReport(results, metadata);
