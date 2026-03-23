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

  const proxyInput = await proxyAgent._buildContextInput("второй", {
    draftPlan: { summary: "plan" },
    invariantCheck: { conflict: false },
    rag: { contextText: "chunk context" },
  });
  assert.match(proxyInput, /SYSTEM:/);
  assert.match(proxyInput, /LONG-TERM MEMORY:/);
  assert.match(proxyInput, /INVARIANTS:/);
  assert.match(proxyInput, /DRAFT PLAN:/);
  assert.match(proxyInput, /INVARIANT CHECK RESULT:/);
  assert.match(proxyInput, /RETRIEVED CONTEXT:/);
  assert.match(proxyInput, /USER: второй/);

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
  assert.match(compactInput, /^USER MESSAGES:/);
  assert.doesNotMatch(compactInput, /SYSTEM:/);
  assert.doesNotMatch(compactInput, /LONG-TERM MEMORY:/);
  assert.doesNotMatch(compactInput, /ответ/);

  const compactWithRag = await compactAgent._buildContextInput("второй", {
    rag: { contextText: "retrieved chunk" },
  });
  assert.match(compactWithRag, /RETRIEVED CONTEXT:/);
  assert.match(compactWithRag, /retrieved chunk/);
}

main();
