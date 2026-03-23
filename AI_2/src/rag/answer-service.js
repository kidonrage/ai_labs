import {
  SAFE_PARSE_FAILURE_ANSWER,
} from "./constants.js";
import {
  extractJsonObjectFromText,
  normalizeNonEmptyString,
  stripMarkdownCodeFences,
} from "./shared.js";
import {
  buildDerivedAnswerResult,
  buildContextDiagnostics,
  evaluateContextStrength,
  makeSafeAnswerResult,
  normalizeAnswerResult,
  repairAnswerEvidence,
  validateAnswerEvidence,
} from "./evidence-service.js";
import {
  buildCitedAnswerPrompt,
  buildRagAnswerPolicy,
  buildRagContext,
} from "./prompt-builder.js";

async function generateAnswerWithSourcesAndQuotes(question, retrievalResult, config = {}) {
  const diagnostics = evaluateContextStrength(retrievalResult, config);
  const chunks = Array.isArray(retrievalResult && retrievalResult.chunks)
    ? retrievalResult.chunks
    : [];
  if (diagnostics.weakContext && diagnostics.forceIDontKnowOnWeakContext) {
    return {
      ...makeSafeAnswerResult(),
      diagnostics,
      validation: { valid: true, issues: ["weak_context_gate"] },
      rawResponseText: "",
    };
  }
  const requestCompletion = typeof config.requestCompletion === "function" ? config.requestCompletion : null;
  if (!requestCompletion) throw new Error("Не передан requestCompletion для cited answer generation.");
  const contextText = normalizeNonEmptyString(
    retrievalResult && retrievalResult.contextText,
    buildRagContext(chunks),
  );
  const questionText = String(question || "").trim();
  const answerPolicy = buildRagAnswerPolicy(config);
  const prompt = buildCitedAnswerPrompt(question, contextText, config);
  let rawResponseText = "";
  try {
    rawResponseText = await requestCompletion({
      question: questionText,
      contextText,
      answerPolicy,
      prompt,
    });
    const sanitizedText = stripMarkdownCodeFences(rawResponseText);
    const parsed = extractJsonObjectFromText(sanitizedText);
    const normalized = parsed
      ? normalizeAnswerResult(parsed, { weakContext: false })
      : buildDerivedAnswerResult(sanitizedText, chunks, { needsClarification: false, weakContext: false });
    const repaired = repairAnswerEvidence(normalized, chunks);
    const validation = validateAnswerEvidence(repaired, chunks);
    if (validation.valid) {
      return { ...repaired, weakContext: false, diagnostics, validation, rawResponseText };
    }
    const fallback = buildDerivedAnswerResult(
      normalizeNonEmptyString(sanitizedText, SAFE_PARSE_FAILURE_ANSWER),
      chunks,
      { needsClarification: false, weakContext: false },
    );
    const fallbackValidation = validateAnswerEvidence(fallback, chunks);
    if (fallbackValidation.valid) {
      return {
        ...fallbackValidation.answerResult,
        weakContext: false,
        diagnostics,
        validation: fallbackValidation,
        rawResponseText,
      };
    }
    return {
      ...makeSafeAnswerResult({ answer: SAFE_PARSE_FAILURE_ANSWER }),
      diagnostics,
      validation,
      rawResponseText,
    };
  } catch {
    return {
      ...makeSafeAnswerResult({ answer: SAFE_PARSE_FAILURE_ANSWER }),
      diagnostics,
      validation: { valid: false, issues: ["generation_failed"] },
      rawResponseText,
    };
  }
}

function buildAnswerResultFromResponse(answerText, retrievalResult, config = {}) {
  const diagnostics = buildContextDiagnostics(retrievalResult, config);
  const chunks = Array.isArray(retrievalResult && retrievalResult.chunks)
    ? retrievalResult.chunks
    : [];
  const normalizedAnswer = normalizeNonEmptyString(answerText, SAFE_PARSE_FAILURE_ANSWER);
  const safeNoDataAnswer = normalizeNonEmptyString(config.safeNoDataAnswer, makeSafeAnswerResult().answer);
  const needsClarification =
    diagnostics.finalChunksCount === 0 ||
    normalizedAnswer === safeNoDataAnswer ||
    normalizedAnswer === SAFE_PARSE_FAILURE_ANSWER;
  if (diagnostics.finalChunksCount === 0) {
    return {
      ...makeSafeAnswerResult({ answer: safeNoDataAnswer }),
      diagnostics,
      validation: { valid: true, issues: ["no_chunks"] },
    };
  }
  const result = buildDerivedAnswerResult(normalizedAnswer, chunks, {
    needsClarification,
    weakContext: false,
  });
  return { ...result, diagnostics, validation: validateAnswerEvidence(result, chunks) };
}

export { buildAnswerResultFromResponse, generateAnswerWithSourcesAndQuotes };
