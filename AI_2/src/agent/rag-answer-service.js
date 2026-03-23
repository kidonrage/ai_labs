import { isOllamaFamilyMode } from "../api-profiles.js";
import {
  buildAnswerResultFromResponse,
  makeSafeAnswerResult,
  retrieveChunks,
} from "../rag.js";

class RagAnswerService {
  constructor({ contextBuilder, modelGateway }) {
    this.contextBuilder = contextBuilder;
    this.modelGateway = modelGateway;
  }

  async generateFinalResponse(agent, { userText, userMsg, draftPlan, invariantCheck, rag = null }) {
    const runtimeContext = { draftPlan, invariantCheck, rag };
    const completion = await this.modelGateway.requestModelText(agent, {
      userMsg,
      input: this.contextBuilder.build(agent, userText, runtimeContext),
      messages: isOllamaFamilyMode(agent.apiMode)
        ? this.contextBuilder.buildOllamaChatMessages(agent, userText, runtimeContext)
        : null,
      temperature: agent.temperature,
    });
    agent.history.push({
      role: "assistant",
      text: completion.answerText,
      at: new Date().toISOString(),
      model: completion.modelName,
      requestInputTokens: completion.usage ? completion.usage.inputTokens : undefined,
      requestOutputTokens: completion.usage ? completion.usage.outputTokens : undefined,
      requestTotalTokens: completion.usage ? completion.usage.totalTokens : undefined,
      costRub: completion.costRub != null ? completion.costRub : undefined,
      durationSeconds:
        completion.durationSeconds != null ? completion.durationSeconds : undefined,
    });
    agent._emitStateChanged();
    return {
      answer: completion.answerText,
      model: completion.modelName,
      usage: completion.usage,
      durationSeconds: completion.durationSeconds,
      costRub: completion.costRub,
      invariantCheck,
      retrievedChunks: rag && Array.isArray(rag.chunks) ? rag.chunks : [],
      refused: false,
    };
  }

  async answerWithoutRag(agent, payload) {
    agent.lastRagResult = {
      enabled: false,
      chunks: [],
      question: String(payload.userText || ""),
      retrievalQuery: "",
      contextText: "",
      candidatesBeforeFilter: [],
      diagnostics: null,
      answerResult: null,
      configUsed: null,
      debug: null,
      error: null,
    };
    agent._emitStateChanged();
    return this.generateFinalResponse(agent, payload);
  }

  async answerWithRag(agent, payload) {
    const rag = await retrieveChunks(payload.userText, agent.ragConfig);
    const response = await this.generateFinalResponse(agent, { ...payload, rag });
    const answerResult = buildAnswerResultFromResponse(response.answer, rag, agent.ragConfig);
    const lastAssistantMessage = agent.history[agent.history.length - 1];
    if (lastAssistantMessage?.role === "assistant") lastAssistantMessage.answerResult = answerResult;
    agent.lastRagResult = {
      enabled: true,
      ...rag,
      chunks: rag.chunks,
      question: String(payload.userText || ""),
      diagnostics: answerResult.diagnostics || rag.diagnostics || null,
      answerResult,
      error: null,
    };
    agent._emitStateChanged();
    return {
      answer: response.answer,
      answerResult,
      model: response.model,
      usage: response.usage,
      durationSeconds: response.durationSeconds,
      costRub: response.costRub,
      invariantCheck: payload.invariantCheck,
      retrievedChunks: Array.isArray(rag.chunks) ? rag.chunks : [],
      refused: false,
    };
  }

  buildSafeRagError(error) {
    return {
      enabled: true,
      chunks: [],
      question: "",
      diagnostics: null,
      answerResult: makeSafeAnswerResult({
        answer: error && error.message ? `Ошибка: ${error.message}` : `Ошибка: ${String(error)}`,
      }),
      error: error && error.message ? error.message : String(error),
    };
  }
}

export { RagAnswerService };
