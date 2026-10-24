import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "extension", "manifest.json"), "utf8"));
const allowed = new Set(["activeTab", "scripting", "storage"]);
if (manifest.manifest_version !== 3) throw new Error("Require Manifest V3");
if (!manifest.action?.default_popup) throw new Error("Missing popup");
for (const name of manifest.permissions || []) {
  if (!allowed.has(name)) throw new Error(`Unexpected permission: ${name}`);
}
if (JSON.stringify(manifest.optional_permissions || []) !== JSON.stringify(["debugger"])) {
  throw new Error("Trusted mouse must use ONLY optional debugger permission");
}
if ((manifest.host_permissions || []).length) throw new Error("Persistent host permissions are prohibited");
execFileSync(process.execPath, ["--check", join(root, "extension", "popup.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(root, "extension", "index-monitor.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(root, "extension", "local-capture.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(root, "extension", "export-core.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(root, "extension", "full-export.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(root, "extension", "voice-debugger.js")], { stdio: "inherit" });
console.log("Manifest permission check passed");
