import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("可选调试权限仅允许抖音内容脚本的有限左右键鼠标事件", async () => {
  const commands = [];
  let listener;
  let granted = false;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    permissions: { async contains() { return granted; } },
    debugger: {
      async attach(target, version) { commands.push({ kind: "attach", target, version }); },
      async sendCommand(target, method, args) { commands.push({ kind: "command", target, method, args }); },
      async detach(target) { commands.push({ kind: "detach", target }); }
    }
  };
  const code = await readFile(new URL("../extension/voice-debugger.js", import.meta.url), "utf8");
  runInNewContext(code, { chrome });
  const ask = (url, details = {}) => new Promise(resolve => {
    const handled = listener(
      { type: "DOUYIN_EXPORT_TRUSTED_MOUSE", x: 100, y: 200, button: "right", ...details },
      { tab: { id: 7 }, url }, resolve
    );
    assert.equal(handled, true);
  });

  assert.equal((await ask("https://example.com/anything")).ok, false);
  assert.equal((await ask("https://www.douyin.com/im")).reason, "debugger-permission-required");
  assert.equal(commands.length, 0);

  granted = true;
  assert.equal((await ask("https://www.douyin.com/im", { x: -1 })).reason, "invalid-click");
  assert.equal(commands.length, 0);
  assert.equal((await ask("https://www.douyin.com/im")).ok, true);
  assert.equal(commands[0].kind, "attach");
  assert.equal(commands.at(-1).kind, "detach");
  const sent = commands.filter(event => event.kind === "command");
  assert.deepEqual(sent.map(event => event.method), Array(3).fill("Input.dispatchMouseEvent"));
  assert.deepEqual(sent.map(event => event.args.type), ["mouseMoved", "mousePressed", "mouseReleased"]);
  assert.equal(sent[1].args.button, "right");
});
