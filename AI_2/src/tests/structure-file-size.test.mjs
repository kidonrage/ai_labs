import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
const MAX_LINES = 300;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests") continue;
      walk(full, files);
      continue;
    }
    if (!/\.(js|css)$/.test(entry.name)) continue;
    files.push(full);
  }
  return files;
}

async function main() {
  const oversized = walk(ROOT)
    .map((file) => ({
      file: path.relative(process.cwd(), file),
      lines: fs.readFileSync(file, "utf8").split("\n").length,
    }))
    .filter((item) => item.lines > MAX_LINES);

  assert.deepEqual(oversized, []);
}

main();
