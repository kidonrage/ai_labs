import { isOllamaFamilyMode } from "../api-profiles.js";
import {
  generateAnswerWithSourcesAndQuotes,
  makeSafeAnswerResult,
  retrieveChunks,
} from "../rag.js";

class RagAnswerService {
  constructor({ contextBuilder, modelGateway }) {
    this.contextBuilder = contextBuilder;
    this.modelGateway = modelGateway;
  }

  buildModelRequest(agent, inputText, runtimeContext = null) {
    return {
      input: this.contextBuilder.build(agent, inputText, runtimeContext),
      messages: isOllamaFamilyMode(agent.apiMode)
        ? this.contextBuilder.buildOllamaChatMessages(agent, inputText, runtimeContext)
        : null,
    };
  }

  pushAssistantMessage(agent, completion, answerText, answerResult = null) {
    const usage = completion?.usage || null;
    const message = {
      role: "assistant",
      text: answerText,
      at: new Date().toISOString(),
      model: completion?.modelName || "rag-cited-answer",
      requestInputTokens: usage ? usage.inputTokens : undefined,
      requestOutputTokens: usage ? usage.outputTokens : undefined,
      requestTotalTokens: usage ? usage.totalTokens : undefined,
      costRub: completion?.costRub != null ? completion.costRub : undefined,
      durationSeconds:
        completion?.durationSeconds != null ? completion.durationSeconds : undefined,
    };
    if (answerResult) message.answerResult = answerResult;
    agent.history.push(message);
    agent._emitStateChanged();
  }

  async generateFinalResponse(agent, { userText, userMsg, draftPlan, invariantCheck, rag = null }) {
    const runtimeContext = { draftPlan, invariantCheck, rag };
    const request = this.buildModelRequest(agent, userText, runtimeContext);
    const completion = await this.modelGateway.requestModelText(agent, {
      userMsg,
      input: request.input,
      messages: request.messages,
      temperature: agent.temperature,
    });
    this.pushAssistantMessage(agent, completion, completion.answerText);
    return {
      answer: completion.answerText,
      model: completion.modelName,
      usage: completion.usage,
      durationSeconds: completion.durationSeconds,
      costRub: completion.costRub,
      warningMessage: completion.warningMessage || null,
      rawResponsePreview: completion.rawResponsePreview || "",
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
    let completion = null;
    const answerResult = await generateAnswerWithSourcesAndQuotes(
      payload.userText,
      rag,
      {
        ...agent.ragConfig,
        requestCompletion: async (promptSpec) => {
          const ragPrompt =
            promptSpec && typeof promptSpec === "object" && !Array.isArray(promptSpec)
              ? promptSpec
              : {
                  question: String(payload.userText || "").trim(),
                  contextText: rag.contextText,
                  answerPolicy: "",
                };
          const runtimeContext = {
            draftPlan: payload.draftPlan,
            invariantCheck: payload.invariantCheck,
            rag: {
              question: ragPrompt.question,
              contextText: ragPrompt.contextText,
              answerPolicy: ragPrompt.answerPolicy,
            },
          };
          const request = this.buildModelRequest(agent, payload.userText, runtimeContext);
          completion = await this.modelGateway.requestModelText(agent, {
            userMsg: payload.userMsg,
            input: request.input,
            messages: request.messages,
            temperature: agent.temperature,
          });
          return completion.answerText;
        },
      },
    );
    this.pushAssistantMessage(agent, completion, answerResult.answer, answerResult);
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
      answer: answerResult.answer,
      answerResult,
      model: completion?.modelName || "rag-cited-answer",
      usage: completion?.usage || null,
      durationSeconds: completion?.durationSeconds ?? null,
      costRub: completion?.costRub ?? null,
      warningMessage: completion?.warningMessage || null,
      rawResponsePreview: completion?.rawResponsePreview || "",
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
