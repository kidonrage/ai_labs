import { Agent } from "../agent.js";
import { BranchWorkspace } from "./branch-workspace.js";
import { ProfileRegistry } from "./profile-registry.js";
import { clonePlain, makeChatId, nextChatTitle } from "./utils.js";

class WorkspaceStore {
  constructor(store, repository) {
    this.store = store;
    this.repository = repository;
    this.profileRegistry = new ProfileRegistry(this.store);
  }

  persist() {
    this.repository.save(this.store);
  }

  getActiveChat() {
    return this.store.chats.find((chat) => chat.id === this.store.activeChatId) || null;
  }

  getActiveProfile() {
    return this.profileRegistry.getActive();
  }

  switchChat(chatId) {
    if (this.store.chats.some((chat) => chat.id === chatId)) this.store.activeChatId = chatId;
  }

  switchProfile(profileId) {
    this.profileRegistry.setActive(profileId);
  }

  getActiveBranch(chat = this.getActiveChat()) {
    return BranchWorkspace.getActiveBranch(chat);
  }

  createChat(config) {
    const agent = new Agent({ ...config, apiKey: "" });
    const initialState = agent.exportState();
    const chat = {
      id: makeChatId(),
      title: nextChatTitle(this.store.chats),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: clonePlain(initialState),
      branching: BranchWorkspace.normalizeBranching(null, initialState),
    };
    this.store.chats.push(chat);
    this.store.activeChatId = chat.id;
    return chat;
  }

  cloneChatFromCurrent(currentState) {
    const state = clonePlain(currentState || {});
    const now = new Date().toISOString();
    const chat = {
      id: makeChatId(),
      title: nextChatTitle(this.store.chats),
      createdAt: now,
      updatedAt: now,
      state,
      branching: BranchWorkspace.normalizeBranching(null, state),
    };
    this.store.chats.push(chat);
    this.store.activeChatId = chat.id;
    return chat;
  }

  renameActiveChat(title) {
    const chat = this.getActiveChat();
    if (!chat) return null;
    chat.title = title;
    chat.updatedAt = new Date().toISOString();
    return chat;
  }

  deleteActiveChat() {
    if (this.store.chats.length <= 1) return null;
    const idx = this.store.chats.findIndex((chat) => chat.id === this.store.activeChatId);
    if (idx < 0) return null;
    const [removed] = this.store.chats.splice(idx, 1);
    this.store.activeChatId = (this.store.chats[Math.max(0, idx - 1)] || this.store.chats[0]).id;
    return removed;
  }
}

export { WorkspaceStore };
