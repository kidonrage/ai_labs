const LLM_TEST_SYSTEM_PROMPT = [
  "Ты ассистент для RAG-сценария.",
  "Отвечай только по предоставленному контексту документа.",
  "Если в контексте недостаточно информации, прямо скажи об этом.",
  "Не выдумывай факты.",
  "Отвечай кратко и по делу.",
].join(" ");

const LLM_CONFIG_TEST_CONFIGS = Object.freeze([
  {
    name: "baseline",
    model: "qwen3:8b",
    reportModel: "qwen3-8b",
    temperature: 0.7,
    maxTokens: 512,
    contextWindow: 4096,
  },
  {
    name: "rag_optimized",
    model: "qwen3:8b",
    reportModel: "qwen3-8b",
    temperature: 0.3,
    maxTokens: 400,
    contextWindow: 4096,
  },
  {
    name: "strict_short",
    model: "qwen3:8b",
    reportModel: "qwen3-8b",
    temperature: 0.2,
    maxTokens: 250,
    contextWindow: 8192,
  },
]);

export { LLM_CONFIG_TEST_CONFIGS, LLM_TEST_SYSTEM_PROMPT };
