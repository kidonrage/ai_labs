import assert from "node:assert/strict";
import { renderChatList } from "../app/ui-renderers.js";

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.type = "";
    this.disabled = false;
    this._textContent = "";
    this._innerHTML = "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this.children = [];
    this._innerHTML = "";
  }

  get textContent() {
    if (this.children.length > 0) return this.children.map((child) => child.textContent).join("");
    return this._textContent;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    if (!this._innerHTML) this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function createFakeDocument() {
  const nodes = new Map();
  return {
    createElement(tagName) {
      return new FakeElement(tagName, this);
    },
    getElementById(id) {
      return nodes.get(id) || null;
    },
    register(id, element) {
      nodes.set(id, element);
      return element;
    },
  };
}

async function main() {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  const chatList = document.register("chatList", new FakeElement("div", document));
  const deleteChat = document.register("deleteChat", new FakeElement("button", document));
  globalThis.document = document;

  try {
    renderChatList([
      {
        id: "chat_1",
        title: "<img src=x onerror=alert(1)>",
        state: {
          history: [
            {
              role: "assistant",
              text: "<script>alert('xss')</script><div>safe?</div>",
            },
          ],
        },
      },
    ], "chat_1");
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(chatList.children.length, 1);
  assert.equal(deleteChat.disabled, true);

  const item = chatList.children[0];
  assert.equal(item.innerHTML, "");
  assert.equal(item.children.length, 2);
  assert.equal(item.children[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(
    item.children[1].textContent,
    "<script>alert('xss')</script><div>safe?</div>",
  );
}

main();
