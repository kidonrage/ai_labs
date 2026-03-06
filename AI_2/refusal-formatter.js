function formatInvariantRefusal(checkResult) {
  const check = checkResult && typeof checkResult === "object" ? checkResult : {};
  const violated = Array.isArray(check.violatedInvariants) ? check.violatedInvariants : [];

  if (violated.some((item) => item && item.id === "invariants_mandatory")) {
    const alt =
      typeof check.safeAlternative === "string" && check.safeAlternative.trim()
        ? check.safeAlternative.trim()
        : "Сформулируйте цель без отмены обязательных ограничений системы.";
    return `Не могу игнорировать инварианты, так как это обязательные ограничения системы. Допустимая альтернатива: ${alt}`;
  }

  const labels = violated
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.id;
      return title ? `${title} (${item.id})` : "";
    })
    .filter(Boolean);

  const reason = labels.length > 0
    ? `нарушаются инварианты: ${labels.join(", ")}`
    : "запрос нарушает обязательные инварианты";

  const alt =
    typeof check.safeAlternative === "string" && check.safeAlternative.trim()
      ? check.safeAlternative.trim()
      : "Могу предложить вариант в рамках текущей архитектуры, стека и правил данных.";

  return `Не могу предложить этот вариант, потому что ${reason}. Допустимая альтернатива: ${alt}`;
}

export { formatInvariantRefusal };
