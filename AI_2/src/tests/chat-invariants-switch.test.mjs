import assert from "node:assert/strict";
import { Agent } from "../agent.js";

function makeAgent() {
  return new Agent({
    baseUrl: "https://example.invalid",
    apiKey: "test",
    model: "gpt-4.1",
    temperature: 0.2,
    contextStrategy: "sticky_facts",
  });
}

function invariantIds(state) {
  return Array.isArray(state?.invariants) ? state.invariants : [];
}

function makeChatState(invariants) {
  const agent = makeAgent();
  agent.setInvariants(invariants);
  return agent.exportState();
}

function bindLikeApp(chatState, profileName = "Тест") {
  const agent = makeAgent();

  // Mirrors current fixed order in bindAgentToActiveChat:
  // 1) loadState, 2) setContextStrategy, 3) setLongTermMemory/setUserProfile.
  agent.loadState(chatState);
  agent.setContextStrategy("sticky_facts");
  agent.setLongTermMemory(Agent.makeDefaultLongTermMemory());
  agent.setUserProfile({
    id: "p1",
    name: profileName,
    preferences: {
      style: "Кратко",
      format: "Структурировано",
      constraints: [],
    },
  });

  return agent.persistState();
}

async function scenarioSwitchBetweenChatsKeepsOwnInvariantSets() {
  const chat1Invariants = [
    "Для backend-сервисов использовать только Node.js",
  ];

  const chat2Invariants = [
    "PostgreSQL нельзя заменять",
  ];

  const chat1StateInitial = makeChatState(chat1Invariants);
  const chat2StateInitial = makeChatState(chat2Invariants);

  const chat1AfterFirstOpen = bindLikeApp(chat1StateInitial, "P1");
  assert.deepEqual(invariantIds(chat1AfterFirstOpen), ["Для backend-сервисов использовать только Node.js"]);

  const chat2AfterOpen = bindLikeApp(chat2StateInitial, "P2");
  assert.deepEqual(invariantIds(chat2AfterOpen), ["PostgreSQL нельзя заменять"]);

  const chat1AfterReturn = bindLikeApp(chat1AfterFirstOpen, "P1");
  assert.deepEqual(invariantIds(chat1AfterReturn), ["Для backend-сервисов использовать только Node.js"]);

  // Regression guard: no default invariants should reappear after switches.
  const ids = invariantIds(chat1AfterReturn);
  assert.ok(!ids.includes("PostgreSQL нельзя заменять"));
  assert.ok(!ids.includes("Персональные данные нельзя хранить в логах"));
}

async function scenarioStaleAgentCallbackIsIgnored() {
  const chatA = { state: makeChatState(["A"]) };
  const chatB = { state: makeChatState(["B"]) };

  let currentAgent = null;

  const agentA = makeAgent();
  currentAgent = agentA;
  agentA.loadState(chatA.state);
  agentA.onStateChanged = (state) => {
    if (currentAgent !== agentA) return;
    chatA.state = state;
  };

  const agentB = makeAgent();
  currentAgent = agentB;
  agentB.loadState(chatB.state);
  agentB.onStateChanged = (state) => {
    if (currentAgent !== agentB) return;
    chatB.state = state;
  };

  // Simulate late event from old agent A after switching to B.
  agentA.setUserProfile({ name: "late", preferences: {} });

  assert.deepEqual(invariantIds(chatA.state), ["A"]);
  assert.deepEqual(invariantIds(chatB.state), ["B"]);
}

async function main() {
  await scenarioSwitchBetweenChatsKeepsOwnInvariantSets();
  await scenarioStaleAgentCallbackIsIgnored();
}

main();
