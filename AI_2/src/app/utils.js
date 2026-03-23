const $ = (id) => document.getElementById(id);

function makeId(prefix) {
  return (crypto.randomUUID && crypto.randomUUID()) || `${prefix}_${Date.now()}_${Math.random()}`;
}

const makeChatId = () => makeId("chat");
const makeBranchId = () => makeId("branch");
const makeProfileId = () => makeId("profile");

function clonePlain(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const defaultTotals = () => ({
  requestInputTokens: 0,
  requestOutputTokens: 0,
  requestTotalTokens: 0,
  costRub: 0,
});

function nextChatTitle(chats) {
  let maxNum = 0;
  for (const chat of chats) {
    const match = /^Чат\s+(\d+)$/i.exec(chat.title || "");
    if (match) maxNum = Math.max(maxNum, Number(match[1]));
  }
  return `Чат ${maxNum + 1}`;
}

export {
  $,
  clonePlain,
  defaultTotals,
  makeBranchId,
  makeChatId,
  makeProfileId,
  nextChatTitle,
};
