import {
  buildLlmConfigTestReport,
  buildLlmConfigTestReportFilename,
  downloadMarkdownFile,
  LLM_CONFIG_TEST_CONFIGS,
  LLM_CONFIG_TEST_QUESTIONS,
  runLlmConfigTest,
} from "../llm-config-test.js";
import { renderTaskStatus, setBusy } from "../ui.js";
import {
  setLlmConfigTestDownloadState,
  setLlmConfigTestStatus,
} from "./ui-renderers.js";

function formatProgress(progress) {
  if (!progress || progress.state !== "running") return "";
  const completed = Number(progress.completedRuns) || 0;
  const total = Number(progress.totalRuns) || 0;
  const nextRun = completed + 1;
  return `${nextRun}/${total} • ${progress.config?.name || "unknown"} • ${progress.question?.id || "question"}`;
}

class LlmConfigTestController {
  constructor({ session, isUiBusy, setTestRunning }) {
    this.session = session;
    this.isUiBusy = isUiBusy;
    this.setTestRunning = setTestRunning;
    this.latestReport = "";
    this.latestFilename = "";
  }

  resetReportDownload() {
    this.latestReport = "";
    this.latestFilename = "";
    setLlmConfigTestDownloadState(false);
  }

  handleDownload() {
    if (!this.latestReport || !this.latestFilename) return;
    downloadMarkdownFile(this.latestReport, this.latestFilename);
  }

  async handleRun() {
    const agent = this.session.agent;
    if (!agent || this.isUiBusy()) return;
    this.session.syncAgentConfig();
    this.setTestRunning(true);
    setBusy(this.isUiBusy());
    this.resetReportDownload();
    setLlmConfigTestStatus("running", "Preparing test run...");
    const generatedAt = new Date();
    try {
      const results = await runLlmConfigTest(agent, {
        configs: LLM_CONFIG_TEST_CONFIGS,
        questions: LLM_CONFIG_TEST_QUESTIONS,
        onProgress: (progress) => {
          if (progress.state === "running") {
            setLlmConfigTestStatus("running", formatProgress(progress));
          }
        },
      });
      this.latestReport = buildLlmConfigTestReport(results, {
        configs: LLM_CONFIG_TEST_CONFIGS,
        generatedAt,
        model: "qwen3-8b",
        questionCount: LLM_CONFIG_TEST_QUESTIONS.length,
        ragDocument: "awesome-selfhosted-readme.md",
        totalRuns: LLM_CONFIG_TEST_CONFIGS.length * LLM_CONFIG_TEST_QUESTIONS.length,
      });
      this.latestFilename = buildLlmConfigTestReportFilename(generatedAt);
      setLlmConfigTestDownloadState(true, this.latestFilename);
      downloadMarkdownFile(this.latestReport, this.latestFilename);
      const errorCount = results.filter((item) => item.error).length;
      setLlmConfigTestStatus("done", `Runs: ${results.length}, errors: ${errorCount}`);
    } catch (error) {
      this.resetReportDownload();
      setLlmConfigTestStatus(
        "error",
        error && error.message ? error.message : String(error),
      );
    } finally {
      this.setTestRunning(false);
      setBusy(this.isUiBusy());
      renderTaskStatus(agent.taskState, { isBusy: this.isUiBusy() });
    }
  }
}

export { LlmConfigTestController };
