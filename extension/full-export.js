(() => {
  "use strict";

  const core = globalThis.__DOUYIN_EXPORT_CORE_V020__;
  if (!core) return window.alert("导出核心未加载，请重新启动插件。");
  const ROOT_ID = "douyin-full-export-v020-root";
  if (document.getElementById(ROOT_ID)) return;
  if (document.getElementById("douyin-exporter-index-monitor-root") ||
      document.getElementById("douyin-exporter-local-capture-root")) {
    return window.alert("请先关闭旧版索引/文字测试面板，再启动完整功能候选版。");
  }
  const STORE_KEY = "douyin_chat_export_v020_checkpoint";
  const enhancedVariant = chrome.runtime?.getManifest?.()?.permissions?.includes("debugger") === true;
  const STABLE_MS = 180;
  const STEP_DELAY_MS = 450;
  const MAX_STEPS = 20000;

  const editable = document.querySelector('[contenteditable="true"]');
  const editorBox = editable?.getBoundingClientRect();
  const centerX = editorBox ? (editorBox.left + editorBox.right) / 2 : null;
  const scroller = [...document.querySelectorAll("*")].find(element => {
    if (centerX === null) return false;
    const css = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (css.overflowY === "auto" || css.overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 10 &&
      rect.left < centerX && rect.right > centerX && rect.top < editorBox.top && rect.height > 200;
  });
  const list = scroller?.firstElementChild;
  if (!list || ![...list.children].some(element => element.hasAttribute("data-index"))) {
    window.alert("未找到抖音聊天列表。请先打开一个私信对象的聊天窗口。");
    return;
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.cssText = "position:fixed;top:76px;right:18px;z-index:2147483647;width:385px;max-width:calc(100vw - 36px)";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}section{background:#fff;color:#1e293b;border:1px solid #cbd5e1;
        border-radius:12px;padding:15px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 35px #0003}
      h2{font-size:16px;margin:0 0 7px}p{margin:7px 0;color:#475569}
      input[type=text]{display:block;width:100%;padding:8px;border:1px solid #bac6d6;border-radius:7px;margin:7px 0}
      label{display:block;margin:8px 0;color:#475569}
      button{border:0;border-radius:7px;padding:8px 10px;cursor:pointer;background:#1967dc;color:#fff;
        margin:5px 5px 0 0;font-size:12px}button.secondary{background:#64748b}
      button.danger{background:#9a3412}button:disabled{opacity:.42;cursor:default}
      #progress{background:#f1f5f9;border-radius:7px;padding:8px;white-space:pre-wrap;
        font:12px/1.5 ui-monospace,monospace;max-height:240px;overflow:auto}
      #warning{background:#fff5e6;padding:9px;border-radius:8px;color:#854d0e}
      small{display:block;margin-top:9px;color:#64748b}
    </style>
    <section>
      <h2>兼容模式 · 网页滚动导出</h2>
      <p id="state">确认当前打开的是你要导出的一个私信会话。</p>
      <label for="tag">本地会话标签（用于防止续采混淆）</label>
      <input type="text" id="tag" maxlength="80" placeholder="例如：聊天对象A（仅保存在浏览器）">
      <label><input id="voice" type="checkbox" checked> 尝试使用抖音原生「转成文字」（失败则保留待处理状态）</label>
      <label hidden><input id="trustedVoice" type="checkbox"> 旧版增强语音右键（已停用）</label>
      <button id="start">从最近消息开始自动采集</button>
      <button id="restore" class="secondary" hidden>恢复本地断点</button>
      <button id="pause" class="secondary" disabled>暂停</button>
      <button id="continue" class="secondary" disabled>继续</button>
      <button id="stop" class="secondary" disabled>停止并准备导出</button>
      <button id="rescan" class="secondary" disabled>重扫当前屏幕</button>
      <button id="txt" hidden>下载简洁 TXT</button>
      <button id="html" hidden>下载阅读版 HTML</button>
      <button id="json" hidden>下载完整 JSON</button>
      <button id="rawtxt" class="secondary" hidden>下载技术明细 TXT</button>
      <button id="clear" class="danger">删除本机断点</button>
      <button id="close" class="secondary">关闭面板</button>
      <p id="progress">等待开始……</p>
      <p id="warning">本工具只处理当前网页。文件和断点包含私人聊天，均留在本机。当前不能保证自动识别所有消息类型、语音或最早边界；遇到不确定情况明确报告。</p>
      <small>这是已验证正文采集的旧版回退入口，仅使用网页 DOM 滚动；建议优先测试 v0.4 API 引擎。不要切换聊天对象。本模式不会自动获得调试器权限，原生语音可手工转换后重扫。</small>
    </section>`;
  document.body.appendChild(host);
  const $ = id => shadow.getElementById(id);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const records = new Map();
  const candidates = new Map();
  const voiceAttempted = new Set();
  const failed = new Set();
  const run = {
    phase: "idle", tag: "", startedAt: "", startedUrl: location.href,
    startedFromNewest: false, oldestBoundaryEvidence: "unverified",
    conversationGuardVerified: false, interrupted: false, storageFailure: false,
    step: 0, lastSave: 0, nativeMenuSupport: "unknown"
  };
  let prepared = null;
  let scrollLoopRunning = false;
  let persistenceActive = false;
  let observer = null;
  let checkpointLoaded = null;

  function setState(message) { $("state").textContent = message; }
  function isSameChatSurface() {
    return list.isConnected && scroller.isConnected && location.href === run.startedUrl &&
      scroller.firstElementChild === list;
  }

  function timeInRow(element) {
    const nodes = [element, ...element.querySelectorAll("time[datetime],[data-timestamp],[data-time]")].slice(0, 14);
    for (const node of nodes) {
      for (const attr of ["datetime", "data-timestamp", "data-time"]) {
        const value = node.getAttribute?.(attr);
        const parsed = core.parseTime(value);
        if (parsed) return { createdAt: parsed, timeEvidence: attr };
      }
    }
    return { createdAt: null, timeEvidence: "unverified" };
  }

  function senderFromLayout(element) {
    const candidates = [...element.querySelectorAll("p,span,[role=text]")]
      .filter(node => (node.innerText || "").trim().length >= 2).slice(0, 20);
    const bubble = candidates.find(node => {
      const r = node.getBoundingClientRect();
      return r.width > 14 && r.height > 5;
    });
    if (!bubble) return { sender: "unknown", senderConfidence: "none" };
    const r = bubble.getBoundingClientRect();
    const mid = (scroller.getBoundingClientRect().left + scroller.getBoundingClientRect().right) / 2;
    if (r.left > mid + 60) return { sender: "self", senderConfidence: "layout-heuristic" };
    if (r.right < mid - 60) return { sender: "peer", senderConfidence: "layout-heuristic" };
    return { sender: "unknown", senderConfidence: "none" };
  }

  function rowMedia(element) {
    const images = [...element.querySelectorAll("img")];
    const largeImages = images.filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.width >= 70 && rect.height >= 70;
    }).length;
    return {
      image: images.length, largeImages,
      video: element.querySelectorAll("video").length,
      audio: element.querySelectorAll("audio").length,
      canvas: element.querySelectorAll("canvas").length
    };
  }

  function voiceTargetInRow(element) {
    const nodes = [element, ...element.querySelectorAll("[aria-label],[title],[data-type],audio,button")].slice(0, 70);
    const pattern = /(?:语音消息|播放语音|语音播放|voice\s*message|play\s*audio|audio\s*message)/i;
    const explicit = nodes.find(node => node.tagName === "AUDIO" ||
      [node.getAttribute?.("aria-label"), node.getAttribute?.("title"), node.getAttribute?.("data-type")]
        .some(value => typeof value === "string" && pattern.test(value)));
    if (explicit) return explicit;
    // Verified local TXT sample: Douyin voice bubbles render 28", 6", 1".
    // They also had a canvas, but generic messages often have canvas too.
    const canvas = element.querySelector("canvas");
    const firstLine = (element.innerText || "").trim().split("\n")[0].trim();
    const duration = /^\d{1,3}\s*["″”]$/;
    if (!canvas || !duration.test(firstLine)) return null;
    const label = [...element.querySelectorAll("span,p,button,div")].find(node =>
      duration.test((node.innerText || "").trim()));
    return label?.closest?.('[role="button"]') || label?.parentElement || canvas.parentElement || canvas;
  }

  function candidateMessageId(element, dataIndex) {
    const node = element.matches("[data-message-id],[data-msg-id],[data-messageid]") ? element
      : element.querySelector("[data-message-id],[data-msg-id],[data-messageid]");
    if (!node) return null;
    const value = node.getAttribute("data-message-id") || node.getAttribute("data-msg-id") || node.getAttribute("data-messageid");
    if (!value || value === String(dataIndex) || !/^[\w-]{8,96}$/.test(value)) return null;
    return value;
  }

  function snapshot(element) {
    if (!element?.isConnected || element.parentElement !== list || !element.hasAttribute("data-index")) return null;
    const rawIndex = element.getAttribute("data-index");
    if (!/^-?\d+$/.test(rawIndex || "")) return null;
    const dataIndex = Number(rawIndex);
    if (!Number.isSafeInteger(dataIndex)) return null;
    const text = (element.innerText || "").replace(/\r\n/g, "\n").trim();
    const media = rowMedia(element);
    const voiceTarget = voiceTargetInRow(element);
    const timeLabel = /^\d{4}[/-]\d\d[/-]\d\d(?:\s+\d\d:\d\d)?$/.test(text);
    const type = core.typeFromSignals({
      visibleText: text, voiceHint: Boolean(voiceTarget), image: media.image,
      largeImages: media.largeImages, video: media.video, canvas: media.canvas, timeLabel
    });
    const now = new Date().toISOString();
    const platformMessageId = candidateMessageId(element, dataIndex);
    return {
      dataIndex, platformMessageId, messageIdConfidence: platformMessageId ? "candidate" : "unavailable",
      recordKind: "virtual-list-item", visibleText: text, type,
      ...senderFromLayout(element), ...timeInRow(element),
      mediaMarkers: media,
      voiceDurationSeconds: type === "voice"
        ? Number(text.match(/^\s*(\d{1,3})\s*["″”]/)?.[1] ?? 0) || null : null,
      captureConfidence: "provisional", capturedAt: now, lastUpdatedAt: now,
      ...(type === "voice" ? { voiceTranscript: { status: "pending", source: "douyin-native" } } : {})
    };
  }

  function recordElement(element) {
    const next = snapshot(element);
    if (!next) return;
    const { dataIndex } = next;
    const now = Date.now();
    const previous = records.get(dataIndex);
    const oldVoice = previous?.voiceTranscript;
    const baseline = oldVoice?.baselineText || (oldVoice?.status === "pending" ? previous?.visibleText : null);
    if (["manual_required", "pending"].includes(oldVoice?.status) && baseline &&
        next.visibleText !== baseline && next.visibleText.startsWith(baseline)) {
      const added = next.visibleText.slice(baseline.length).trim();
      if (added.length >= 2) {
        previous.voiceTranscript = {
          source: "douyin-native", status: "success", text: added,
          confidence: "late-dom-appended-text", requiresReview: true
        };
      }
    }
    const currentCandidate = candidates.get(dataIndex);
    const signature = `${next.visibleText}\u0000${next.type}\u0000${JSON.stringify(next.mediaMarkers)}`;
    if (!currentCandidate || currentCandidate.signature !== signature) {
      candidates.set(dataIndex, { signature, since: now });
      if (!previous || previous.captureConfidence !== "stable") {
        records.set(dataIndex, { ...next, capturedAt: previous?.capturedAt ?? next.capturedAt,
          voiceTranscript: previous?.voiceTranscript ?? next.voiceTranscript });
      }
      return;
    }
    if (now - currentCandidate.since >= STABLE_MS) {
      records.set(dataIndex, {
        ...next, captureConfidence: "stable",
        capturedAt: previous?.capturedAt ?? next.capturedAt,
        voiceTranscript: previous?.voiceTranscript ?? next.voiceTranscript
      });
    }
  }

  function captureVisible() {
    if (run.phase === "idle") return;
    if (!list.isConnected) return;
    for (const node of list.children) {
      try { recordElement(node); } catch {
        const n = Number(node.getAttribute?.("data-index"));
        if (Number.isSafeInteger(n)) failed.add(n);
      }
    }
    renderProgress();
  }

  function captureMutation(target) {
    let row = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    while (row && row !== list && row.parentElement !== list) row = row.parentElement;
    if (row?.parentElement === list) recordElement(row);
  }

  observer = new MutationObserver(events => {
    if (run.phase === "idle") return;
    for (const event of events) {
      try { captureMutation(event.target); } catch { /* scan poll will retry */ }
      for (const added of event.addedNodes) {
        try { captureMutation(added); } catch { /* scan poll will retry */ }
      }
    }
  });
  observer.observe(list, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["data-index", "class"] });
  const ticker = setInterval(captureVisible, 150);
  captureVisible();

  function renderProgress() {
    const entries = [...records.values()];
    const span = core.coverage(entries.map(item => item.dataIndex));
    const stable = entries.filter(entry => entry.captureConfidence === "stable").length;
    const voices = entries.filter(entry => entry.type === "voice").length;
    const voiceSuccess = entries.filter(entry => entry.type === "voice" && entry.voiceTranscript?.status === "success").length;
    const voiceManual = entries.filter(entry => entry.type === "voice" && entry.voiceTranscript?.status === "manual_required").length;
    $("progress").textContent = [
      `阶段：${run.phase}    自动滚动步数：${run.step}`,
      `列表项：${entries.length}（稳定 ${stable}）`,
      `索引范围：${span.minIndex ?? "?"}–${span.maxIndex ?? "?"}，缺口 ${span.gapCount}`,
      `识别语音：${voices}；已转写：${voiceSuccess}；待手工：${voiceManual}；其余待确认：${voices - voiceSuccess - voiceManual}`,
      `原生语音菜单：${run.nativeMenuSupport}`,
      `已知异常：${failed.size}，本地存储：${run.storageFailure ? "失败，请下载文件" : "正常"}`,
      `历史终点：${run.oldestBoundaryEvidence}`
    ].join("\n");
  }

  function controls() {
    const active = run.phase === "running";
    const paused = run.phase === "paused";
    $("start").disabled = active || paused || run.phase === "stopping";
    $("pause").disabled = !active;
    $("continue").disabled = !paused;
    $("stop").disabled = !active && !paused;
    $("rescan").disabled = active;
    $("tag").disabled = active || paused;
  }

  function checkpoint() {
    return {
      schemaVersion: "0.3.0-rc.1", tag: run.tag, url: run.startedUrl, savedAt: new Date().toISOString(),
      startedAt: run.startedAt, startedFromNewest: run.startedFromNewest,
      oldestBoundaryEvidence: run.oldestBoundaryEvidence, step: run.step,
      scrollerTop: scroller.scrollTop, entries: [...records.values()],
      attemptedVoiceIndexes: [...voiceAttempted], failures: [...failed]
    };
  }

  async function persist(force = false) {
    if (!run.tag || persistenceActive || (!force && Date.now() - run.lastSave < 2500)) return;
    persistenceActive = true;
    try {
      const data = checkpoint();
      await chrome.storage.local.set({ [STORE_KEY]: data });
      checkpointLoaded = data;
      run.lastSave = Date.now();
    } catch (error) {
      run.storageFailure = true;
      setState("本地断点保存失败（可能超过浏览器扩展存储配额）。内存中的消息仍可下载。");
      if (run.phase === "running") run.phase = "paused";
    } finally {
      persistenceActive = false;
      controls();
    }
  }

  function visibleNativeMenuItem(origin) {
    // Douyin menus may be rendered as portal div/span elements with no ARIA role.
    // Only select an exact, visible label OUTSIDE chat rows and close to the
    // voice bubble that was just right-clicked, never arbitrary chat content.
    const commands = [...document.querySelectorAll('[role="menuitem"], button, li, div, span')];
    const found = commands.filter(node => {
      if (list.contains(node) || node.closest?.('[contenteditable="true"]')) return false;
      const value = (node.innerText || "").trim();
      if (!/^(?:转成文字|语音转文字|转文字)$/.test(value)) return false;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      const dx = Math.max(rect.left - origin.x, origin.x - rect.right, 0);
      const dy = Math.max(rect.top - origin.y, origin.y - rect.bottom, 0);
      return dx < 520 && dy < 520;
    });
    return found.sort((a, b) => {
      const aa = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return aa.width * aa.height - bb.width * bb.height;
    })[0] || null;
  }

  function appendedTranscript(before, after) {
    if (!after || after === before) return null;
    if (after.startsWith(before) && after.length > before.length) {
      const remainder = after.slice(before.length).trim();
      return remainder.length >= 2 ? remainder : null;
    }
    return null;
  }

  async function trustedClick(target, button) {
    if (!enhancedVariant || !$("trustedVoice").checked || !target) return false;
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "DOUYIN_EXPORT_TRUSTED_MOUSE", button,
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2
      });
      return result?.ok === true;
    } catch {
      return false;
    }
  }

  async function tryNativeTranscribe(row) {
    if (!$("voice").checked || !row?.isConnected) return;
    const idx = Number(row.getAttribute("data-index"));
    if (!Number.isSafeInteger(idx) || voiceAttempted.has(idx)) return;
    const target = voiceTargetInRow(row);
    if (!target) return;
    voiceAttempted.add(idx);
    const previousText = (row.innerText || "").trim();
    if (run.nativeMenuSupport === "unsupported") {
      const entry = records.get(idx);
      if (entry) entry.voiceTranscript = { source: "douyin-native", status: "manual_required",
        baselineText: previousText, reason: "页面不接受程序模拟右键；请在网页中手工转文字后重扫。" };
      return;
    }
    const rect = target.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    try {
      target.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, view: window, button: 2, buttons: 2,
        clientX: origin.x, clientY: origin.y
      }));
      await wait(200);
      if (run.phase !== "running" || !row.isConnected) return;
      let action = visibleNativeMenuItem(origin);
      if (!action && enhancedVariant && $("trustedVoice").checked) {
        const sent = await trustedClick(target, "right");
        if (sent) {
          await wait(250);
          action = visibleNativeMenuItem(origin);
        }
      }
      if (!action) {
        run.nativeMenuSupport = "unsupported";
        const entry = records.get(idx);
        if (entry) entry.voiceTranscript = { source: "douyin-native", status: "manual_required",
          baselineText: previousText,
          reason: "程序触发的右键菜单未出现；请在浏览器中手动右键语音后再重扫。" };
        return;
      }
      run.nativeMenuSupport = $("trustedVoice").checked ? "enhanced-or-synthetic" : "synthetic";
      if (!await trustedClick(action, "left")) action.click();
      let text = null;
      for (let i = 0; i < 20 && !text && run.phase === "running"; i++) {
        await wait(200);
        if (!row.isConnected || Number(row.getAttribute("data-index")) !== idx) break;
        text = appendedTranscript(previousText, (row.innerText || "").trim());
      }
      const entry = records.get(idx);
      if (entry) entry.voiceTranscript = text
        ? { source: "douyin-native", status: "success", text, confidence: "dom-appended-text" }
        : { source: "douyin-native", status: "pending", baselineText: previousText,
          reason: "菜单已点击但尚未提取到对应转写文字，后续重扫会继续查找" };
    } catch {
      const entry = records.get(idx);
      if (entry) entry.voiceTranscript = { source: "douyin-native", status: "failed", reason: "网页右键/转写操作异常" };
    }
  }

  async function transcribeVisible() {
    if (!$("voice").checked) return;
    for (const row of [...list.children]) {
      if (run.phase !== "running") break;
      const idx = Number(row.getAttribute("data-index"));
      const entry = records.get(idx);
      if (entry?.type === "voice" && !voiceAttempted.has(idx)) await tryNativeTranscribe(row);
    }
  }

  function hasExplicitOldestSentinel() {
    // Only inspect a dedicated status element OUTSIDE chat rows. Never treat a
    // user's message saying "没有更多消息" as an authoritative pagination boundary.
    const nodes = [...scroller.querySelectorAll('[role="status"], [data-testid*="end"], [data-testid*="load-more"]')];
    return nodes.some(node => !node.closest("[data-index]") &&
      /^(?:没有更多消息|没有更多聊天记录|已到最早消息|已经到底了)$/.test((node.innerText || "").trim()));
  }

  async function autoScroll() {
    if (scrollLoopRunning) return;
    scrollLoopRunning = true;
    let stagnant = 0;
    let indexStagnant = 0;
    try {
      while (run.phase === "running" && run.step < MAX_STEPS) {
        if (!isSameChatSurface()) {
          run.interrupted = true;
          setState("检测到聊天容器或网址变化，为避免混合会话已停止。");
          run.phase = "stopping";
          break;
        }
        captureVisible();
        await transcribeVisible();
        if (run.phase !== "running") break;
        if (hasExplicitOldestSentinel()) {
          run.oldestBoundaryEvidence = "explicit-ui-no-more";
          setState("检测到页面明确的最早边界提示，已停止自动滚动。");
          run.phase = "stopping";
          break;
        }
        const beforeTop = scroller.scrollTop;
        const beforeMax = core.coverage([...records.keys()]).maxIndex;
        const currentIndices = [...list.children]
          .map(row => Number(row.getAttribute?.("data-index"))).filter(Number.isSafeInteger);
        if (beforeMax > 100 && run.step > 10 && currentIndices.length &&
            Math.max(...currentIndices) < 10) {
          run.interrupted = true;
          run.phase = "stopping";
          setState("消息索引突然重置为最新区域，可能发生会话切换或列表重建，已安全停止。");
          break;
        }
        scroller.scrollTop = Math.min(scroller.scrollHeight,
          beforeTop + Math.max(220, Math.floor(scroller.clientHeight * 0.55)));
        await wait(STEP_DELAY_MS);
        captureVisible();
        run.step++;
        const afterTop = scroller.scrollTop;
        const afterMax = core.coverage([...records.keys()]).maxIndex;
        stagnant = Math.abs(afterTop - beforeTop) < 2 ? stagnant + 1 : 0;
        indexStagnant = afterMax === beforeMax ? indexStagnant + 1 : 0;
        await persist();
        if (stagnant >= 7 || indexStagnant >= 18) {
          run.oldestBoundaryEvidence = "visual-end";
          setState("网页滚动已停止推进，但未证实服务端最早边界；采集将标记 partial。");
          run.phase = "stopping";
        }
      }
      if (run.step >= MAX_STEPS) {
        run.interrupted = true;
        setState("达到安全滚动步数上限，已停止，防止无限循环。");
        run.phase = "stopping";
      }
    } catch (error) {
      run.interrupted = true;
      run.phase = "stopping";
      setState(`自动采集出错：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      scrollLoopRunning = false;
      if (run.phase === "stopping") await finalize();
      controls();
    }
  }

  function prepareArchive() {
    return core.buildArchive({
      entries: [...records.values()],
      runtime: {
        startedFromNewest: run.startedFromNewest,
        oldestBoundaryEvidence: run.oldestBoundaryEvidence,
        conversationGuardVerified: run.conversationGuardVerified,
        interrupted: run.interrupted, storageFailure: run.storageFailure,
        failures: [...failed]
      },
      conversationTag: run.tag, createdAt: run.startedAt,
      stoppedAt: new Date().toISOString()
    });
  }

  async function finalize() {
    if (run.phase === "completed") return;
    captureVisible();
    run.phase = "completed";
    await persist(true);
    prepared = prepareArchive();
    $("json").hidden = false;
    $("txt").hidden = false;
    $("html").hidden = false;
    $("rawtxt").hidden = false;
    $("start").disabled = false;
    $("restore").hidden = true;
    setState(`已停止并准备导出：${prepared.capture.state}。请下载文件并查看单独的语音转写状态。`);
    renderProgress();
  }

  async function startNew() {
    if (run.phase === "running" || run.phase === "paused") return;
    const tag = $("tag").value.trim();
    if (!tag) return setState("请先输入本地会话标签，避免不同联系人数据混淆。");
    if (checkpointLoaded?.entries?.length && !window.confirm("本机存在上次采集断点，确定放弃旧断点并开始新采集？")) return;
    records.clear();
    candidates.clear();
    voiceAttempted.clear();
    failed.clear();
    prepared = null;
    $("json").hidden = true;
    $("txt").hidden = true;
    $("html").hidden = true;
    $("rawtxt").hidden = true;
    run.tag = tag;
    run.startedAt = new Date().toISOString();
    run.startedUrl = location.href;
    run.startedFromNewest = false;
    run.conversationGuardVerified = false;
    run.oldestBoundaryEvidence = "unverified";
    run.interrupted = false;
    run.storageFailure = false;
    run.step = 0;
    run.nativeMenuSupport = "unknown";
    scroller.scrollTop = 0;
    await wait(650);
    const firstIndexes = [...list.children].map(row => Number(row.getAttribute("data-index"))).filter(Number.isSafeInteger);
    run.startedFromNewest = firstIndexes.length > 0 && Math.min(...firstIndexes) === 0;
    run.phase = "running";
    captureVisible();
    await persist(true);
    controls();
    setState("自动采集中。可随时暂停、停止或下载已采集部分。");
    void autoScroll();
  }

  async function restore() {
    const data = checkpointLoaded;
    if (!data || !data.entries?.length) return setState("没有可恢复的本地断点。");
    if (data.schemaVersion !== "0.3.0-rc.1") {
      return setState("该断点来自旧版，语音曾被误判为普通文字。要补全原生语音转写，请保留已下载备份并从最近消息重新采集。");
    }
    const tag = $("tag").value.trim();
    if (tag !== data.tag) return setState("会话标签与保存的断点不一致，请输入相同标签再恢复。");
    if (location.href !== data.url) return setState("当前网页地址与保存断点不同，拒绝恢复，以免混合会话。");
    if (!window.confirm(`确认当前仍是「${data.tag}」这个聊天对象？恢复后会继续采集。`)) return;
    records.clear();
    candidates.clear();
    for (const entry of data.entries) {
      if (Number.isSafeInteger(entry.dataIndex)) records.set(entry.dataIndex, entry);
    }
    voiceAttempted.clear();
    for (const n of data.attemptedVoiceIndexes || []) if (Number.isSafeInteger(n)) voiceAttempted.add(n);
    failed.clear();
    for (const n of data.failures || []) if (Number.isSafeInteger(n)) failed.add(n);
    run.tag = tag;
    run.startedAt = data.startedAt;
    run.startedUrl = data.url;
    run.startedFromNewest = Boolean(data.startedFromNewest);
    run.oldestBoundaryEvidence = data.oldestBoundaryEvidence || "unverified";
    run.step = data.step || 0;
    run.phase = "running";
    run.interrupted = false;
    scroller.scrollTop = data.scrollerTop || 0;
    await wait(500);
    captureVisible();
    controls();
    setState("已恢复本机断点，继续向更早的消息滚动。此操作依赖你确认会话未发生切换。");
    void autoScroll();
  }

  function download(body, ext, mime) {
    const cleanTag = run.tag.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 40) || "chat";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `douyin-${cleanTag}-${timestamp}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  $("start").addEventListener("click", () => void startNew());
  $("restore").addEventListener("click", () => void restore());
  $("pause").addEventListener("click", () => {
    if (run.phase !== "running") return;
    run.phase = "paused";
    void persist(true);
    controls();
    setState("已暂停。当前进度保存到本机；可继续或停止导出。");
  });
  $("continue").addEventListener("click", () => {
    if (run.phase !== "paused") return;
    run.phase = "running";
    controls();
    setState("继续采集……");
    void autoScroll();
  });
  $("stop").addEventListener("click", async () => {
    if (run.phase !== "running" && run.phase !== "paused") return;
    run.phase = "stopping";
    controls();
    if (!scrollLoopRunning) await finalize();
  });
  $("rescan").addEventListener("click", async () => {
    captureVisible();
    await wait(STABLE_MS + 50);
    captureVisible();
    await persist(true);
    if (run.phase === "completed" && prepared) prepared = prepareArchive();
    setState("已重新读取当前屏幕。若语音转写由你手动完成，请检查导出文件里的文字归属。 ");
  });
  $("json").addEventListener("click", () => {
    if (prepared) download(JSON.stringify(prepared, null, 2), "json", "application/json;charset=utf-8");
  });
  $("txt").addEventListener("click", () => {
    if (prepared) download(core.renderReadableTxt(prepared), "txt", "text/plain;charset=utf-8");
  });
  $("html").addEventListener("click", () => {
    if (prepared) download(core.renderReadableHtml(prepared), "html", "text/html;charset=utf-8");
  });
  $("rawtxt").addEventListener("click", () => {
    if (prepared) download(core.renderTxt(prepared), "txt", "text/plain;charset=utf-8");
  });
  $("clear").addEventListener("click", async () => {
    if (!window.confirm("永久删除此插件保存的本地聊天断点？已下载的文件不受影响。")) return;
    if (run.phase === "running" || run.phase === "paused") return setState("请先停止采集，再删除本地断点。");
    await chrome.storage.local.remove(STORE_KEY);
    checkpointLoaded = null;
    $("restore").hidden = true;
    setState("本地断点已删除。");
  });
  $("close").addEventListener("click", () => {
    if ((run.phase === "running" || run.phase === "paused") &&
        !window.confirm("关闭面板会停止监听。请先下载文件或使用暂停功能保存断点。确定关闭？")) return;
    if (run.phase === "running" || run.phase === "paused") run.phase = "paused";
    observer?.disconnect();
    clearInterval(ticker);
    host.remove();
  });

  void chrome.storage.local.get(STORE_KEY).then(result => {
    const saved = result[STORE_KEY];
    if (!saved?.entries?.length) return;
    checkpointLoaded = saved;
    $("restore").hidden = false;
    $("tag").value = saved.tag;
    setState(saved.schemaVersion === "0.3.0-rc.1"
      ? `检测到本地断点：${saved.entries.length} 个列表项；确认聊天对象后可恢复。`
      : `检测到旧版断点：${saved.entries.length} 个列表项。新版修复了语音识别，建议重新开始以补全语音。`);
  }).catch(() => setState("无法访问浏览器本地断点存储。仍可新建采集，但不能保证恢复功能。"));
  void chrome.storage.local.get("douyin_voice_enhanced_opt_in").then(result => {
    $("trustedVoice").disabled = !enhancedVariant;
    $("trustedVoice").checked = enhancedVariant && result.douyin_voice_enhanced_opt_in === true;
  }).catch(() => { $("trustedVoice").checked = false; });
  controls();
})();
