import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("API 页面桥只处理当前会话，监听原生请求获取 short ID，不读取 Cookie", async () => {
  const listeners = new Map();
  const responses = [];
  const sdk = { curConversationId: "0:1:101:102" };
  let imResponse;
  const page = {
    location: { hostname: "www.douyin.com", protocol: "https:", origin: "https://www.douyin.com" },
    conversationStore: sdk,
    userInfoStore: { curLoginUserInfo: { user_id: "101", uuid: "synthetic-uuid" } },
    document: { querySelectorAll: () => [] },
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, BigInt,
    addEventListener(name, cb) { listeners.set(name, cb); },
    removeEventListener(name) { listeners.delete(name); },
    postMessage(payload, origin) {
      assert.equal(origin, "https://www.douyin.com");
      if (payload.direction === "reply" || payload.direction === "event") responses.push(payload);
      else listeners.get("message")?.({ source: runInNewContext("window", page), origin, data: payload });
    },
    async fetch(_url, options) {
      assert.equal(options.credentials, "include");
      return { ok: true, async json() { return { status_code: 0, data: { res_list: [
        { message_id: "501", text_result: "合成语音转写" }
      ] } }; } };
    }
  };
  class FakeXHR {
    open(_method, url) { this.url = url; }
    setRequestHeader() {}
    send() {
      if (this.url.includes("imapi.douyin.com")) {
        this.status = 200;
        this.response = imResponse.buffer.slice(imResponse.byteOffset, imResponse.byteOffset + imResponse.byteLength);
        this.onload?.();
      }
    }
  }
  page.XMLHttpRequest = FakeXHR;
  page.window = page;
  const scriptCore = await readFile(new URL("../extension/im-core.js", import.meta.url), "utf8");
  const scriptBridge = await readFile(new URL("../extension/im-page-bridge.js", import.meta.url), "utf8");
  runInNewContext(scriptCore, page);
  const im = page.__DOUYIN_IM_CORE_V040__;
  const field = im.field;
  const msg = im.concat([
    field(1, "0:1:101:102", 2), field(3, 501), field(4, "1700000000000000"),
    field(8, JSON.stringify({ aweType: 700, text: "合成内容" }), 2)
  ]);
  imResponse = field(6, field(301, im.concat([
    field(1, msg, 2), field(2, "1699999999000000"), field(3, 0)
  ]), 2), 2);
  runInNewContext(scriptBridge, page);
  assert.ok(page.__DOUYIN_IM_BRIDGE_V040__, "MAIN world bridge initialized");
  assert.ok(listeners.has("message"), "bridge listens for messages");
  const session = "synthetic_session_0123456789abcdef";
  const request = (id, command, payload = {}) => page.postMessage({
    marker: "DOUYIN_IM_EXPORT_V040", direction: "request", session, id, command, payload
  }, page.location.origin);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  request(1, "INIT");
  await flush();
  assert.equal(responses.at(-1).payload.result.shortIdReady, false);

  // Simulates the logged-in site's own IM history request after the user
  // changes conversation, not a scripted read of secrets/session storage.
  const original = new FakeXHR();
  original.open("POST", "https://imapi.douyin.com/v1/message/get_by_conversation");
  original.send(im.buildHistoryRequest("0:1:101:102", "880000000001"));
  request(2, "STATUS");
  await flush();
  assert.equal(responses.at(-1).payload.result.shortId, "880000000001");
  request(3, "FETCH_HISTORY", {
    convId: "0:1:101:102", shortId: "880000000001", timestamp: "9999999999999999"
  });
  await flush();
  const history = responses.find(item => item.id === 3)?.payload;
  assert.equal(history?.ok, true);
  assert.equal(history.result.messages[0].serverId, "501");

  sdk.curConversationId = "0:1:101:OTHER";
  request(4, "FETCH_HISTORY", {
    convId: "0:1:101:102", shortId: "880000000001", timestamp: "9999999999999999"
  });
  await flush();
  assert.equal(responses.find(item => item.id === 4)?.payload?.ok, false);

  request(5, "CLOSE");
  await flush();
  assert.equal(listeners.has("message"), false);
});
