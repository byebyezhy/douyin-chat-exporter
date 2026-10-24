import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import "../scripts/build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "dist", "extension");

test("v0.4 单一发行包不含 debugger，携带 API 采集和旧版回退", async () => {
  const manifest = JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.ok(!manifest.optional_permissions);
  assert.ok(!manifest.background);
  await assert.rejects(access(join(outputDir, "voice-debugger.js")));
  for (const file of ["im-core.js", "im-page-bridge.js", "im-export.js", "full-export.js"]) {
    await access(join(outputDir, file));
  }
  const popup = await readFile(join(outputDir, "popup.js"), "utf8");
  assert.match(popup, /world: "MAIN"/);
  assert.doesNotMatch(popup, /permissions\.(?:request|remove)\s*\(/);
});
