import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Synthetic, fully offline browser-like DOM. No real Douyin content or session.
test("v0.2 content script can auto-scroll and checkpoint overlapping virtual rows", async () => {
  const controls = new Map();
  const snapshots = new Map();
  const alerts = [];
  let clock = 1000;
  let currentTop = 0;
  let voiceText = "合成语音 10秒";
  let manuallyConvertedVoice = "合成语音 8秒";
  let nativeMenuVisible = false;
  const scrollerHeight = 6000;
  const list = { children: [], isConnected: true, contains: () => false };
  const voiceTarget = (index) => ({
    tagName: "BUTTON",
    getAttribute: name => name === "aria-label" ? "播放语音" : null,
    getBoundingClientRect: () => ({ left: 400, top: 300, width: 80, height: 35 }),
    dispatchEvent() { nativeMenuVisible = index === 2; }
  });
  const genericCanvas = { tagName: "CANVAS", parentElement: voiceTarget(4) };
  const durationLabel = { innerText: '28"', parentElement: voiceTarget(4), closest: () => null };
  const node = (index) => ({
    nodeType: 1, isConnected: true, parentElement: list, tagName: "DIV",
    get innerText() { return index === 2 ? voiceText : index === 3 ? manuallyConvertedVoice : index === 4 ? '28"' : `合成消息${index}`; },
    hasAttribute: name => name === "data-index",
    getAttribute: name => name === "data-index" ? String(index) : null,
    matches: () => false,
    querySelector: selector => selector === "canvas" && [4, 5].includes(index) ? genericCanvas : null,
    querySelectorAll: selector => {
      if ([2, 3].includes(index) && selector.includes("[aria-label]")) return [voiceTarget(index)];
      if ([4, 5].includes(index) && selector === "canvas") return [genericCanvas];
      if (index === 4 && selector === "span,p,button,div") return [durationLabel];
      return [];
    },
    getBoundingClientRect: () => ({ left: 370, right: 560, width: 190, height: 35 })
  });
  function renderRows() {
    const start = Math.floor(currentTop / 120);
    list.children = Array.from({ length: 10 }, (_, i) => node(start + i));
  }
  const scroller = {
    isConnected: true, firstElementChild: list, scrollHeight: scrollerHeight, clientHeight: 500,
    get scrollTop() { return currentTop; },
    set scrollTop(value) { currentTop = Math.max(0, Math.min(scrollerHeight - 500, value)); renderRows(); },
    getBoundingClientRect: () => ({ left: 300, right: 900, top: 60, bottom: 660, height: 600 }),
    querySelectorAll: () => []
  };
  renderRows();
  const input = {
    getBoundingClientRect: () => ({ left: 300, right: 600, top: 700, bottom: 730 })
  };
  function control(id) {
    if (!controls.has(id)) controls.set(id, {
      value: "", checked: true, hidden: false, disabled: false, textContent: "",
      handlers: {}, addEventListener(name, listener) { this.handlers[name] = listener; }
    });
    return controls.get(id);
  }
  const shadow = { innerHTML: "", getElementById: control };
  const host = { style: {}, attachShadow: () => shadow, remove() {} };
  const document = {
    querySelector: selector => selector === '[contenteditable="true"]' ? input : null,
    querySelectorAll: selector => {
      if (selector === "*") return [scroller];
      if (selector.startsWith('[role="menuitem"]') && nativeMenuVisible) return [{
        innerText: "转成文字",
        getBoundingClientRect: () => ({ left: 400, right: 500, top: 300, bottom: 335, width: 100, height: 35 }),
        click() { voiceText += "\n合成转写结果"; nativeMenuVisible = false; }
      }];
      return [];
    },
    getElementById: () => null,
    createElement: () => host,
    body: { appendChild() {} }
  };
  const storage = {
    async get(key) { return snapshots.has(key) ? { [key]: snapshots.get(key) } : {}; },
    async set(value) { for (const [k, v] of Object.entries(value)) snapshots.set(k, v); },
    async remove(key) { snapshots.delete(key); }
  };
  const context = {
    document, location: { href: "https://www.douyin.com/" },
    chrome: { storage: { local: storage } },
    window: { alert: message => alerts.push(message), confirm: () => true },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ overflowY: "auto" }),
    setInterval: () => 1, clearInterval: () => {},
    setTimeout(callback, millis = 0) { clock += millis; queueMicrotask(callback); },
    Date: class extends Date { static now() { return clock; } },
    Blob, URL, MouseEvent: class {}
  };
  const core = await readFile(new URL("../extension/export-core.js", import.meta.url), "utf8");
  const runner = await readFile(new URL("../extension/full-export.js", import.meta.url), "utf8");
  runInNewContext(core, context, { filename: "export-core.js" });
  runInNewContext(runner, context, { filename: "full-export.js" });

  control("tag").value = "合成测试会话";
  control("voice").checked = true;
  control("trustedVoice").checked = false;
  await control("start").handlers.click();
  for (let spin = 0; spin < 300; spin++) await Promise.resolve();

  const saved = snapshots.get("douyin_chat_export_v020_checkpoint");
  assert.deepEqual(alerts, []);
  assert.ok(saved, "creates an extension-local checkpoint");
  assert.ok(saved.entries.length > 30, "retains virtual rows no longer rendered");
  assert.equal(context.__DOUYIN_EXPORT_CORE_V020__.coverage(saved.entries.map(x => x.dataIndex)).gapCount, 0);
  assert.equal(saved.entries.some(x => x.visibleText === "合成消息0"), true);
  const voice = saved.entries.find(x => x.dataIndex === 2);
  assert.equal(voice.type, "voice");
  assert.equal(voice.voiceTranscript?.status, "success");
  assert.equal(voice.voiceTranscript?.text, "合成转写结果");
  const manual = saved.entries.find(x => x.dataIndex === 3);
  assert.equal(manual.type, "voice");
  assert.equal(manual.voiceTranscript?.status, "manual_required", "untrusted contextmenu may be rejected");
  assert.equal(saved.entries.find(x => x.dataIndex === 4).type, "voice", "recognizes 28-inch-like voice duration with canvas");
  assert.equal(saved.entries.find(x => x.dataIndex === 5).type, "text", "does not treat canvas alone as voice");
  assert.match(control("state").textContent, /partial|incomplete/);
  scroller.scrollTop = 0;
  manuallyConvertedVoice += "\n手动显示的转写内容";
  await control("rescan").handlers.click();
  const rescanned = snapshots.get("douyin_chat_export_v020_checkpoint");
  assert.equal(rescanned.entries.find(x => x.dataIndex === 3).voiceTranscript.status, "success");
  assert.equal(rescanned.entries.find(x => x.dataIndex === 3).voiceTranscript.text, "手动显示的转写内容");
  assert.equal(saved.startedFromNewest, true);
  assert.equal(control("json").hidden, false, "offers a local JSON export after the scan stops");
  assert.equal(control("txt").hidden, false);
  assert.equal(control("html").hidden, false);

  // Simulate a later extension injection: checkpoint must be detected and
  // explicitly confirmed before resuming the same user-tagged conversation.
  runInNewContext(runner, context, { filename: "full-export-reopened.js" });
  for (let spin = 0; spin < 8; spin++) await Promise.resolve();
  assert.equal(control("restore").hidden, false);
  assert.equal(control("tag").value, "合成测试会话");
  await control("restore").handlers.click();
  for (let spin = 0; spin < 200; spin++) await Promise.resolve();
  assert.ok(snapshots.get("douyin_chat_export_v020_checkpoint").entries.length >= saved.entries.length);
});
