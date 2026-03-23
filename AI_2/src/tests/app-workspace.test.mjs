import assert from "node:assert/strict";
import { ChatRepository } from "../app/chat-repository.js";
import { ProfileRegistry } from "../app/profile-registry.js";
import { WorkspaceStore } from "../app/workspace-store.js";

async function main() {
  const fallbackConfig = {
    apiMode: "ollama_chat",
    baseUrl: "http://localhost:11434/api/chat",
    model: "gemma3",
    temperature: 0.2,
  };
  const repository = new ChatRepository(fallbackConfig);
  const workspace = new WorkspaceStore(repository.normalizeStore(null), repository);

  const created = workspace.createChat(fallbackConfig);
  assert.ok(created.id);
  assert.equal(workspace.store.activeChatId, created.id);
  assert.equal(workspace.store.chats.length, 2);

  const cloned = workspace.cloneChatFromCurrent({ config: fallbackConfig, history: [] });
  assert.ok(cloned.id);
  assert.equal(workspace.store.activeChatId, cloned.id);
  assert.equal(workspace.store.chats.length, 3);

  const profileRegistry = new ProfileRegistry(workspace.store);
  const createdProfile = profileRegistry.create({
    name: "Архитектор",
    style: "Строго",
    format: "Коротко",
    constraints: ["Без воды"],
  });
  assert.equal(workspace.store.activeProfileId, createdProfile.id);
  assert.equal(profileRegistry.getActive().name, "Архитектор");

  profileRegistry.delete(createdProfile.id);
  assert.notEqual(workspace.store.activeProfileId, createdProfile.id);
  assert.ok(workspace.getActiveBranch(workspace.getActiveChat()));
}

main();
