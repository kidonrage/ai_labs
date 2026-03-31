const HELP_COMMAND_RE = /^\/help(?:\s+([\s\S]*))?$/i;

const EMPTY_HELP_QUESTION_MESSAGE =
  "Напиши вопрос после `/help`, например: `/help какая структура проекта?`";
const HELP_NO_CONTEXT_ANSWER =
  "В документации проекта не удалось найти достаточно информации для надежного ответа.";

function parseHelpCommand(text) {
  const source = String(text || "");
  const match = HELP_COMMAND_RE.exec(source);
  if (!match) return { isHelpCommand: false, question: "" };
  return {
    isHelpCommand: true,
    question: String(match[1] || "").trim(),
  };
}

class HelpCommandService {
  constructor({ session }) {
    this.session = session;
  }

  isHelpCommand(text) {
    return parseHelpCommand(text).isHelpCommand;
  }

  pushAssistantMessage(text) {
    const agent = this.session.agent;
    if (!agent) return;
    agent.history.push({
      role: "assistant",
      text: String(text || ""),
      at: new Date().toISOString(),
    });
    agent._emitStateChanged();
  }

  async handle(text, userMsg) {
    const agent = this.session.agent;
    if (!agent) return false;
    const command = parseHelpCommand(text);
    if (!command.isHelpCommand) return false;
    if (!command.question) {
      this.pushAssistantMessage(EMPTY_HELP_QUESTION_MESSAGE);
      return true;
    }
    await agent.ragAnswerService.answerWithRag(agent, {
      userText: command.question,
      userMsg,
      draftPlan: null,
      invariantCheck: null,
      ragOptions: {
        forceIDontKnowOnWeakContext: true,
        safeNoDataAnswer: HELP_NO_CONTEXT_ANSWER,
      },
    });
    return true;
  }
}

export {
  EMPTY_HELP_QUESTION_MESSAGE,
  HELP_NO_CONTEXT_ANSWER,
  HelpCommandService,
  parseHelpCommand,
};
