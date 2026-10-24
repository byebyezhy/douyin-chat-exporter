import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const output = join(root, "dist", "extension");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
// Legacy trusted-right-click experiment remains in Git history for audit,
// but is not distributed in the API-first extension.
await rm(join(output, "voice-debugger.js"), { force: true });
console.log(`Built API-first extension: ${output}`);
