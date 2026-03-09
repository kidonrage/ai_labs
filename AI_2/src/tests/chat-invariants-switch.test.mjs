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
  return (Array.isArray(state?.invariants) ? state.invariants : []).map((x) => x.id);
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
    {
      id: "chat1_only",
      title: "Только чат 1",
      rule: "Для backend-сервисов использовать только Node.js",
      type: "technical",
      check: {
        policy: {
          type: "fixed_stack_scope",
          allowed: "Node.js",
          scope: "backend-сервисы",
        },
        forbiddenPhrases: [],
        safeAlternative: "Использовать Node.js.",
      },
    },
  ];

  const chat2Invariants = [
    {
      id: "chat2_only",
      title: "Только чат 2",
      rule: "PostgreSQL нельзя заменять",
      type: "technical",
      check: {
        policy: {
          type: "cannot_replace",
          target: "PostgreSQL",
        },
        forbiddenPhrases: [],
        safeAlternative: "Оставить PostgreSQL.",
      },
    },
  ];

  const chat1StateInitial = makeChatState(chat1Invariants);
  const chat2StateInitial = makeChatState(chat2Invariants);

  const chat1AfterFirstOpen = bindLikeApp(chat1StateInitial, "P1");
  assert.deepEqual(invariantIds(chat1AfterFirstOpen), ["chat1_only"]);

  const chat2AfterOpen = bindLikeApp(chat2StateInitial, "P2");
  assert.deepEqual(invariantIds(chat2AfterOpen), ["chat2_only"]);

  const chat1AfterReturn = bindLikeApp(chat1AfterFirstOpen, "P1");
  assert.deepEqual(invariantIds(chat1AfterReturn), ["chat1_only"]);

  // Regression guard: no default invariants should reappear after switches.
  const ids = invariantIds(chat1AfterReturn);
  assert.ok(!ids.includes("backend_stack"));
  assert.ok(!ids.includes("db_fixed"));
  assert.ok(!ids.includes("privacy_logs"));
}

async function scenarioStaleAgentCallbackIsIgnored() {
  const chatA = { state: makeChatState([{ id: "a_only", title: "A", rule: "A", type: "general", check: { forbiddenPhrases: [], safeAlternative: "" } }]) };
  const chatB = { state: makeChatState([{ id: "b_only", title: "B", rule: "B", type: "general", check: { forbiddenPhrases: [], safeAlternative: "" } }]) };

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

  assert.deepEqual(invariantIds(chatA.state), ["a_only"]);
  assert.deepEqual(invariantIds(chatB.state), ["b_only"]);
}

async function main() {
  await scenarioSwitchBetweenChatsKeepsOwnInvariantSets();
  await scenarioStaleAgentCallbackIsIgnored();
}

main();
