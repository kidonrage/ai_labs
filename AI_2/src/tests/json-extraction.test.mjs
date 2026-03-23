import assert from "node:assert/strict";
import { extractJsonObject } from "../json-extraction.js";
import { extractJsonObjectFromText } from "../rag/shared.js";

async function main() {
  const direct = { answer: "ok", meta: { turns: 2 } };
  assert.deepEqual(extractJsonObject(JSON.stringify(direct)), direct);
  assert.deepEqual(extractJsonObjectFromText(JSON.stringify(direct)), direct);

  const wrapped = 'Ответ модели:\n```json\n{"final":"Готово","score":1}\n```';
  const expected = { final: "Готово", score: 1 };
  assert.deepEqual(extractJsonObject(wrapped), expected);
  assert.deepEqual(extractJsonObjectFromText(wrapped), expected);

  assert.equal(extractJsonObject('["not","an","object"]'), null);
  assert.equal(extractJsonObject('"plain string"'), null);
  assert.equal(extractJsonObjectFromText("prefix [1,2,3] suffix"), null);
}

main();
