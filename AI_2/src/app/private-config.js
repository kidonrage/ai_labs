async function loadPrivateConfig() {
  try {
    const mod = await import("../config/private.config.js");
    return (mod && mod.PRIVATE_APP_CONFIG) || {};
  } catch {
    return {};
  }
}

function getPrivateApiKey(config) {
  return config && typeof config.apiKey === "string" ? config.apiKey.trim() : "";
}

export { getPrivateApiKey, loadPrivateConfig };
