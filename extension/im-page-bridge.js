/* Runs in Douyin's MAIN world: same authenticated page origin, no Chrome APIs.
 * Watches only the request envelope needed to discover a selected conversation's
 * short ID. Never observes cookies, tokens, headers, or response bodies.
 */
(() => {
  "use strict";
  const KEY = "__DOUYIN_IM_BRIDGE_V040__";
  if (window[KEY]) return;
  const core = window.__DOUYIN_IM_CORE_V040__;
  if (!core || location.hostname !== "www.douyin.com" || location.protocol !== "https:") return;

  const MESSAGE = "DOUYIN_IM_EXPORT_V040";
  const IM_ENDPOINT = "https://imapi.douyin.com/v1/message/get_by_conversation";
  const VOICE_ENDPOINT = "https://www.douyin.com/aweme/v1/web/im/message/audio/recognition/";
  const shortIds = new Map();
  let session = null;
  let closed = false;
  let cachedUuid = "";
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  function selectedConversation() {
    const value = window.conversationStore?.curConversationId;
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
  function selectedUserId() {
    const user = window.userInfoStore?.curLoginUserInfo || {};
    return String(user.user_id || user.userId || user.uid || "");
  }
  function selfUuid() {
    if (cachedUuid) return cachedUuid;
    const user = window.userInfoStore?.curLoginUserInfo || {};
    const candidates = [window.__IM_MAIN_OPTIONS__, window.mainOptions,
      window.imMainOptions, window.userInfoStore?.mainOptions, user];
    for (const value of candidates) {
      const id = value?.deviceId || value?.uuid;
      if (id && typeof id !== "object") return (cachedUuid = String(id));
    }
    // React context can hold the SDK device UUID without publishing it as a
    // window property. This inspection stays inside the Douyin page, and only
    // the boolean "UUID available" is displayed in the exporter UI.
    for (const node of [...document.querySelectorAll("*")].slice(0, 1600)) {
      for (const key of Object.keys(node).filter(key => key.startsWith("__reactFiber$"))) {
        let fiber = node[key];
        for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
          const props = fiber.memoizedProps || fiber.pendingProps || {};
          const options = props.mainOptions || props.value?.mainOptions || props.options;
          const id = options?.deviceId || options?.uuid;
          if (id && typeof id !== "object") return (cachedUuid = String(id));
        }
      }
    }
    return "";
  }
  function state() {
    const convId = selectedConversation();
    return { convId, shortId: shortIds.get(convId) || null, shortIdReady: Boolean(shortIds.get(convId)),
      selfUid: selectedUserId(), selfUidReady: Boolean(selectedUserId()), uuidReady: Boolean(cachedUuid) };
  }
  function send(direction, id, payload) {
    if (!session || closed) return;
    window.postMessage({ marker: MESSAGE, direction, session, id, payload }, location.origin);
  }
  function noteRequest(data) {
    try {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) :
        ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes || bytes.length > 32768) return;
      const found = core.inspectHistoryRequest(bytes);
      if (!found) return;
      shortIds.set(found.convId, found.shortId);
      if (found.convId === selectedConversation()) send("event", null, state());
    } catch { /* ignore unrelated malformed requests */ }
  }
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__douyinImObserve = String(method).toUpperCase() === "POST" &&
      String(url).includes("/v1/message/get_by_conversation");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__douyinImObserve) noteRequest(body);
    return originalSend.call(this, body);
  };

  async function fetchHistory(args) {
    const convId = selectedConversation();
    if (!convId || convId !== args?.convId || shortIds.get(convId) !== args.shortId) {
      throw new Error("selected conversation changed or short ID not captured");
    }
    if (!/^\d{1,20}$/.test(String(args.timestamp))) throw new Error("invalid timestamp");
    const request = core.buildHistoryRequest(convId, args.shortId, args.timestamp);
    const bytes = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", IM_ENDPOINT);
      xhr.withCredentials = true;
      xhr.timeout = 30000;
      xhr.responseType = "arraybuffer";
      xhr.setRequestHeader("Content-Type", "application/x-protobuf");
      xhr.setRequestHeader("Accept", "application/x-protobuf");
      xhr.onload = () => xhr.status === 200 && xhr.response
        ? resolve(new Uint8Array(xhr.response)) : reject(new Error(`IM HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error("IM network request failed"));
      xhr.ontimeout = () => reject(new Error("IM request timed out"));
      xhr.send(request);
    });
    const result = core.decodeHistoryResponse(bytes);
    if (result.messages.length > 60) throw new Error("unexpected IM page size");
    if (result.messages.some(msg => msg.convId && msg.convId !== convId)) {
      throw new Error("server mixed conversation IDs");
    }
    return result;
  }
  async function transcribe(args) {
    const convId = selectedConversation();
    if (!convId || convId !== args?.convId || shortIds.get(convId) !== args.shortId) {
      throw new Error("conversation changed before transcription");
    }
    const items = args.requests;
    if (!Array.isArray(items) || !items.length || items.length > 10 ||
      items.some(item => !item || item.message_type !== 7 ||
        item.conv_short_id !== args.shortId || !item.message_id || !item.uri || !item.sec_uid || !item.uuid)) {
      throw new Error("invalid native voice request");
    }
    const response = await fetch(VOICE_ENDPOINT, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ req_list: items })
    });
    if (!response.ok) throw new Error(`voice HTTP ${response.status}`);
    return await response.json();
  }
  async function handle(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.marker !== MESSAGE || data.direction !== "request" ||
      typeof data.session !== "string" || data.session.length < 16) return;
    if (data.command === "INIT" && !session) session = data.session;
    if (data.session !== session || closed) return;
    try {
      let result;
      if (data.command === "INIT" || data.command === "STATUS") result = state();
      else if (data.command === "FETCH_HISTORY") result = await fetchHistory(data.payload);
      else if (data.command === "TRANSCRIBE") result = await transcribe(data.payload);
      else if (data.command === "UUID") result = { value: selfUuid() };
      else if (data.command === "CLOSE") result = { closed: true };
      else throw new Error("unknown command");
      send("reply", data.id, { ok: true, result });
      if (data.command === "CLOSE") shutdown();
    } catch (error) {
      send("reply", data.id, { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    }
  }
  function shutdown() {
    if (closed) return;
    closed = true;
    if (XMLHttpRequest.prototype.open === wrappedOpen) XMLHttpRequest.prototype.open = originalOpen;
    if (XMLHttpRequest.prototype.send === wrappedSend) XMLHttpRequest.prototype.send = originalSend;
    window.removeEventListener("message", handle);
    delete window[KEY];
  }
  const wrappedOpen = XMLHttpRequest.prototype.open;
  const wrappedSend = XMLHttpRequest.prototype.send;
  window.addEventListener("message", handle);
  window[KEY] = { close: shutdown };
})();
