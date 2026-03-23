import { API_MODES, requiresAuthorization } from "../api-profiles.js";
import { OpenAIModelPricing } from "../pricing.js";
import { extractJsonObject } from "./json.js";
import { applyMemoryWritePatch, extractMemoryWritePatch } from "./memory-patcher.js";

class MemoryUpdateService {
  constructor(modelGateway) {
    this.modelGateway = modelGateway;
  }

  async update(agent, nextUserText) {
    if (agent.apiMode === API_MODES.OLLAMA_TOOLS_CHAT) return;
    if (requiresAuthorization(agent.apiMode) && !agent.apiKey) {
      throw new Error("API key пустой (нужен для memory update).");
    }
    const keepLast = Math.max(1, Number(agent.contextPolicy.keepLastMessages) || 12);
    const recentMessages = agent.history.slice(-keepLast);
    const contextBlock =
      recentMessages.length > 0
        ? recentMessages
            .map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${String(item.text || "").trim()}`)
            .filter(Boolean)
            .join("\n")
        : "(empty)";
    const input =
      `SYSTEM: Ты извлекаешь изменения памяти из контекста и нового сообщения пользователя.\n` +
      `Верни ТОЛЬКО JSON-объект строго формата:\n` +
      `{"write":{"working":{"set_goal":null,"add_constraints":[],"add_decisions":[],"add_open_questions":[],"merge_entities":{},"add_artifacts":[]},"long_term":{"add_preferences":{},"add_facts":[],"add_profile":{},"add_stable_decisions":[]}}}\n` +
      `Правила:\n- Заполняй только то, что действительно следует из сообщения и контекста.\n- Если нечего менять: верни пустые массивы/объекты и null для set_goal.\n- Не выдумывай факты.\n- Пиши значения на русском, если нет явного указания на другой язык.\n` +
      `ACTIVE USER PROFILE:\n${JSON.stringify(agent.userProfile, null, 2)}\n` +
      `LONG_TERM_MEMORY:\n${JSON.stringify(agent.longTermMemory, null, 2)}\n` +
      `WORKING_MEMORY:\n${JSON.stringify(agent.workingMemory, null, 2)}\n` +
      `INVARIANTS:\n${JSON.stringify(agent.invariants, null, 2)}\n` +
      `CONTEXT:\n${contextBlock}\n` +
      `USER_MESSAGE:\n${String(nextUserText || "").trim()}\nJSON:\n`;
    const completion = await this.modelGateway.requestModelText(agent, {
      input,
      temperature: agent.contextPolicy.memoryTemperature ?? 0.1,
      modelOverride: this.modelGateway.memoryModelName(agent),
    });
    const parsed = extractJsonObject(completion.answerText);
    const writePatch = extractMemoryWritePatch(parsed);
    if (!writePatch) throw new Error("Memory: модель вернула невалидный write-патч.");
    const nextState = applyMemoryWritePatch({
      longTermMemory: agent.longTermMemory,
      workingMemory: agent.workingMemory,
      writePatch,
    });
    agent.longTermMemory = nextState.longTermMemory;
    agent.workingMemory = nextState.workingMemory;
    if (completion.usage) {
      agent.summaryTotals.summaryRequests += 1;
      agent.summaryTotals.summaryInputTokens += completion.usage.inputTokens;
      agent.summaryTotals.summaryOutputTokens += completion.usage.outputTokens;
      agent.summaryTotals.summaryTotalTokens += completion.usage.totalTokens;
      const costRub = OpenAIModelPricing.costRub(
        completion.modelName,
        completion.usage.inputTokens,
        completion.usage.outputTokens,
      );
      if (costRub != null) agent.summaryTotals.summaryCostRub += costRub;
    }
    agent._emitStateChanged();
  }
}

export { MemoryUpdateService };
