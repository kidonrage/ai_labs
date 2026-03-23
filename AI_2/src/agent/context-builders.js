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

function makeBlock(title, value) {
  return { title, value: String(value || "").trim() };
}

function pushJsonBlock(blocks, title, value) {
  if (value == null) return;
  blocks.push(makeBlock(title, JSON.stringify(value, null, 2)));
}

function pushTextBlock(blocks, title, value) {
  const text = String(value || "").trim();
  if (!text) return;
  blocks.push(makeBlock(title, text));
}

function buildInvariantPolicy(invariants) {
  const count = Array.isArray(invariants) ? invariants.length : 0;
  return count > 0
    ? `Соблюдай активные инварианты системы. Их ${count}. Если запрос противоречит им, не выходи за их рамки в ответе.`
    : "Соблюдай системные ограничения, если они присутствуют в контексте.";
}

function buildPromptContract(agent, nextUserText, runtimeContext = null) {
  const keepLast = Math.max(1, Number(agent.contextPolicy.keepLastMessages) || 12);
  const tail = agent.history.slice(-keepLast);
  const userRequest = String(
    runtimeContext?.rag?.question || nextUserText || "",
  ).trim();
  const contextBlocks = [];

  pushJsonBlock(contextBlocks, "ACTIVE USER PROFILE", agent.userProfile);
  pushJsonBlock(contextBlocks, "ACTIVE INVARIANTS", agent.invariants);
  pushJsonBlock(contextBlocks, "LONG-TERM MEMORY", agent.longTermMemory);
  pushJsonBlock(contextBlocks, "WORKING MEMORY", agent.workingMemory);
  pushJsonBlock(contextBlocks, "TASK STATE", agent.taskState);
  pushJsonBlock(contextBlocks, "SHORT-TERM MEMORY", {
    messages: tail.map((item) => ({
      role: item.role,
      content: String(item.text || ""),
    })),
  });
  pushJsonBlock(contextBlocks, "USER MESSAGE HISTORY", buildCompactUserMessages(agent.history, userRequest));
  if (runtimeContext?.draftPlan) {
    pushJsonBlock(contextBlocks, "DRAFT PLAN", runtimeContext.draftPlan);
  }
  if (runtimeContext?.invariantCheck?.conflict) {
    pushJsonBlock(contextBlocks, "INVARIANT CHECK RESULT", runtimeContext.invariantCheck);
  }
  if (runtimeContext?.rag?.contextText?.trim()) {
    pushTextBlock(contextBlocks, "RETRIEVED CONTEXT", runtimeContext.rag.contextText);
  }

  const systemDirectives = [
    String(agent.systemPreamble || "").trim(),
    buildProfilePriorityInstructions(agent.userProfile),
    buildInvariantPolicy(agent.invariants),
  ].filter(Boolean);

  if (runtimeContext?.rag?.answerPolicy) {
    systemDirectives.push(String(runtimeContext.rag.answerPolicy).trim());
  }

  return {
    systemDirectives,
    contextBlocks,
    userMessage: userRequest,
  };
}

function compileContextBlocks(blocks) {
  const parts = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    const title = String(block.title || "").trim();
    const value = String(block.value || "").trim();
    if (!title || !value) continue;
    parts.push(`${title}:`, value);
  }
  return parts.join("\n\n");
}

function compilePromptInput(contract) {
  const systemText = (Array.isArray(contract?.systemDirectives) ? contract.systemDirectives : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const contextText = compileContextBlocks(contract?.contextBlocks);
  const parts = [];
  if (systemText) parts.push("SYSTEM DIRECTIVES:", systemText);
  if (contextText) parts.push("CONTEXT:", contextText);
  parts.push("USER REQUEST:", String(contract?.userMessage || "").trim(), "ASSISTANT:");
  return parts.join("\n\n");
}

function compilePromptMessages(contract) {
  const systemText = (Array.isArray(contract?.systemDirectives) ? contract.systemDirectives : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const contextText = compileContextBlocks(contract?.contextBlocks);
  const userParts = [];
  if (contextText) userParts.push("CONTEXT:", contextText);
  userParts.push("USER REQUEST:", String(contract?.userMessage || "").trim());
  return [
    { role: "system", content: systemText },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

class ProxyResponsesContextBuilder {
  build(agent, nextUserText, runtimeContext = null) {
    return compilePromptInput(buildPromptContract(agent, nextUserText, runtimeContext));
  }
}

class CompactOllamaContextBuilder {
  build(agent, nextUserText, runtimeContext = null) {
    return compilePromptInput(buildPromptContract(agent, nextUserText, runtimeContext));
  }
}

class ContextBuilderRouter {
  constructor() {
    this.fullBuilder = new ProxyResponsesContextBuilder();
    this.compactBuilder = new CompactOllamaContextBuilder();
  }

  buildPromptContract(agent, nextUserText, runtimeContext = null) {
    return buildPromptContract(agent, nextUserText, runtimeContext);
  }

  build(agent, nextUserText, runtimeContext = null) {
    const contract = this.buildPromptContract(agent, nextUserText, runtimeContext);
    if (agent.apiMode === API_MODES.OLLAMA_TOOLS_CHAT) {
      return this.compactBuilder.build(agent, nextUserText, runtimeContext);
    }
    if (agent.apiMode === API_MODES.OLLAMA_CHAT) {
      return compilePromptInput(contract);
    }
    return this.fullBuilder.build(agent, nextUserText, runtimeContext);
  }

  buildOllamaChatMessages(agent, nextUserText, runtimeContext = null) {
    return compilePromptMessages(
      this.buildPromptContract(agent, nextUserText, runtimeContext),
    );
  }
}

export {
  CompactOllamaContextBuilder,
  ContextBuilderRouter,
  ProxyResponsesContextBuilder,
  buildPromptContract,
  compilePromptInput,
  compilePromptMessages,
};
