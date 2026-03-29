const EMPTY_REMOTE_OLLAMA = Object.freeze({
  username: "",
  password: "",
});

let runtimePrivateConfig = {
  apiKey: "",
  remoteOllama: { ...EMPTY_REMOTE_OLLAMA },
};

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePrivateConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const remoteOllama =
    raw.remoteOllama && typeof raw.remoteOllama === "object"
      ? raw.remoteOllama
      : {};
  return {
    apiKey: normalizeString(raw.apiKey),
    remoteOllama: {
      username: normalizeString(remoteOllama.username),
      password: normalizeString(remoteOllama.password),
    },
  };
}

function setRuntimePrivateConfig(value) {
  runtimePrivateConfig = normalizePrivateConfig(value);
}

function encodeBase64(value) {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(value);
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  throw new Error("Нет base64-кодировщика для private config.");
}

function getRemoteOllamaAuthorizationHeader() {
  const username = normalizeString(runtimePrivateConfig.remoteOllama.username);
  const password = normalizeString(runtimePrivateConfig.remoteOllama.password);
  if (!username || !password) return "";
  return `Basic ${encodeBase64(`${username}:${password}`)}`;
}

export {
  getRemoteOllamaAuthorizationHeader,
  setRuntimePrivateConfig,
};
