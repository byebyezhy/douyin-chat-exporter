import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const standard = join(root, "dist", "extension");
const enhanced = join(root, "dist", "extension-enhanced");
const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));

for (const output of [standard, enhanced]) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(source, output, { recursive: true });
}

// Chrome forbids `debugger` in optional_permissions. Keep the ordinary
// public build least-privileged; install the separate enhanced build only
// after the user accepts its prominent browser permission warning.
await rm(join(standard, "voice-debugger.js"), { force: true });
const enhancedManifest = {
  ...manifest,
  name: "抖音聊天导出助手（增强语音版）",
  description: "单会话本地导出及原生语音转写；安装时明确请求强权限 debugger，仅用于用户开启的可信鼠标事件。",
  permissions: [...manifest.permissions, "debugger"],
  background: { service_worker: "voice-debugger.js" }
};
await writeFile(join(enhanced, "manifest.json"), JSON.stringify(enhancedManifest, null, 2) + "\n");
console.log(`Built standard extension: ${standard}`);
console.log(`Built enhanced extension (requires debugger consent at installation): ${enhanced}`);
