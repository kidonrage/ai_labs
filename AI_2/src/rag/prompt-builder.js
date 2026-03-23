import { SAFE_NO_DATA_ANSWER } from "./constants.js";
import { normalizeNonEmptyString } from "./shared.js";
import { isOllamaFamilyMode } from "../api-profiles.js";

function buildRewritePrompt(question) {
  return [
    "Ты переписываешь пользовательский вопрос в короткий поисковый запрос для retrieval в RAG.",
    "Правила:",
    "- Не отвечай на вопрос.",
    "- Сохрани ключевые сущности, имена, названия и технические термины.",
    "- Убери лишнюю разговорную формулировку.",
    "- Верни только одну строку поискового запроса без пояснений.",
    "",
    `Исходный вопрос: ${String(question || "").trim()}`,
    "Поисковый запрос:",
  ].join("\n");
}

function extractRewriteText(dto, apiMode) {
  if (!dto || typeof dto !== "object") return "";
  if (isOllamaFamilyMode(apiMode)) {
    return String(dto.message && dto.message.content ? dto.message.content : "").trim();
  }
  if (typeof dto.output_text === "string" && dto.output_text.trim()) {
    return dto.output_text.trim();
  }
  if (Array.isArray(dto.output)) {
    for (const item of dto.output) {
      if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part && typeof part.text === "string" && part.text.trim()) return part.text.trim();
      }
    }
  }
  return "";
}

function sanitizeRewriteResult(text) {
  return (
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0] || ""
  );
}

function buildRagContext(chunks) {
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk, index) =>
      [
        `[Chunk ${index + 1}]`,
        `chunk_id: ${chunk.chunk_id || "unknown"}`,
        `source: ${chunk.source || "unknown"}`,
        `section: ${chunk.section || "unknown"}`,
        "text:",
        chunk.text || "",
      ].join("\n"),
    )
    .join("\n\n");
}

function buildCitedAnswerPrompt(question, contextText, options = {}) {
  const clarificationAnswer = normalizeNonEmptyString(
    options.safeNoDataAnswer,
    SAFE_NO_DATA_ANSWER,
  );
  return [
    "Ответь на вопрос ТОЛЬКО по переданному RAG-контексту.",
    "Не используй внешние знания и не придумывай факты.",
    "Нужен обычный короткий ответ на русском, без markdown и без JSON.",
    "Если ответа нет в контексте, верни ровно эту фразу:",
    clarificationAnswer,
    "Не перечисляй источники и не вставляй цитаты в ответ. Это сделает код после генерации.",
    "",
    `Вопрос: ${String(question || "").trim()}`,
    "",
    "RAG-контекст:",
    String(contextText || "").trim(),
    "",
    "JSON:",
  ].join("\n");
}

export {
  buildCitedAnswerPrompt,
  buildRagContext,
  buildRewritePrompt,
  extractRewriteText,
  sanitizeRewriteResult,
};
