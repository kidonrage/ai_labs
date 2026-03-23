import { API_MODES } from "../api-profiles.js";
import { buildProfilePriorityInstructions } from "./user-profile.js";

function buildCompactUserMessages(history, nextUserText) {
  const messages = (Array.isArray(history) ? history : [])
    .filter((item) => item && item.role === "user")
    .map((item) => String(item.text || "").trim())
    .filter(Boolean);
  const next = String(nextUserText || "").trim();
  if (next && messages[messages.length - 1] !== next) messages.push(next);
  return messages;
}

class ProxyResponsesContextBuilder {
  build(agent, nextUserText, runtimeContext = null) {
    const keepLast = Math.max(1, Number(agent.contextPolicy.keepLastMessages) || 12);
    const tail = agent.history.slice(-keepLast);
    const parts = [
      `SYSTEM: ${agent.systemPreamble}`,
      `PLANNER PROMPT: ${agent.plannerPrompt}`,
      `INVARIANT CHECKER PROMPT: ${agent.invariantCheckerPrompt}`,
      `FINAL RESPONDER PROMPT: ${agent.finalResponderPrompt}`,
      `REFUSAL MODE PROMPT: ${agent.refusalPrompt}`,
      buildProfilePriorityInstructions(agent.userProfile),
      "ACTIVE USER PROFILE:",
      JSON.stringify(agent.userProfile, null, 2),
      "MEMORY LAYERS:",
      "LONG-TERM MEMORY:",
      JSON.stringify(agent.longTermMemory, null, 2),
      "WORKING MEMORY:",
      JSON.stringify(agent.workingMemory, null, 2),
      "TASK STATE:",
      JSON.stringify(agent.taskState, null, 2),
      "INVARIANTS:",
      JSON.stringify(agent.invariants, null, 2),
    ];
    if (runtimeContext?.draftPlan) {
      parts.push("DRAFT PLAN:", JSON.stringify(runtimeContext.draftPlan, null, 2));
    }
    if (runtimeContext?.invariantCheck) {
      parts.push("INVARIANT CHECK RESULT:", JSON.stringify(runtimeContext.invariantCheck, null, 2));
    }
    if (runtimeContext?.rag?.contextText?.trim()) {
      parts.push(
        "RAG MODE:",
        "Отвечай только на основе найденных чанков ниже. Не выдумывай факты. Если ответа нет в чанках, прямо скажи, что он не найден в предоставленных документах. По возможности укажи source и section.",
        "RETRIEVED CONTEXT:",
        runtimeContext.rag.contextText.trim(),
      );
    }
    parts.push(
      "SHORT-TERM MEMORY:",
      JSON.stringify({ messages: tail.map((item) => ({ role: item.role, content: String(item.text || "") })) }, null, 2),
    );
    if (tail.length > 0) {
      parts.push("RECENT MESSAGES:");
      for (const item of tail) parts.push(`${item.role.toUpperCase()}: ${item.text}`);
    }
    parts.push(`USER: ${nextUserText}`, "ASSISTANT:");
    return parts.join("\n");
  }
}

class CompactOllamaContextBuilder {
  build(agent, nextUserText, runtimeContext = null) {
    const parts = [`USER MESSAGES: ${JSON.stringify(buildCompactUserMessages(agent.history, nextUserText))}`];
    if (runtimeContext?.draftPlan) {
      parts.push("DRAFT PLAN:", JSON.stringify(runtimeContext.draftPlan, null, 2));
    }
    if (runtimeContext?.invariantCheck) {
      parts.push("INVARIANT CHECK RESULT:", JSON.stringify(runtimeContext.invariantCheck, null, 2));
    }
    if (runtimeContext?.rag?.contextText?.trim()) {
      parts.push("RETRIEVED CONTEXT:", runtimeContext.rag.contextText.trim());
    }
    return parts.join("\n");
  }
}

class ContextBuilderRouter {
  constructor() {
    this.fullBuilder = new ProxyResponsesContextBuilder();
    this.compactBuilder = new CompactOllamaContextBuilder();
  }

  build(agent, nextUserText, runtimeContext = null) {
    return agent.apiMode === API_MODES.OLLAMA_TOOLS_CHAT
      ? this.compactBuilder.build(agent, nextUserText, runtimeContext)
      : this.fullBuilder.build(agent, nextUserText, runtimeContext);
  }

  buildOllamaChatMessages(agent, nextUserText, runtimeContext = null) {
    const systemParts = [
      agent.systemPreamble,
      agent.finalResponderPrompt,
      buildProfilePriorityInstructions(agent.userProfile),
    ];
    const userParts = [`Вопрос пользователя:\n${String(nextUserText || "").trim()}`];
    if (runtimeContext?.rag?.contextText?.trim()) {
      systemParts.push(
        "Если передан RETRIEVED CONTEXT, отвечай только на его основе. Не выдумывай факты. Если ответа нет в контексте, так и скажи.",
      );
      userParts.push("RETRIEVED CONTEXT:", runtimeContext.rag.contextText.trim());
    }
    if (runtimeContext?.invariantCheck) {
      userParts.push("INVARIANT CHECK RESULT:", JSON.stringify(runtimeContext.invariantCheck, null, 2));
    }
    if (runtimeContext?.draftPlan) {
      userParts.push("DRAFT PLAN:", JSON.stringify(runtimeContext.draftPlan, null, 2));
    }
    return [
      { role: "system", content: systemParts.join("\n\n") },
      { role: "user", content: userParts.join("\n\n") },
    ];
  }
}

export { CompactOllamaContextBuilder, ContextBuilderRouter, ProxyResponsesContextBuilder };
