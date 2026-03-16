import assert from "node:assert/strict";
import { shouldRestoreOptimisticUserMessage } from "../helpers.js";

async function main() {
  assert.equal(shouldRestoreOptimisticUserMessage(0, 0), true);
  assert.equal(shouldRestoreOptimisticUserMessage(3, 3), true);
  assert.equal(shouldRestoreOptimisticUserMessage(4, 3), false);
  assert.equal(shouldRestoreOptimisticUserMessage(10, 2), false);
}

main();
