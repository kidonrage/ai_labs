import { makeProfileId } from "./utils.js";

class ProfileRegistry {
  static normalizeProfile(profile, index = 0) {
    const raw = profile && typeof profile === "object" ? profile : {};
    const normalizeString = (value) =>
      typeof value === "string" && value.trim() ? value.trim() : "";
    const normalizeArray = (arr) =>
      Array.from(
        new Set(
          (Array.isArray(arr) ? arr : [])
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      );
    const now = new Date().toISOString();
    return {
      id: normalizeString(raw.id) || makeProfileId(),
      name: normalizeString(raw.name) || `Профиль ${index + 1}`,
      style: normalizeString(raw.style) || "Кратко, по делу, без воды.",
      format:
        normalizeString(raw.format) ||
        "Структурированный ответ с заголовками при необходимости.",
      constraints: normalizeArray(raw.constraints),
      createdAt: normalizeString(raw.createdAt) || now,
      updatedAt: normalizeString(raw.updatedAt) || now,
    };
  }

  static normalizeProfiles(rawProfiles) {
    const profiles = (Array.isArray(rawProfiles) ? rawProfiles : [])
      .map((profile, index) => this.normalizeProfile(profile, index))
      .filter((profile) => typeof profile.id === "string" && profile.id);
    return profiles.length > 0
      ? profiles
      : [this.normalizeProfile({ id: "profile_default", name: "Стандартный" }, 0)];
  }

  static parseConstraints(raw) {
    return Array.from(
      new Set(
        String(raw || "")
          .split(/\n|,|;/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  static toAgentPrefs(profile) {
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      preferences: {
        style: profile.style,
        format: profile.format,
        constraints: Array.isArray(profile.constraints) ? profile.constraints : [],
      },
    };
  }

  constructor(store) {
    this.store = store;
  }

  getAll() {
    return this.store.profiles;
  }

  getActive() {
    return this.getAll().find((profile) => profile.id === this.store.activeProfileId) || this.getAll()[0] || null;
  }

  setActive(profileId) {
    if (this.getAll().some((profile) => profile.id === profileId)) {
      this.store.activeProfileId = profileId;
    }
  }

  create(profileDraft) {
    const profile = ProfileRegistry.normalizeProfile(profileDraft, this.getAll().length);
    this.getAll().push(profile);
    this.setActive(profile.id);
    return profile;
  }

  delete(profileId) {
    if (this.getAll().length <= 1) return null;
    const idx = this.getAll().findIndex((profile) => profile.id === profileId);
    if (idx < 0) return null;
    const [removed] = this.getAll().splice(idx, 1);
    if (this.store.activeProfileId === removed.id) {
      this.store.activeProfileId = (this.getAll()[Math.max(0, idx - 1)] || this.getAll()[0]).id;
    }
    return removed;
  }
}

export { ProfileRegistry };
