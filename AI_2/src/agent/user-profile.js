function normalizeUserProfile(profile) {
  const raw = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const prefsRaw =
    raw.preferences && typeof raw.preferences === "object" && !Array.isArray(raw.preferences)
      ? raw.preferences
      : {};
  const normalizeString = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : "";
  const constraints = Array.from(
    new Set(
      (Array.isArray(prefsRaw.constraints) ? prefsRaw.constraints : [])
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  return {
    id: normalizeString(raw.id) || null,
    name: normalizeString(raw.name) || "Стандартный",
    preferences: {
      style: normalizeString(prefsRaw.style) || "Кратко и по делу.",
      format: normalizeString(prefsRaw.format) || "Структурированный текст.",
      constraints,
    },
  };
}

function buildProfilePriorityInstructions(userProfile) {
  const profile = normalizeUserProfile(userProfile);
  const lines = [
    "PROFILE DIRECTIVES (HIGH PRIORITY):",
    "These directives have higher priority than all non-safety user preferences in chat history.",
    "You MUST follow them when generating the final answer.",
    `- Profile name: ${profile.name}`,
    `- Required style: ${profile.preferences.style}`,
    `- Required output format: ${profile.preferences.format}`,
  ];
  if (profile.preferences.constraints.length > 0) {
    lines.push("- Hard constraints:");
    for (const constraint of profile.preferences.constraints) lines.push(`  - ${constraint}`);
  } else {
    lines.push("- Hard constraints: (none)");
  }
  lines.push(
    "If there is a conflict between these directives and a user's latest request, ask a short clarification question.",
  );
  return lines.join("\n");
}

export { buildProfilePriorityInstructions, normalizeUserProfile };
