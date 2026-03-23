import { Agent } from "../agent.js";
import { loadState, saveState } from "../storage.js";
import { BranchWorkspace } from "./branch-workspace.js";
import { clonePlain } from "./utils.js";
import { ProfileRegistry } from "./profile-registry.js";

class ChatRepository {
  constructor(fallbackConfig) {
    this.fallbackConfig = fallbackConfig;
    this.hadPersistedState = false;
  }

  load() {
    const raw = loadState();
    this.hadPersistedState = Boolean(raw);
    return this.normalizeStore(raw);
  }

  save(store) {
    saveState(store);
  }

  normalizeStore(raw) {
    const normalizeLongTerm = (value) => Agent.normalizeLongTermMemory(value);
    if (raw && Array.isArray(raw.chats) && typeof raw.activeChatId === "string") {
      const chats = raw.chats
        .filter((chat) => chat && typeof chat.id === "string")
        .map((chat) => {
          const branching = BranchWorkspace.normalizeBranching(
            chat.branching,
            chat.state && typeof chat.state === "object" ? chat.state : null,
          );
          const activeBranch = branching.branches.find((branch) => branch.id === branching.activeBranchId) || branching.branches[0];
          return {
            id: chat.id,
            title: typeof chat.title === "string" && chat.title.trim() ? chat.title : "Чат",
            createdAt: typeof chat.createdAt === "string" ? chat.createdAt : new Date().toISOString(),
            updatedAt: typeof chat.updatedAt === "string" ? chat.updatedAt : new Date().toISOString(),
            state: clonePlain(activeBranch.state),
            branching,
          };
        });
      if (chats.length > 0) {
        const profiles = ProfileRegistry.normalizeProfiles(raw.profiles);
        return {
          version: 4,
          longTermMemory: normalizeLongTerm(raw.longTermMemory),
          activeChatId: chats.some((chat) => chat.id === raw.activeChatId) ? raw.activeChatId : chats[0].id,
          activeProfileId: profiles.some((profile) => profile.id === raw.activeProfileId) ? raw.activeProfileId : profiles[0].id,
          profiles,
          chats,
        };
      }
    }
    if (raw && typeof raw === "object" && Array.isArray(raw.history) && raw.config) {
      const branching = BranchWorkspace.normalizeBranching(null, raw);
      return {
        version: 4,
        longTermMemory: normalizeLongTerm(raw.longTermMemory),
        activeChatId: "chat_1",
        activeProfileId: "profile_default",
        profiles: [ProfileRegistry.normalizeProfile({ id: "profile_default", name: "Стандартный" }, 0)],
        chats: [{ id: "chat_1", title: "Чат 1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: clonePlain(raw), branching }],
      };
    }
    const initialAgent = new Agent({ ...this.fallbackConfig, apiKey: "" });
    const initialState = initialAgent.exportState();
    return {
      version: 4,
      longTermMemory: normalizeLongTerm(raw && raw.longTermMemory),
      activeChatId: "chat_1",
      activeProfileId: "profile_default",
      profiles: [ProfileRegistry.normalizeProfile({ id: "profile_default", name: "Стандартный" }, 0)],
      chats: [{
        id: "chat_1",
        title: "Чат 1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: clonePlain(initialState),
        branching: BranchWorkspace.normalizeBranching(null, initialState),
      }],
    };
  }
}

export { ChatRepository };
