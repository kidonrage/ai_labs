import { formatTime, shouldRestoreOptimisticUserMessage } from "../helpers.js";
import { renderHistory, renderTaskStatus } from "../ui.js";
import { HelpCommandService } from "./help-command-service.js";
import { $ } from "./utils.js";

function parseTaskCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const startMatch = /^start:\s*(.*)$/i.exec(trimmed);
  if (startMatch) return startMatch[1].trim() ? { type: "start", goal: startMatch[1].trim() } : { type: "start_empty" };
  if (/^pause$/i.test(trimmed)) return { type: "pause" };
  if (/^continue$/i.test(trimmed)) return { type: "continue" };
  if (/^approve$/i.test(trimmed)) return { type: "approve" };
  if (/^reset task$/i.test(trimmed)) return { type: "reset_task" };
  return null;
}

const isActiveTaskStage = (stage) => ["planning", "execution", "validation"].includes(stage);

class ComposerController {
  constructor({ session, isUiBusy, setSending, renderWorkspaceChrome }) {
    this.session = session;
    this.isUiBusy = isUiBusy;
    this.setSending = setSending;
    this.renderWorkspaceChrome = renderWorkspaceChrome;
    this.helpCommand = new HelpCommandService({ session });
  }

  pushAssistantMessage(text) {
    this.session.agent.history.push({ role: "assistant", text: String(text || ""), at: new Date().toISOString() });
    this.session.agent._emitStateChanged();
  }

  async handleTaskCommandOrStep(text) {
    const agent = this.session.agent;
    if (!agent) return false;
    const command = parseTaskCommand(text);
    const stage = agent.taskState?.stage || "idle";
    const pushStageChangedMessage = (transition) => {
      if (transition && transition.from !== transition.to) this.pushAssistantMessage(`Task stage changed: ${transition.from} -> ${transition.to}`);
    };
    if (command?.type === "start") {
      agent.startTask(command.goal);
      pushStageChangedMessage({ from: stage, to: "planning" });
      const result = await agent.runTaskStep({ userMessage: text });
      pushStageChangedMessage(result.transition);
      this.pushAssistantMessage(result.text);
      return true;
    }
    if (command?.type === "start_empty") return this.pushAssistantMessage("Формат команды: start: <описание задачи>"), true;
    if (command?.type === "pause") return agent.pauseTask() ? (pushStageChangedMessage({ from: stage, to: "paused" }), this.pushAssistantMessage("Задача поставлена на паузу."), true) : (this.pushAssistantMessage("Пауза недоступна: нет активного шага planning/execution/validation."), true);
    if (command?.type === "continue") {
      const pausedFrom = agent.taskState?.pausedFrom || null;
      if (!agent.continueTask()) return this.pushAssistantMessage("Продолжение недоступно: задача не на паузе."), true;
      pushStageChangedMessage({ from: "paused", to: agent.taskState?.stage || "idle" });
      if (isActiveTaskStage(agent.taskState?.stage)) {
        if (agent.taskState.expectedAction === "await_approval") this.pushAssistantMessage("Восстановлен этап. Можно отправить доработки текущего этапа или approve для перехода дальше.");
        else {
          const result = await agent.runTaskStep({ userMessage: text });
          pushStageChangedMessage(result.transition);
          this.pushAssistantMessage(result.text);
        }
      } else {
        this.pushAssistantMessage(pausedFrom ? `Продолжение выполнено. Восстановлен этап ${pausedFrom.stage}, шаг ${pausedFrom.step}.` : "Продолжение выполнено.");
      }
      return true;
    }
    if (command?.type === "approve") {
      if (!isActiveTaskStage(stage)) return this.pushAssistantMessage("Подтверждение перехода недоступно: нет активного этапа planning/execution/validation."), true;
      if (!agent.approveNextStage()) return this.pushAssistantMessage("Сначала заверши текущий этап (получи артефакт), затем отправь approve."), true;
      const changed = agent.advanceToNextStage();
      pushStageChangedMessage(changed);
      this.pushAssistantMessage(isActiveTaskStage(agent.taskState?.stage) ? `Переход подтверждён. Текущий этап: ${agent.taskState.stage}. Отправьте сообщение для выполнения шага.` : "Переход подтверждён. Задача завершена.");
      return true;
    }
    if (command?.type === "reset_task") return agent.resetTask(), pushStageChangedMessage({ from: stage, to: "idle" }), this.pushAssistantMessage("Task state сброшен в idle, артефакты очищены."), true;
    if (stage === "paused") return this.pushAssistantMessage("Задача на паузе. Используйте continue или кнопку Continue."), true;
    if (isActiveTaskStage(stage)) {
      const result = await agent.runTaskStep({ userMessage: text });
      pushStageChangedMessage(result.transition);
      this.pushAssistantMessage(result.text);
      return true;
    }
    return false;
  }

  async sendTaskControlCommand(commandText) {
    if (!this.session.agent || this.isUiBusy()) return;
    $("input").value = commandText;
    await this.handleSend();
  }

  async handleSend() {
    const agent = this.session.agent;
    const text = $("input").value;
    if (!text.trim() || !agent || this.isUiBusy()) return;
    this.session.syncAgentConfig();
    const isHelpCommand = this.helpCommand.isHelpCommand(text);
    const historyBaselineLength = Array.isArray(agent.history) ? agent.history.length : 0;
    const optimisticUser = { role: "user", text, at: new Date().toISOString() };
    agent.history.push(optimisticUser);
    agent._emitStateChanged();
    renderHistory(agent.history, agent.summaryTotals, { keepLastMessages: agent.contextPolicy.keepLastMessages });
    $("input").value = "";
    $("input").focus();
    this.setSending(true);
    const typing = document.createElement("div");
    typing.className = "msg assistant";
    typing.innerHTML = `<div class="meta"><span class="badge">ASSISTANT</span><span class="time">${formatTime()}</span></div><div class="text">…</div>`;
    $("messages").appendChild(typing);
    $("messages").scrollTop = $("messages").scrollHeight;
    let handledByTaskMachine = false;
    let handledByHelpCommand = false;
    let poppedForRegularSend = false;
    try {
      if (isHelpCommand) {
        handledByHelpCommand = await this.helpCommand.handle(text, optimisticUser);
      } else {
        handledByTaskMachine = await this.handleTaskCommandOrStep(text);
      }
      if (!handledByTaskMachine && !handledByHelpCommand) {
        agent.history.pop();
        poppedForRegularSend = true;
        agent._emitStateChanged();
        await agent.send(text);
      }
      typing.remove();
      renderHistory(agent.history, agent.summaryTotals, { keepLastMessages: agent.contextPolicy.keepLastMessages });
    } catch (err) {
      typing.remove();
      if (poppedForRegularSend && shouldRestoreOptimisticUserMessage(Array.isArray(agent.history) ? agent.history.length : 0, historyBaselineLength)) {
        agent.history.push(optimisticUser);
      }
      agent.history.push({ role: "assistant", text: `Ошибка: ${err && err.message ? err.message : String(err)}`, at: new Date().toISOString() });
      agent._emitStateChanged();
      renderHistory(agent.history, agent.summaryTotals, { keepLastMessages: agent.contextPolicy.keepLastMessages });
    } finally {
      this.setSending(false);
      renderTaskStatus(agent.taskState, { isBusy: this.isUiBusy() });
      this.renderWorkspaceChrome();
    }
  }
}

export { ComposerController };
