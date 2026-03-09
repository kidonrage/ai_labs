const STORAGE_KEY = "simple_agent_chat_v2";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const obj = safeJsonParse(raw);
  if (!obj || typeof obj !== "object") return null;
  return obj;
}

export function saveState(stateObj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj, null, 2));
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}
