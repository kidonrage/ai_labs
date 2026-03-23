import assert from "node:assert/strict";
import { Agent } from "../agent.js";

async function main() {
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
}

main();
