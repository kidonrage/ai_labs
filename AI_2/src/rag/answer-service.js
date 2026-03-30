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

function uniqueIssues(issues = [], extraIssues = []) {
  return Array.from(new Set([...(Array.isArray(issues) ? issues : []), ...extraIssues]));
}

function finalizeAnswerEvidence(answerResult, chunks) {
  const repaired = repairAnswerEvidence(answerResult, chunks);
  const repairedValidation = validateAnswerEvidence(repaired, chunks);
  if (repairedValidation.valid) {
    return { answerResult: repaired, validation: repairedValidation };
  }

  const rebuilt = buildDerivedAnswerResult(repaired.answer, chunks, {
    needsClarification: repaired.needsClarification,
    weakContext: false,
  });
  const rebuiltValidation = validateAnswerEvidence(rebuilt, chunks);
  if (rebuiltValidation.valid) {
    return {
      answerResult: rebuilt,
      validation: {
        valid: true,
        issues: uniqueIssues(repairedValidation.issues, ["evidence_rebuilt_from_chunks"]),
        answerResult: rebuilt,
      },
    };
  }

  const degraded = normalizeAnswerResult({
    ...repaired,
    sources: [],
    quotes: [],
  });
  return {
    answerResult: degraded,
    validation: {
      valid: false,
      issues: uniqueIssues(
        uniqueIssues(repairedValidation.issues, rebuiltValidation.issues),
        ["evidence_degraded"],
      ),
      answerResult: degraded,
    },
  };
}

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
      : buildDerivedAnswerResult(sanitizedText, chunks, {
          needsClarification: false,
          weakContext: false,
        });
    const extractedAnswer = normalizeNonEmptyString(
      normalized.answer,
      parsed ? "" : normalizeNonEmptyString(sanitizedText, ""),
    );
    if (!extractedAnswer) {
      return {
        ...makeSafeAnswerResult({ answer: SAFE_PARSE_FAILURE_ANSWER }),
        diagnostics,
        validation: { valid: false, issues: ["answer_missing"] },
        rawResponseText,
      };
    }
    const { answerResult, validation } = finalizeAnswerEvidence(
      normalizeAnswerResult({
        ...normalized,
        answer: extractedAnswer,
        weakContext: false,
      }),
      chunks,
    );
    return {
      ...answerResult,
      weakContext: false,
      diagnostics,
      validation,
      rawResponseText,
    };
  } catch (error) {
    return {
      ...makeSafeAnswerResult({ answer: SAFE_PARSE_FAILURE_ANSWER }),
      diagnostics,
      validation: { valid: false, issues: ["generation_failed"] },
      errorType:
        error && typeof error.errorType === "string" && error.errorType.trim()
          ? error.errorType.trim()
          : "model_call_error",
      errorMessage:
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : String(error),
      rawResponseText:
        typeof rawResponseText === "string" && rawResponseText.trim()
          ? rawResponseText
          : error && typeof error.rawResponsePreview === "string"
            ? error.rawResponsePreview
            : "",
      rawResponsePreview:
        error && typeof error.rawResponsePreview === "string"
          ? error.rawResponsePreview
          : "",
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
