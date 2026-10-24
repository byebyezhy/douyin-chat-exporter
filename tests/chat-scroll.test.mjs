import test from "node:test";
import assert from "node:assert/strict";
import "../extension/chat-scroll.js";

const scroll = globalThis.__DOUYIN_CHAT_SCROLL_V042__;

function surface() {
  const list = { isConnected: true,
    children: [{ hasAttribute: name => name === "data-index", getAttribute: () => "12" }] };
  let top = 0;
  const scroller = { isConnected: true, firstElementChild: list, clientHeight: 800,
    scrollHeight: 3600, querySelectorAll: () => [],
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
  };
  return { list, scroller };
}

test("找准聊天滚动容器，避免误滚动左侧联系人列表", () => {
  const { list, scroller } = surface();
  const editor = { getBoundingClientRect: () => ({ left: 400, right: 1100, width: 700, top: 980 }) };
  const sidebar = { scrollHeight: 10000, clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 60, height: 840 }) };
  scroller.getBoundingClientRect = () => ({ left: 320, right: 1420, top: 60, height: 900 });
  const doc = {
    querySelector: () => editor,
    querySelectorAll: () => [sidebar, scroller]
  };
  assert.deepEqual(scroll.locateChat(doc, () => ({ overflowY: "auto" })), { list, scroller });
});

test("滚到旧版虚拟列表的最早端，加载过程 scrollHeight 变大时仍继续", async () => {
  const { list, scroller } = surface();
  let sleeps = 0;
  const positions = [];
  const result = await scroll.scrollToOldest({
    surface: { list, scroller }, expectedHref: "https://www.douyin.com/",
    href: () => "https://www.douyin.com/", maxSteps: 200,
    sleep: async () => { if (++sleeps === 2 || sleeps === 4) scroller.scrollHeight += 900; },
    onProgress: state => positions.push(state.scrollTop)
  });
  assert.equal(result.state, "visual-end");
  assert.ok(positions.length > 7);
  assert.equal(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight);
});

test("遇到明确的最早消息提示、会话变化及手工停止都安全退出", async () => {
  const old = surface();
  old.scroller.querySelectorAll = () => [{ innerText: "已到最早消息", closest: () => null }];
  assert.equal((await scroll.scrollToOldest({ surface: old, sleep: async () => {} })).state,
    "oldest-sentinel");

  const changed = surface();
  await assert.rejects(scroll.scrollToOldest({ surface: changed, verify: () => {
    throw new Error("聊天对象已切换");
  } }), /聊天对象已切换/);
  assert.equal(changed.scroller.scrollTop, 0);

  const cancelled = surface();
  const ac = new AbortController();
  const result = await scroll.scrollToOldest({ surface: cancelled, signal: ac.signal,
    sleep: async () => ac.abort() });
  assert.equal(result.state, "cancelled");
});
