const EMPTY_REMOTE_OLLAMA = Object.freeze({
  login: "",
  username: "",
  password: "",
});

let runtimePrivateConfig = {
  apiKey: "",
  remoteOllama: { ...EMPTY_REMOTE_OLLAMA },
};

function normalizeString(value) {
  return typeof value === "string" ? value : "";
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
      login: normalizeString(remoteOllama.login),
      username: normalizeString(remoteOllama.username),
      password: normalizeString(remoteOllama.password),
    },
  };
}

function setRuntimePrivateConfig(value) {
  runtimePrivateConfig = normalizePrivateConfig(value);
}

function getRemoteOllamaAuthorizationHeader() {
  const login = normalizeString(
    runtimePrivateConfig.remoteOllama.login ||
      runtimePrivateConfig.remoteOllama.username,
  );
  const password = normalizeString(runtimePrivateConfig.remoteOllama.password);
  if (!login || !password) return "";
  const credentials = btoa(`${login}:${password}`);
  return `Basic ${credentials}`;
}

export { getRemoteOllamaAuthorizationHeader, setRuntimePrivateConfig };
