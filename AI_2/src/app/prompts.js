import { ProfileRegistry } from "./profile-registry.js";

function promptInvariantDraft() {
  const raw = window.prompt("Текст инварианта:", "");
  if (raw == null) return null;
  const rule = raw.trim();
  if (!rule) {
    window.alert("Правило не может быть пустым.");
    return null;
  }
  return rule.slice(0, 300);
}

function promptProfileDraft(initial = null) {
  const base = ProfileRegistry.normalizeProfile(initial || {});
  const nameRaw = window.prompt("Имя профиля:", base.name);
  if (nameRaw == null || !nameRaw.trim()) {
    if (nameRaw != null) window.alert("Имя профиля не может быть пустым.");
    return null;
  }
  const styleRaw = window.prompt("Стиль ответа:", base.style);
  if (styleRaw == null) return null;
  const formatRaw = window.prompt("Формат ответа:", base.format);
  if (formatRaw == null) return null;
  const constraintsRaw = window.prompt(
    "Ограничения (через ; , или с новой строки):",
    Array.isArray(base.constraints) ? base.constraints.join("; ") : "",
  );
  if (constraintsRaw == null) return null;
  return {
    id: base.id,
    name: nameRaw.trim().slice(0, 60),
    style: (styleRaw.trim() || base.style).slice(0, 300),
    format: (formatRaw.trim() || base.format).slice(0, 300),
    constraints: ProfileRegistry.parseConstraints(constraintsRaw).slice(0, 20),
    createdAt: base.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export { promptInvariantDraft, promptProfileDraft };
