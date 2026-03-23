import { DEFAULT_INDEX_URL } from "./constants.js";

let cachedIndexUrl = null;
let cachedIndexData = null;

async function loadRagIndex(indexUrl = DEFAULT_INDEX_URL) {
  if (cachedIndexUrl === indexUrl && Array.isArray(cachedIndexData)) {
    return cachedIndexData;
  }
  const response = await fetch(indexUrl);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить индекс RAG: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Индекс RAG имеет неверный формат: ожидался массив.");
  }
  cachedIndexUrl = indexUrl;
  cachedIndexData = data;
  return data;
}

export { loadRagIndex };
