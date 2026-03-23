function buildSafeAlternative(violatedInvariants, mandatoryInvariantLabel) {
  const source = Array.isArray(violatedInvariants) ? violatedInvariants : [];
  const lines = [];
  if (source.some((item) => /node\.js/i.test(item.invariant))) {
    lines.push("Сохраняем backend на Node.js и улучшаем архитектуру внутри текущего стека.");
  }
  if (source.some((item) => /postgresql/i.test(item.invariant))) {
    lines.push("Оставляем PostgreSQL и улучшаем схему, индексы и запросы без замены СУБД.");
  }
  if (source.some((item) => /персональн.*данн.*лог/i.test(item.invariant))) {
    lines.push("Убираем персональные данные из логов, используем маскирование и защищенное хранилище.");
  }
  if (source.some((item) => item.invariant === mandatoryInvariantLabel)) {
    lines.push("Сформулируйте цель без запроса на отключение обязательных ограничений.");
  }
  if (lines.length === 0) {
    return "Сохраняем текущие ограничения архитектуры, стека и данных и предлагаем безопасный вариант в этих рамках.";
  }
  return lines.join(" ");
}

export { buildSafeAlternative };
