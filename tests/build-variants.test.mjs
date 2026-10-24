import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import "../scripts/build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standardDir = join(root, "dist", "extension");
const enhancedDir = join(root, "dist", "extension-enhanced");

test("普通版不包含任何调试器权限或后台；增强版只在安装时申请 debugger", async () => {
  const standard = JSON.parse(await readFile(join(standardDir, "manifest.json"), "utf8"));
  const enhanced = JSON.parse(await readFile(join(enhancedDir, "manifest.json"), "utf8"));
  assert.deepEqual(standard.permissions, ["activeTab", "scripting", "storage"]);
  assert.ok(!standard.optional_permissions);
  assert.ok(!standard.background);
  await assert.rejects(access(join(standardDir, "voice-debugger.js")));

  assert.deepEqual(enhanced.permissions, ["activeTab", "scripting", "storage", "debugger"]);
  assert.ok(!enhanced.optional_permissions);
  assert.deepEqual(enhanced.background, { service_worker: "voice-debugger.js" });
  await access(join(enhancedDir, "voice-debugger.js"));
  assert.equal(standard.version, enhanced.version);

  const popup = await readFile(join(enhancedDir, "popup.js"), "utf8");
  assert.doesNotMatch(popup, /permissions\.(?:request|remove)\s*\(/);
});
