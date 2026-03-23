import { API_MODES } from "../api-profiles.js";

const DEFAULT_INDEX_URL = "./static/index_structured.json";
const DEFAULT_EMBEDDING_API_URL = "http://localhost:11434/api/embed";
const DEFAULT_EMBEDDING_MODEL = "embeddinggemma";
const DEFAULT_REWRITE_API_MODE = API_MODES.OLLAMA_CHAT;
const DEFAULT_REWRITE_BASE_URL = "http://localhost:11434";
const DEFAULT_REWRITE_MODEL = "gemma3";
const DEFAULT_REWRITE_TEMPERATURE = 0;
const DEFAULT_MIN_SIMILARITY = 0.45;
const DEFAULT_ANSWER_MIN_SIMILARITY = 0.05;
const DEFAULT_TOP_K = 3;
const DEFAULT_TOP_K_BEFORE = 8;
const DEFAULT_TOP_K_AFTER = 3;
const DEFAULT_MODE = "baseline";
const SAFE_NO_DATA_ANSWER =
  "Не знаю по имеющемуся контексту. Пожалуйста, уточните вопрос.";
const SAFE_PARSE_FAILURE_ANSWER =
  "Не удалось надежно сформировать ответ по найденному контексту. Пожалуйста, уточните вопрос.";

export {
  DEFAULT_ANSWER_MIN_SIMILARITY,
  DEFAULT_EMBEDDING_API_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_INDEX_URL,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_MODE,
  DEFAULT_REWRITE_API_MODE,
  DEFAULT_REWRITE_BASE_URL,
  DEFAULT_REWRITE_MODEL,
  DEFAULT_REWRITE_TEMPERATURE,
  DEFAULT_TOP_K,
  DEFAULT_TOP_K_AFTER,
  DEFAULT_TOP_K_BEFORE,
  SAFE_NO_DATA_ANSWER,
  SAFE_PARSE_FAILURE_ANSWER,
};
