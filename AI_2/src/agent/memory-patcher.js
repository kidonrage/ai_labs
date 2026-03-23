import {
  normalizeLongTermMemory,
  normalizeWorkingMemory,
} from "./state-shapes.js";

function extractMemoryWritePatch(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root =
    parsed.write && typeof parsed.write === "object" && !Array.isArray(parsed.write)
      ? parsed.write
      : parsed;
  return root && typeof root === "object" && !Array.isArray(root) ? root : null;
}

function pushUniqueStrings(target, values) {
  const next = Array.isArray(target) ? [...target] : [];
  for (const raw of Array.isArray(values) ? values : []) {
    const item = typeof raw === "string" ? raw.trim() : "";
    if (item && !next.includes(item)) next.push(item);
  }
  return next;
}

function mergeEntityObject(target, patch) {
  const out = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
  const src = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  for (const [key, value] of Object.entries(src)) {
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (!normalizedKey) continue;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      out[normalizedKey] = value;
    }
  }
  return out;
}

function applyMemoryWritePatch({ longTermMemory, workingMemory, writePatch }) {
  if (!writePatch || typeof writePatch !== "object" || Array.isArray(writePatch)) {
    return {
      longTermMemory: normalizeLongTermMemory(longTermMemory),
      workingMemory: normalizeWorkingMemory(workingMemory),
    };
  }
  const normalizedLong = normalizeLongTermMemory(longTermMemory);
  const normalizedWorking = normalizeWorkingMemory(workingMemory);
  const workingPatch =
    writePatch.working && typeof writePatch.working === "object" ? writePatch.working : {};
  const longPatch =
    writePatch.long_term && typeof writePatch.long_term === "object"
      ? writePatch.long_term
      : {};
  const nextWorking = { task: { ...normalizedWorking.task } };
  if (typeof workingPatch.set_goal === "string" && workingPatch.set_goal.trim()) {
    nextWorking.task.goal = workingPatch.set_goal.trim();
  }
  nextWorking.task.constraints = pushUniqueStrings(
    nextWorking.task.constraints,
    workingPatch.add_constraints,
  );
  nextWorking.task.decisions = pushUniqueStrings(
    nextWorking.task.decisions,
    workingPatch.add_decisions,
  );
  nextWorking.task.open_questions = pushUniqueStrings(
    nextWorking.task.open_questions,
    workingPatch.add_open_questions,
  );
  nextWorking.task.artifacts = pushUniqueStrings(
    nextWorking.task.artifacts,
    workingPatch.add_artifacts,
  );
  nextWorking.task.entities = mergeEntityObject(
    nextWorking.task.entities,
    workingPatch.merge_entities,
  );

  const nextLong = {
    ...normalizedLong,
    profile: { ...normalizedLong.profile },
    preferences: { ...normalizedLong.preferences },
  };
  if (longPatch.add_profile && typeof longPatch.add_profile === "object") {
    for (const [key, value] of Object.entries(longPatch.add_profile)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) {
        nextLong.profile[key.trim()] = value.trim();
      }
    }
  }
  if (longPatch.add_preferences && typeof longPatch.add_preferences === "object") {
    for (const [key, value] of Object.entries(longPatch.add_preferences)) {
      const normalizedKey = typeof key === "string" ? key.trim() : "";
      if (!normalizedKey) continue;
      nextLong.preferences[normalizedKey] = Array.isArray(value)
        ? pushUniqueStrings([], value)
        : typeof value === "string" && value.trim()
          ? value.trim()
          : nextLong.preferences[normalizedKey];
    }
  }
  nextLong.facts = pushUniqueStrings(nextLong.facts, longPatch.add_facts);
  nextLong.stable_decisions = pushUniqueStrings(
    nextLong.stable_decisions,
    longPatch.add_stable_decisions,
  );

  return {
    longTermMemory: normalizeLongTermMemory(nextLong),
    workingMemory: normalizeWorkingMemory(nextWorking),
  };
}

export { applyMemoryWritePatch, extractMemoryWritePatch };
