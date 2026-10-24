/* Isolated-world UI/controller. Private messages never leave the user's
 * browser except for calls to Douyin's own IM and native voice endpoints.
 */
(() => {
  "use strict";
  const core = globalThis.__DOUYIN_EXPORT_CORE_V020__;
  const im = globalThis.__DOUYIN_IM_CORE_V040__;
  if (!core || !im) return alert("API 导出脚本未加载完整。");
  const ROOT = "douyin-im-export-v040-root";
  if (document.getElementById(ROOT)) return;
  if (document.getElementById("douyin-full-export-v020-root")) {
    return alert("请先关闭旧版滚动导出面板，再启动 API 导出。");
  }
  const KEY = "douyin_im_export_v040_checkpoint";
  const MSG = "DOUYIN_IM_EXPORT_V040";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const session = [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, "0")).join("");
  const requests = new Map();
  let requestId = 0;
  let state = {};
  let lastStatus = "";
  let cached = null;
  let archive = null;
  let running = false;
  let storageError = false;
  const messages = new Map();
  const run = {
    phase: "idle", tag: "", convId: "", shortId: "", startedAt: "",
    nextTs: "9999999999999999", hasMore: true, page: 0,
    interrupted: false, reachedEnd: false, lastError: "", initialUrl: location.href
  };

  const panel = document.createElement("div");
  panel.id = ROOT;
  panel.style.cssText = "position:fixed;z-index:2147483647;top:76px;right:18px;width:390px;max-width:calc(100vw - 24px)";
  const shadow = panel.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}section{background:#fff;color:#1f2937;border:1px solid #d1d5db;
      border-radius:12px;padding:15px;font:13px/1.55 system-ui,sans-serif;box-shadow:0 6px 30px #0003}
      h2{font-size:16px;margin:0 0 7px}p{margin:7px 0;color:#4b5563}
      input[type=text]{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px}
      label{display:block;margin:7px 0}button{border:0;border-radius:7px;padding:8px 10px;
      cursor:pointer;background:#1663d2;color:#fff;font-size:12px;margin:4px 4px 0 0}
      button.subtle{background:#64748b}button:disabled{opacity:.5;cursor:not-allowed}
      #progress{background:#eef2f6;padding:10px;border-radius:7px;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace}
      #state{color:#334155}small{display:block;color:#64748b;margin-top:8px}
    </style>
    <section>
      <h2>抖音聊天 · v0.4.1 API 导出</h2>
      <p id="state">准备连接当前抖音聊天……</p>
      <p><b>步骤一：</b>若提示会话标识待捕获，请点击另一位联系人，再点回目标聊天；不要在开始导出后切换。</p>
      <label>会话标签（本机存储）<input type="text" id="tag" maxlength="80" placeholder="为目标聊天自定义一个标签"></label>
      <label><input id="voice" type="checkbox" checked> 自动调用抖音原生语音识别接口</label>
      <button id="start">开始 API 历史导出</button>
      <button id="resume" class="subtle" hidden>恢复同一会话断点</button>
      <button id="pause" class="subtle" disabled>暂停</button>
      <button id="continue" class="subtle" disabled>继续</button>
      <button id="stop" class="subtle" disabled>停止并生成部分导出</button>
      <button id="retryVoice" class="subtle" hidden>补录未成功的语音</button>
      <button id="txt" hidden>简洁 TXT</button><button id="html" hidden>阅读 HTML</button>
      <button id="json" hidden>完整 JSON</button>
      <button id="clear" class="subtle">删除本机 API 断点</button>
      <button id="close" class="subtle">关闭面板</button>
      <p id="progress">正在读取当前会话状态……</p>
      <small>API 引擎仍需 Edge 登录态实测。仅处理当前选中的会话；不导出 Cookie/Token，不发送到开发者服务器。语音识别会调用抖音自有服务器；私人 JSON 请勿上传公开 GitHub。</small>
    </section>`;
  document.body.appendChild(panel);
  const $ = id => shadow.getElementById(id);
  const show = msg => { $("state").textContent = msg; };

  function onMessage(event) {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.marker !== MSG || data.session !== session) return;
    if (data.direction === "event") {
      state = data.payload || {};
      if (run.phase === "idle") show(state.shortIdReady
        ? "已捕获当前会话 IM 标识，可以开始。"
        : "等待当前会话发出 IM 请求。请先切换其他聊天，再切回要导出的对象。");
    }
    if (data.direction === "reply") {
      const pending = requests.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      requests.delete(data.id);
      if (data.payload?.ok) pending.resolve(data.payload.result);
      else pending.reject(new Error(data.payload?.error || "API request failed"));
    }
  }
  window.addEventListener("message", onMessage);

  function rpc(command, payload = {}, timeout = 35000) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error(`${command} 等待响应超时`));
      }, timeout);
      requests.set(id, { resolve, reject, timer });
      window.postMessage({ marker: MSG, direction: "request", session, id, command, payload }, location.origin);
    });
  }

  function progress() {
    const all = [...messages.values()];
    const voices = all.filter(item => item.type === "voice");
    const done = voices.filter(item => item.voiceTranscript?.status === "success").length;
    $("progress").textContent = [
      `阶段：${run.phase}  |  API 页数：${run.page}`,
      `服务端消息：${all.length}  |  唯一消息 ID：${messages.size}`,
      `识别语音：${voices.length}  |  已转写：${done}  |  其他状态：${voices.length - done}`,
      `最早边界：${run.reachedEnd ? "服务端返回无更多" : "未验证"}`,
      `断点状态：${storageError ? "存储失败，请立即导出" : "本地"}`,
      ...(run.lastError ? [`最近错误：${run.lastError}`] : [])
    ].join("\n");
  }
  function controls() {
    const active = run.phase === "running";
    const paused = run.phase === "paused";
    $("start").disabled = active || paused;
    $("pause").disabled = !active;
    $("continue").disabled = !paused;
    $("stop").disabled = !active && !paused;
    $("tag").disabled = active || paused;
  }
  function checkpoint() {
    return {
      version: "0.4.0-rc.1", tag: run.tag, convId: run.convId, shortId: run.shortId,
      startedAt: run.startedAt, nextTs: run.nextTs, hasMore: run.hasMore,
      page: run.page, records: [...messages.values()], savedAt: new Date().toISOString()
    };
  }
  async function persist() {
    try { await chrome.storage.local.set({ [KEY]: checkpoint() }); }
    catch { storageError = true; run.phase = "paused"; show("本机断点保存失败，请停止并下载现有内容。"); }
  }
  async function captureVoice(current) {
    if (!$("voice").checked) return;
    const entries = current.filter(item => item.type === "voice");
    if (!entries.length) return;
    let uuid = "";
    try { uuid = (await rpc("UUID", {}, 10000)).value || ""; } catch { /* missing UUID */ }
    const inputs = [];
    for (const entry of entries) {
      const request = im.voiceRequest(null, entry, run.shortId, uuid);
      if (request) inputs.push({ entry, request });
      else entry.voiceTranscript = { status: "unavailable", source: "douyin-native-api",
        reason: "缺少平台语音标识、发送者身份或登录 UUID" };
    }
    for (let offset = 0; offset < inputs.length && run.phase === "running"; offset += 10) {
      const slice = inputs.slice(offset, offset + 10);
      try {
        const response = await rpc("TRANSCRIBE", {
          convId: run.convId, shortId: run.shortId, requests: slice.map(x => x.request)
        }, 45000);
        const matched = im.matchTranscriptions(response, slice.map(x => x.request));
        for (const result of matched) {
          const item = slice.find(x => x.request.message_id === result.messageId);
          if (item) item.entry.voiceTranscript = { source: "douyin-native-api",
            status: result.status, text: result.text, requiresReview: !result.text };
        }
      } catch (error) {
        for (const item of slice) item.entry.voiceTranscript = {
          source: "douyin-native-api", status: "failed", reason: String(error?.message || "转写接口调用失败").slice(0,150)
        };
      }
    }
  }

  function makeArchive() {
    // Server timestamps and sequence, not network pagination order, determine
    // the chronology. The legacy render engine expects descending dataIndex.
    const chronological = [...messages.values()].sort((a, b) => {
      const ta = BigInt(a.serverCreatedAtUs || "0");
      const tb = BigInt(b.serverCreatedAtUs || "0");
      if (ta !== tb) return ta < tb ? -1 : 1;
      const sa = BigInt(a.serverSequence || "0");
      const sb = BigInt(b.serverSequence || "0");
      return sa < sb ? -1 : sa > sb ? 1 : String(a.platformMessageId).localeCompare(String(b.platformMessageId));
    });
    const entries = chronological.map((item, index) => ({ ...item, dataIndex: chronological.length - index - 1 }));
    const content = core.buildArchive({
      entries, conversationTag: run.tag, createdAt: run.startedAt,
      stoppedAt: new Date().toISOString(),
      runtime: {
        startedFromNewest: true, oldestBoundaryEvidence: run.reachedEnd ? "server-no-more" : "unverified",
        conversationGuardVerified: Boolean(run.convId && run.shortId),
        interrupted: run.interrupted, storageFailure: storageError, failures: []
      }
    });
    content.schemaVersion = "0.4.0-rc.1";
    content.exportOrder = "oldest-first-by-api-pages";
    content.capture.method = "douyin-im-protobuf";
    content.conversation.platformIdVerified = Boolean(run.convId);
    content.limitations = [
      "非公开抖音 IM 接口可能随网站更新；消息完整性只针对本次返回的可访问历史。",
      "未能安全取得的语音平台参数保留 unavailable，不伪造转写结果。",
      "本工具只处理当前用户主动选择的单个会话。"
    ];
    return content;
  }
  function finish() {
    run.phase = "completed";
    archive = makeArchive();
    for (const id of ["txt", "html", "json"]) $(id).hidden = false;
    $("resume").hidden = true;
    $("retryVoice").hidden = false;
    controls();
    progress();
    show(run.lastError
      ? `API 中断：${run.lastError}。已安全保留 ${archive.entries.length} 项，下载 JSON 查看 partial/incomplete。`
      : `本次已采集 ${archive.entries.length} 项；历史状态 ${archive.capture.state}；语音转写状态 ${archive.voiceTranscription.state}。`);
  }
  async function collect() {
    if (running) return;
    running = true;
    const PAGE_LIMIT = 6000;
    try {
      while (run.phase === "running" && run.page < PAGE_LIMIT && run.hasMore) {
        const current = await rpc("STATUS", {}, 12000);
        if (current.convId !== run.convId || current.shortId !== run.shortId) {
          throw new Error("当前聊天会话已切换，为避免混合记录已停止");
        }
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await rpc("FETCH_HISTORY", {
              convId: run.convId, shortId: run.shortId, timestamp: run.nextTs
            }, 45000);
            break;
          } catch (error) {
            if (attempt === 2) throw error;
            await wait(700 * (attempt + 1));
          }
        }
        if (!Array.isArray(result?.messages) || !result.messages.length) {
          if (result?.hasMore) throw new Error("服务端返回空批次但仍声称存在历史");
          run.hasMore = false;
          run.reachedEnd = true;
          break;
        }
        const added = [];
        for (const item of result.messages) {
          if (!item.serverId || !item.createdAtUs || (item.convId && item.convId !== run.convId)) {
            throw new Error("返回消息缺少稳定 ID/时间或混入了其他会话");
          }
          if (messages.has(item.serverId)) continue;
          const row = im.normalizeMessage(item, messages.size, current.selfUid || "");
          messages.set(item.serverId, row);
          added.push(row);
        }
        run.page++;
        if (result.hasMore && (!result.nextTs || result.nextTs === run.nextTs)) {
          throw new Error("IM 分页时间戳未前进，停止避免重复循环");
        }
        run.nextTs = result.nextTs || run.nextTs;
        run.hasMore = Boolean(result.hasMore);
        await captureVoice(added);
        await persist();
        progress();
        if (!run.hasMore) { run.reachedEnd = true; break; }
        if (!added.length) await wait(600);
        else await wait(280);
      }
      if (run.page >= PAGE_LIMIT && run.hasMore) throw new Error("达到分页上限，已安全停止");
    } catch (error) {
      run.interrupted = true;
      run.lastError = String(error?.message || "未知错误").slice(0,200);
      show(`API 采集未完成：${run.lastError}`);
    } finally {
      running = false;
      if (run.phase === "running" || run.phase === "stopping") finish();
      controls();
    }
  }

  async function start(resume = false) {
    if (run.phase === "running" || run.phase === "paused") return;
    const tag = $("tag").value.trim();
    if (!tag) return show("先填写一个本地会话标签。");
    try { state = await rpc("STATUS"); } catch { return show("无法连接抖音 IM 页内引擎，请刷新网页重新启动。"); }
    if (!state.convId || !state.shortId) return show("尚未取得此聊天的 IM 标识；请先切换联系人再切回来。");
    if (resume) {
      if (!cached || cached.version !== "0.4.0-rc.1" || tag !== cached.tag ||
          state.convId !== cached.convId || state.shortId !== cached.shortId) {
        return show("断点与当前登录会话或标签不一致，拒绝混合记录。");
      }
      if (!confirm("确认这是原来导出的同一个聊天对象，继续加载本机断点？")) return;
      messages.clear();
      for (const item of cached.records || []) if (item.platformMessageId) messages.set(item.platformMessageId, item);
      Object.assign(run, { tag, convId: cached.convId, shortId: cached.shortId,
        nextTs: cached.nextTs, hasMore: cached.hasMore, page: cached.page,
        startedAt: cached.startedAt, interrupted: false, reachedEnd: false, lastError: "" });
    } else {
      if (cached?.records?.length && !confirm("存在旧 API 断点，确定开启新采集并覆盖它？")) return;
      messages.clear();
      Object.assign(run, { tag, convId: state.convId, shortId: state.shortId,
        nextTs: "9999999999999999", hasMore: true, page: 0,
        startedAt: new Date().toISOString(), interrupted: false, reachedEnd: false, lastError: "" });
    }
    storageError = false;
    archive = null;
    for (const id of ["txt", "html", "json"]) $(id).hidden = true;
    $("retryVoice").hidden = true;
    run.phase = "running";
    controls();
    show("正在读取抖音 IM 历史消息，可随时暂停或停止，历史数据仅存本机。");
    void collect();
  }

  function download(body, ext, mime) {
    const name = run.tag.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 40) || "chat";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `douyin-api-${name}-${stamp}.${ext}`;
    document.body.appendChild(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("start").addEventListener("click", () => void start());
  $("resume").addEventListener("click", () => void start(true));
  $("pause").addEventListener("click", () => {
    if (run.phase === "running") { run.phase = "paused"; controls(); show("暂停中。当前正在处理的一页会结束后停下。"); }
  });
  $("continue").addEventListener("click", () => {
    if (run.phase === "paused") { run.phase = "running"; controls(); void collect(); }
  });
  $("stop").addEventListener("click", () => {
    if (["running", "paused"].includes(run.phase)) {
      run.phase = "stopping";
      if (!running) finish();
      controls();
    }
  });
  $("retryVoice").addEventListener("click", async () => {
    if (run.phase !== "completed") return;
    const waiting = [...messages.values()].filter(item => item.type === "voice" &&
      item.voiceTranscript?.status !== "success");
    if (!waiting.length) return show("已识别的语音没有需要补录的项目。");
    if (!$("voice").checked) return show("请先勾选原生语音识别功能，再补录。");
    try {
      const active = await rpc("STATUS", {}, 10000);
      if (active.convId !== run.convId || active.shortId !== run.shortId) {
        return show("无法确认原会话身份；请切回正确对象并重新捕获 short ID 后再补录。");
      }
      run.phase = "running";
      $("retryVoice").disabled = true;
      await captureVoice(waiting);
      await persist();
      run.phase = "completed";
      archive = makeArchive();
      progress();
      show(`已重新尝试 ${waiting.length} 条语音，成功数 ${archive.voiceTranscription.success} / ${archive.voiceTranscription.total}。请重新下载结果。`);
    } catch (error) {
      run.phase = "completed";
      show(`补录失败：${String(error?.message || "未知错误").slice(0,160)}`);
    } finally {
      $("retryVoice").disabled = false;
      controls();
    }
  });
  $("txt").addEventListener("click", () => archive && download(core.renderReadableTxt(archive), "txt", "text/plain;charset=utf-8"));
  $("html").addEventListener("click", () => archive && download(core.renderReadableHtml(archive), "html", "text/html;charset=utf-8"));
  $("json").addEventListener("click", () => archive && download(JSON.stringify(archive, null, 2), "json", "application/json;charset=utf-8"));
  $("clear").addEventListener("click", async () => {
    if (["running", "paused"].includes(run.phase)) return show("先停止正在进行的采集。");
    if (!confirm("删除此插件在本机保存的 API 采集断点？")) return;
    await chrome.storage.local.remove(KEY);
    cached = null;
    $("resume").hidden = true;
    show("本机 API 断点已删除。");
  });
  $("close").addEventListener("click", () => {
    if (["running", "paused"].includes(run.phase)) return show("请先停止并下载现有结果，再关闭面板。");
    void rpc("CLOSE", {}, 2000).catch(() => {});
    window.removeEventListener("message", onMessage);
    panel.remove();
  });
  const poll = setInterval(async () => {
    if (!panel.isConnected) { clearInterval(poll); return; }
    if (run.phase === "running" || run.phase === "stopping") return;
    try {
      const next = await rpc("STATUS", {}, 8000);
      state = next;
      const key = `${next.convId}/${next.shortId || "?"}`;
      if (run.phase === "idle" && key !== lastStatus) {
        lastStatus = key;
        show(next.shortIdReady ? "当前会话 IM 标识已就绪，可以开始。" :
          "尚未看到当前会话的 IM 请求。请切换到其他聊天，再切回目标聊天以触发加载。");
      }
    } catch { /* next poll retries */ }
  }, 1300);
  void rpc("INIT", {}, 8000).then(result => {
    state = result;
    show(state.shortIdReady ? "当前会话 IM 标识已就绪，可以开始。" :
      "等待当前会话的 IM 请求；请切换其他联系人，再切回目标联系人。");
  }).catch(() => show("初始化失败：请刷新抖音聊天网页后重试。"));
  void chrome.storage.local.get(KEY).then(data => {
    cached = data[KEY] || null;
    if (cached?.records?.length) {
      $("resume").hidden = false;
      $("tag").value = cached.tag || "";
    }
  }).catch(() => {});
  progress(); controls();
})();
