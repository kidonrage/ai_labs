import assert from "node:assert/strict";
import { Agent } from "../agent.js";
import { ChatRepository } from "../app/chat-repository.js";

async function main() {
  const fallbackConfig = {
    apiMode: "ollama_chat",
    baseUrl: "http://localhost:11434/api/chat",
    model: "gemma3",
    temperature: 0.2,
  };
  const repository = new ChatRepository(fallbackConfig);

  const legacyStore = repository.normalizeStore({
    history: [{ role: "user", text: "hi", at: new Date().toISOString() }],
    config: fallbackConfig,
    longTermMemory: { facts: ["f1"] },
  });
  assert.equal(legacyStore.version, 4);
  assert.equal(legacyStore.activeChatId, "chat_1");
  assert.equal(legacyStore.activeProfileId, "profile_default");
  assert.equal(legacyStore.chats.length, 1);

  const agent = new Agent({
    apiMode: "ollama_chat",
    baseUrl: "http://localhost:11434/api/chat",
    apiKey: "",
    model: "gemma3",
    temperature: 0.2,
  });
  agent.loadState({
    version: 7,
    config: fallbackConfig,
    facts: { repo: "ai_2", tags: ["rag", "agent"] },
    history: [{ role: "user", text: "старый", at: new Date().toISOString() }],
    invariants: ["Node.js нельзя менять"],
    summaryTotals: { summaryRequests: 1, summaryTotalTokens: 10 },
  });

  const persisted = agent.persistState();
  assert.equal(persisted.version, 7);
  assert.equal(agent.workingMemory.task.entities.repo, "ai_2");
  assert.equal(agent.workingMemory.task.entities.tags, "rag; agent");
  assert.deepEqual(agent.invariants, ["Node.js нельзя менять"]);
  assert.equal(persisted.history.length, 1);
}

main();
