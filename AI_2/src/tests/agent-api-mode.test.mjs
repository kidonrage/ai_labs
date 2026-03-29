import assert from "node:assert/strict";
import { Agent } from "../agent.js";
import { setRuntimePrivateConfig } from "../private-runtime-config.js";

async function main() {
  setRuntimePrivateConfig({
    remoteOllama: {
      username: "king",
      password: "king",
    },
  });
  const agent = new Agent({
    apiMode: "ollama_chat",
    baseUrl: "http://localhost:11434",
    apiKey: "",
    model: "gemma3",
    temperature: 0.2,
  });

  const state = agent.exportState();
  assert.equal(state.config.apiMode, "ollama_chat");
  assert.equal(
    Agent.extractUserVisibleAnswer(
      {
        message: {
          role: "assistant",
          content: "  local answer  ",
        },
      },
      "ollama_chat",
    ),
    "local answer",
  );
  assert.equal(
    Agent.extractDurationSeconds({ total_duration: 2_500_000_000 }, "ollama_chat"),
    2.5,
  );

  const mcpAgent = new Agent({
    apiMode: "ollama_tools_chat",
    baseUrl: "http://localhost:8000/api/chat",
    apiKey: "",
    model: "qwen3:8b",
    temperature: 0.3,
  });

  const request = mcpAgent._buildResponseRequestBody({
    model: "qwen3:8b",
    input: "ping",
    temperature: 0.3,
  });
  assert.equal(request.model, "qwen3:8b");
  assert.equal(request.messages[0].content, "ping");
  assert.equal(request.options.temperature, 0.3);
  assert.equal(request.think, false);
  assert.equal("tools" in request, false);

  mcpAgent.history.push(
    { role: "user", text: "первый вопрос", at: new Date().toISOString() },
    { role: "assistant", text: "ответ", at: new Date().toISOString() },
  );
  const compactInput = await mcpAgent._buildContextInput("второй вопрос");
  assert.match(compactInput, /SYSTEM DIRECTIVES:/);
  assert.match(compactInput, /ACTIVE USER PROFILE:/);
  assert.match(compactInput, /ACTIVE INVARIANTS:/);
  assert.match(compactInput, /LONG-TERM MEMORY:/);
  assert.match(compactInput, /WORKING MEMORY:/);
  assert.match(compactInput, /SHORT-TERM MEMORY:/);
  assert.match(compactInput, /USER MESSAGE HISTORY:/);
  assert.match(compactInput, /первый вопрос/);
  assert.match(compactInput, /второй вопрос/);
  assert.match(compactInput, /ответ/);
  assert.doesNotMatch(compactInput, /PLANNER PROMPT:/);
  assert.doesNotMatch(compactInput, /INVARIANT CHECKER PROMPT:/);
  assert.doesNotMatch(compactInput, /REFUSAL MODE PROMPT:/);
  assert.doesNotMatch(compactInput, /approve/);

  const firstTurnAgent = new Agent({
    apiMode: "ollama_tools_chat",
    baseUrl: "http://localhost:8000/api/chat",
    apiKey: "",
    model: "qwen3:8b",
    temperature: 0.3,
  });
  firstTurnAgent.history.push({
    role: "user",
    text: "собери summary",
    at: new Date().toISOString(),
  });
  const firstTurnInput = await firstTurnAgent._buildContextInput("собери summary");
  assert.match(firstTurnInput, /USER MESSAGE HISTORY:/);
  assert.match(firstTurnInput, /"собери summary"/);
  assert.match(firstTurnInput, /USER REQUEST:/);

  assert.equal(
    Agent.extractUserVisibleAnswer(
      {
        message: {
          role: "assistant",
          content: "  mcp local answer  ",
        },
      },
      "ollama_tools_chat",
    ),
    "mcp local answer",
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    await mcpAgent._updateMemoryWithLLM("не суммируй контекст");
    assert.deepEqual(mcpAgent.summaryTotals, {
      summaryRequests: 0,
      summaryInputTokens: 0,
      summaryOutputTokens: 0,
      summaryTotalTokens: 0,
      summaryCostRub: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const proxySummaryAgent = new Agent({
    apiMode: "proxyapi_responses",
    baseUrl: "https://api.proxyapi.ru/openai/v1/responses",
    apiKey: "secret",
    model: "gpt-4.1",
    temperature: 0.3,
  });
  proxySummaryAgent.setContextPolicy({ memoryBaseUrl: "http://localhost:11434" });

  const summaryCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    summaryCalls.push({
      url,
      headers: options.headers || {},
      body: JSON.parse(options.body),
    });
    return {
      ok: true,
      json: async () => ({
        model: "gemma3",
        message: {
          role: "assistant",
          content: JSON.stringify({
            write: {
              working: {
                set_goal: null,
                add_constraints: [],
                add_decisions: [],
                add_open_questions: [],
                merge_entities: {},
                add_artifacts: [],
              },
              long_term: {
                add_preferences: {},
                add_facts: [],
                add_profile: {},
                add_stable_decisions: [],
              },
            },
          }),
        },
        prompt_eval_count: 12,
        eval_count: 8,
        total_duration: 1_500_000_000,
      }),
    };
  };
  try {
    await proxySummaryAgent._updateMemoryWithLLM("локальная суммаризация");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(summaryCalls.length, 1);
  assert.equal(summaryCalls[0].url, "http://localhost:11434/api/chat");
  assert.equal(summaryCalls[0].body.model, "gemma3");
  assert.equal(summaryCalls[0].headers.Authorization, undefined);

  const remoteAgent = new Agent({
    apiMode: "remote_ollama_chat",
    baseUrl: "http://185.28.85.134",
    apiKey: "",
    model: "gemma3",
    temperature: 0.2,
  });
  assert.equal(remoteAgent.exportState().config.apiMode, "remote_ollama_chat");

  const remoteCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    remoteCalls.push({
      url,
      headers: options.headers || {},
      body: JSON.parse(options.body),
    });
    return {
      ok: true,
      text: async () => JSON.stringify({
        model: "gemma3",
        message: {
          role: "assistant",
          content: "удалённый ответ",
        },
        prompt_eval_count: 3,
        eval_count: 2,
      }),
    };
  };
  try {
    const remoteResult = await remoteAgent.modelGateway.requestModelText(remoteAgent, {
      input: "ping",
    });
    assert.equal(remoteResult.answerText, "удалённый ответ");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteCalls[0].url, "http://185.28.85.134/api/chat");
  assert.equal(remoteCalls[0].headers.Authorization, "Basic a2luZzpraW5n");
  assert.equal(remoteCalls[0].body.messages[0].content, "ping");
}

main();
