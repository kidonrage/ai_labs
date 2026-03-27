import { LLM_CONFIG_TEST_CONFIGS, LLM_TEST_SYSTEM_PROMPT } from "./llm-config-test/configs.js";
import { buildLlmConfigTestReportFilename, downloadMarkdownFile } from "./llm-config-test/download.js";
import { LLM_CONFIG_TEST_QUESTIONS } from "./llm-config-test/questions.js";
import { LlmConfigTestReportBuilder } from "./llm-config-test/report-builder.js";
import { LlmConfigTestRunner, normalizeRunError } from "./llm-config-test/runner.js";

const runner = new LlmConfigTestRunner();
const reportBuilder = new LlmConfigTestReportBuilder();

const runLlmConfigTest = (sourceAgent, options = {}) => runner.run(sourceAgent, options);
const buildLlmConfigTestReport = (results, metadata = {}) => reportBuilder.build(results, metadata);

export {
  buildLlmConfigTestReport,
  buildLlmConfigTestReportFilename,
  downloadMarkdownFile,
  LLM_CONFIG_TEST_CONFIGS,
  LLM_CONFIG_TEST_QUESTIONS,
  LLM_TEST_SYSTEM_PROMPT,
  normalizeRunError,
  runLlmConfigTest,
};
