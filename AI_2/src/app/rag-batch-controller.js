import {
  buildBatchMarkdownReport,
  buildBatchReportFilename,
  downloadMarkdownFile,
  MARKDOWN_EXPORT_QUESTIONS,
  RAG_TEST_MODES,
  runRagBatch,
  TEST_QUESTIONS,
} from "../rag-batch.js";
import { renderTaskStatus, setBusy } from "../ui.js";
import { setBatchRunStatus } from "./ui-renderers.js";

function formatBatchProgress(progress) {
  if (!progress || typeof progress !== "object") return "Идет batch-прогон RAG.";
  const questionNumber = Number(progress.questionIndex) + 1;
  const questionCount = Number(progress.questionCount) || TEST_QUESTIONS.length;
  const modeNumber = Number(progress.modeIndex) + 1;
  const modeCount = Number(progress.modeCount) || RAG_TEST_MODES.length;
  const completedRuns = Number(progress.completedRuns) || 0;
  const totalRuns = Number(progress.totalRuns) || questionCount * modeCount;
  return `${progress.phase === "completed" ? "Завершено" : "Выполняется"}: вопрос ${questionNumber}/${questionCount}, режим ${modeNumber}/${modeCount}, выполнено ${completedRuns} из ${totalRuns}.`;
}

class RagBatchController {
  constructor({ session, isUiBusy, setBatchRunning }) {
    this.session = session;
    this.isUiBusy = isUiBusy;
    this.setBatchRunning = setBatchRunning;
  }

  async handleRun() {
    const agent = this.session.agent;
    if (!agent || this.isUiBusy()) return;
    this.session.syncAgentConfig();
    this.setBatchRunning(true);
    setBusy(this.isUiBusy());
    setBatchRunStatus("Подготовка batch-прогона RAG...");
    const generatedAt = new Date();
    try {
      const results = await runRagBatch(agent, {
        questions: TEST_QUESTIONS,
        modes: RAG_TEST_MODES,
        onProgress: (progress) => setBatchRunStatus(formatBatchProgress(progress)),
      });
      downloadMarkdownFile(
        buildBatchMarkdownReport(results, {
          generatedAt,
          questions: MARKDOWN_EXPORT_QUESTIONS,
          modes: RAG_TEST_MODES,
          model: agent.model,
          indexUrl: agent.ragConfig.indexUrl,
          embeddingModel: agent.ragConfig.embeddingModel,
        }),
        buildBatchReportFilename(generatedAt),
      );
      const errorCount = results.filter((item) => item.error).length;
      setBatchRunStatus(errorCount > 0 ? `Отчет сформирован и скачан. Ошибок в прогонах: ${errorCount}.` : "Отчет сформирован и скачан.", errorCount > 0 ? "error" : "success");
    } catch (error) {
      setBatchRunStatus(`Batch-прогон не завершен: ${error && error.message ? error.message : String(error)}`, "error");
    } finally {
      this.setBatchRunning(false);
      setBusy(this.isUiBusy());
      renderTaskStatus(agent.taskState, { isBusy: this.isUiBusy() });
    }
  }
}

export { RagBatchController };
