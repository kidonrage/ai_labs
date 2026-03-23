import { DEFAULT_INDEX_URL } from "./constants.js";

let cachedIndexUrl = null;
let cachedIndexData = null;

function buildIndexLoadHint(indexUrl, error) {
  const message = String(error && error.message ? error.message : error || "").trim();
  const looksLikeNetworkFailure = /load failed|failed to fetch|networkerror|network request failed/i.test(message);
  const target = String(indexUrl || DEFAULT_INDEX_URL);
  if (looksLikeNetworkFailure) {
    if (/^https?:\/\/localhost/i.test(target)) {
      return `Не удалось загрузить индекс RAG по адресу ${target}. Проверь, что локальный сервер со статическим индексом запущен и отдает этот файл.`;
    }
    return `Не удалось загрузить индекс RAG по адресу ${target}. Проверь, что приложение запущено через HTTP и файл индекса доступен по этому пути.`;
  }
  return `Не удалось загрузить индекс RAG по адресу ${target}: ${message || "неизвестная ошибка"}`;
}

async function loadRagIndex(indexUrl = DEFAULT_INDEX_URL) {
  if (cachedIndexUrl === indexUrl && Array.isArray(cachedIndexData)) {
    return cachedIndexData;
  }
  let response;
  try {
    response = await fetch(indexUrl);
  } catch (error) {
    throw new Error(buildIndexLoadHint(indexUrl, error));
  }
  if (!response.ok) {
    throw new Error(
      `Не удалось загрузить индекс RAG по адресу ${indexUrl}: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Индекс RAG по адресу ${indexUrl} имеет неверный формат: ожидался массив.`);
  }
  cachedIndexUrl = indexUrl;
  cachedIndexData = data;
  return data;
}

export { loadRagIndex };
