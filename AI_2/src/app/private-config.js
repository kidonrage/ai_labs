import { setRuntimePrivateConfig } from "../private-runtime-config.js";

async function loadPrivateConfig() {
  try {
    const mod = await import("../config/private.config.js");
    const config = (mod && mod.PRIVATE_APP_CONFIG) || {};
    setRuntimePrivateConfig(config);
    return config;
  } catch {
    setRuntimePrivateConfig({});
    return {};
  }
}

function getPrivateApiKey(config) {
  return config && typeof config.apiKey === "string" ? config.apiKey.trim() : "";
}

export { getPrivateApiKey, loadPrivateConfig };
