import assert from "node:assert/strict";
import {
  API_MODES,
  defaultEndpointForApiMode,
  defaultModelForApiMode,
  endpointForApiMode,
  inferApiMode,
  isOllamaFamilyMode,
} from "../api-profiles.js";

async function main() {
  assert.equal(
    defaultEndpointForApiMode(API_MODES.OLLAMA_MCP_CHAT),
    "http://localhost:8000/api/chat",
  );
  assert.equal(
    endpointForApiMode(API_MODES.OLLAMA_MCP_CHAT, "http://localhost:8000"),
    "http://localhost:8000/api/chat",
  );
  assert.equal(
    inferApiMode("", "http://localhost:8000/api/chat"),
    API_MODES.OLLAMA_MCP_CHAT,
  );
  assert.equal(defaultModelForApiMode(API_MODES.OLLAMA_MCP_CHAT), "qwen3:4b");
  assert.equal(isOllamaFamilyMode(API_MODES.OLLAMA_MCP_CHAT), true);
}

main();
