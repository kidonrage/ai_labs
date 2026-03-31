import assert from "node:assert/strict";
import { Agent } from "../agent.js";

async function main() {
  const proxyAgent = new Agent({
    apiMode: "proxyapi_responses",
    baseUrl: "https://api.proxyapi.ru/openai/v1/responses",
    apiKey: "test",
    model: "gpt-4.1",
    temperature: 0.2,
  });
  proxyAgent.history.push({ role: "user", text: "первый", at: new Date().toISOString() });

  const proxyContract = proxyAgent.contextBuilder.buildPromptContract(proxyAgent, "второй", {
    draftPlan: { summary: "plan" },
    invariantCheck: { conflict: false },
    rag: {
      question: "второй",
      contextText: "chunk context",
      answerPolicy: "Ответь только по контексту.",
    },
  });
  assert.deepEqual(Object.keys(proxyContract), [
    "systemDirectives",
    "contextBlocks",
    "userMessage",
  ]);
  assert.equal(proxyContract.userMessage, "второй");
  assert.equal(proxyContract.systemDirectives.filter((item) => /PROFILE DIRECTIVES/.test(item)).length, 1);
  assert.equal(proxyContract.systemDirectives.some((item) => /Hard constraints: \(none\)/.test(item)), false);

  const proxyInput = await proxyAgent._buildContextInput("второй", {
    draftPlan: { summary: "plan" },
    invariantCheck: { conflict: false },
    rag: {
      question: "второй",
      contextText: "chunk context",
      answerPolicy: "Ответь только по контексту.",
    },
  });
  assert.match(proxyInput, /SYSTEM DIRECTIVES:/);
  assert.match(proxyInput, /LONG-TERM MEMORY:/);
  assert.match(proxyInput, /ACTIVE INVARIANTS:/);
  assert.match(proxyInput, /DRAFT PLAN:/);
  assert.match(proxyInput, /RETRIEVED CONTEXT:/);
  assert.match(proxyInput, /USER REQUEST:/);
  assert.match(proxyInput, /второй/);
  assert.doesNotMatch(proxyInput, /PLANNER PROMPT:/);
  assert.doesNotMatch(proxyInput, /INVARIANT CHECKER PROMPT:/);
  assert.doesNotMatch(proxyInput, /REFUSAL MODE PROMPT:/);
  assert.doesNotMatch(proxyInput, /approve/);

  const compactAgent = new Agent({
    apiMode: "ollama_tools_chat",
    baseUrl: "http://localhost:8000/api/chat",
    apiKey: "",
    model: "qwen3:8b",
    temperature: 0.2,
  });
  compactAgent.history.push(
    { role: "user", text: "первый", at: new Date().toISOString() },
    { role: "assistant", text: "ответ", at: new Date().toISOString() },
  );

  const compactInput = await compactAgent._buildContextInput("второй");
  assert.match(compactInput, /SYSTEM DIRECTIVES:/);
  assert.match(compactInput, /LONG-TERM MEMORY:/);
  assert.match(compactInput, /USER MESSAGE HISTORY:/);
  assert.doesNotMatch(compactInput, /TOOL POLICY:/);
  assert.doesNotMatch(compactInput, /get_git_branch/);
  assert.doesNotMatch(compactInput, /PLANNER PROMPT:/);
  assert.doesNotMatch(compactInput, /approve/);

  const compactWithRag = await compactAgent._buildContextInput("второй", {
    rag: {
      question: "второй",
      contextText: "retrieved chunk",
      answerPolicy: "Только по контексту.",
    },
  });
  assert.match(compactWithRag, /RETRIEVED CONTEXT:/);
  assert.match(compactWithRag, /retrieved chunk/);

  const messages = compactAgent.contextBuilder.buildOllamaChatMessages(compactAgent, "второй", {
    rag: {
      question: "Что найдено?",
      contextText: "retrieved chunk",
      answerPolicy: "Только по контексту.",
    },
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(messages[0].content, /PROFILE DIRECTIVES/);
  assert.match(messages[0].content, /Только по контексту/);
  assert.doesNotMatch(messages[0].content, /FINAL RESPONDER PROMPT:/);
  assert.doesNotMatch(messages[0].content, /Hard constraints: \(none\)/);
  assert.doesNotMatch(messages[0].content, /approve/);
  assert.match(messages[1].content, /RETRIEVED CONTEXT:/);
  assert.match(messages[1].content, /USER REQUEST:/);
  assert.equal((messages[1].content.match(/RETRIEVED CONTEXT:/g) || []).length, 1);
  assert.doesNotMatch(messages[1].content, /RAG-контекст:/);
  assert.doesNotMatch(messages[1].content, /Не перечисляй источники/);

  const branchInput = await compactAgent._buildContextInput("Какая сейчас текущая git ветка?");
  assert.match(branchInput, /TOOL POLICY:/);
  assert.match(branchInput, /get_git_branch/);
  assert.match(branchInput, /Не угадывай название ветки/);

  const branchMessages = compactAgent.contextBuilder.buildOllamaChatMessages(
    compactAgent,
    "На какой ветке сейчас репозиторий?",
  );
  assert.match(branchMessages[0].content, /TOOL POLICY:/);
  assert.match(branchMessages[0].content, /get_git_branch/);
  assert.match(branchMessages[0].content, /обязательно сначала вызови MCP tool/);
  assert.doesNotMatch(branchMessages[1].content, /get_git_branch/);
}

main();
