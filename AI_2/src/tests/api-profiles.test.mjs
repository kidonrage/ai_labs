import assert from "node:assert/strict";
import { setRuntimePrivateConfig } from "../private-runtime-config.js";
import {
  API_MODES,
  authorizationHeaderForRequest,
  defaultEndpointForApiMode,
  defaultModelForApiMode,
  endpointForApiMode,
  inferApiMode,
  isOllamaFamilyMode,
} from "../api-profiles.js";

async function main() {
  setRuntimePrivateConfig({
    remoteOllama: {
      username: "king",
      password: "king",
    },
  });
  assert.equal(
    defaultEndpointForApiMode(API_MODES.OLLAMA_TOOLS_CHAT),
    "http://localhost:8000/api/chat",
  );
  assert.equal(
    endpointForApiMode(API_MODES.OLLAMA_TOOLS_CHAT, "http://localhost:8000"),
    "http://localhost:8000/api/chat",
  );
  assert.equal(
    inferApiMode("", "http://localhost:8000/api/chat"),
    API_MODES.OLLAMA_TOOLS_CHAT,
  );
  assert.equal(
    defaultEndpointForApiMode(API_MODES.REMOTE_OLLAMA_CHAT),
    "http://185.28.85.134/api/chat",
  );
  assert.equal(
    endpointForApiMode(API_MODES.REMOTE_OLLAMA_CHAT, "http://185.28.85.134"),
    "http://185.28.85.134/api/chat",
  );
  assert.equal(
    inferApiMode("", "http://185.28.85.134/api/chat"),
    API_MODES.REMOTE_OLLAMA_CHAT,
  );
  assert.equal(
    authorizationHeaderForRequest(
      API_MODES.REMOTE_OLLAMA_CHAT,
      "http://185.28.85.134/api/chat",
    ),
    "Basic a2luZzpraW5n",
  );
  assert.equal(defaultModelForApiMode(API_MODES.OLLAMA_TOOLS_CHAT), "qwen3:8b");
  assert.equal(defaultModelForApiMode(API_MODES.REMOTE_OLLAMA_CHAT), "gemma3");
  assert.equal(isOllamaFamilyMode(API_MODES.OLLAMA_TOOLS_CHAT), true);
  assert.equal(isOllamaFamilyMode(API_MODES.REMOTE_OLLAMA_CHAT), true);
}

main();
