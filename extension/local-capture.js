(() => {
  "use strict";

  const ROOT_ID = "douyin-exporter-local-capture-root";
  if (document.getElementById(ROOT_ID)) return;

  const editable = document.querySelector('[contenteditable="true"]');
  const editorBox = editable?.getBoundingClientRect();
  const centerX = editorBox ? (editorBox.left + editorBox.right) / 2 : null;
  const scroller = [...document.querySelectorAll("*")].find(element => {
    if (centerX === null) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (style.overflowY === "auto" || style.overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 10 &&
      rect.left < centerX && rect.right > centerX &&
      rect.top < editorBox.top && rect.height > 200;
  });
  const list = scroller?.firstElementChild;
  if (!list || ![...list.children].some(child => child.hasAttribute("data-index"))) {
    window.alert("未找到聊天列表。请先打开一个抖音私信会话。此实验版只支持当前网页版结构。");
    return;
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.cssText = "position:fixed;top:80px;right:18px;width:355px;max-width:calc(100vw - 36px);z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}section{background:#fff;color:#17243a;font:13px/1.5 system-ui,sans-serif;
        border:1px solid #c8d1e0;border-radius:10px;box-shadow:0 8px 30px #0003;padding:14px}
      strong{display:block;font-size:15px;margin-bottom:8px}p{margin:7px 0;color:#435169}
      button{border:0;border-radius:6px;background:#1768e8;color:#fff;padding:8px 10px;
        cursor:pointer;margin:5px 5px 0 0}button.secondary{background:#68778a}
      button:disabled{opacity:.5;cursor:default}small{display:block;color:#687386;margin-top:10px}
      #warn{background:#fff5e8;border-radius:6px;padding:8px;color:#814b04}
      #summary{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;background:#f4f6fa;
        border-radius:6px;padding:8px;max-height:230px;overflow:auto}
    </style>
    <section>
      <strong>本地聊天文字采集 · M1 实验版</strong>
      <p id="state">正在监听。请只在当前会话中缓慢翻看更早的历史。</p>
      <p id="progress">等待列表内容……</p>
      <p id="warn">采集可能包含私人聊天文字，仅保存在本页内存。不要把导出的 JSON/TXT 发给别人或提交到 GitHub。</p>
      <button id="finish">停止并准备下载</button>
      <button id="json" hidden>下载 JSON</button>
      <button id="txt" hidden>下载 TXT</button>
      <button id="close" class="secondary">放弃并关闭</button>
      <pre id="summary" hidden></pre>
      <small>列表索引≠永久消息 ID。本实验版不验证最早边界、发送者、日期或语音转写，不会显示“完整导出”。</small>
    </section>`;
  document.body.appendChild(host);

  const byId = id => shadow.getElementById(id);
  const entries = new Map();
  const conflictingIndexes = new Set();
  const failedIndexes = new Set();
  const startedAt = new Date().toISOString();
  const initialScrollTop = scroller.scrollTop;
  let stopped = false;
  let interrupted = false;
  let lastUiRefresh = 0;
  let archive = null;

  const mediaMarkers = element => ({
    img: element.querySelectorAll("img").length,
    video: element.querySelectorAll("video").length,
    audio: element.querySelectorAll("audio").length,
    canvas: element.querySelectorAll("canvas").length,
    svg: element.querySelectorAll("svg").length
  });

  const captureItem = element => {
    if (!element?.hasAttribute("data-index")) return;
    const rawIndex = element.getAttribute("data-index");
    if (!/^-?\d+$/.test(rawIndex || "")) return;
    const dataIndex = Number(rawIndex);
    if (!Number.isSafeInteger(dataIndex)) return;

    try {
      // Do not inspect src/href, user handles, IDs, cookies or fetch endpoints.
      // innerText intentionally captures only the webpage's rendered text.
      const visibleText = typeof element.innerText === "string"
        ? element.innerText.replace(/\r\n/g, "\n").trim()
        : (element.textContent || "").replace(/\r\n/g, "\n").trim();
      const markers = mediaMarkers(element);
      const now = new Date().toISOString();
      const next = {
        dataIndex,
        recordKind: "unclassified-virtual-list-item",
        platformMessageId: null,
        sender: "unknown",
        createdAt: null,
        visibleText,
        mediaMarkers: markers,
        capturedAt: now,
        lastUpdatedAt: now
      };
      const previous = entries.get(dataIndex);
      if (!previous) {
        entries.set(dataIndex, next);
        return;
      }

      if (previous.visibleText && visibleText &&
          !previous.visibleText.includes(visibleText) && !visibleText.includes(previous.visibleText)) {
        // A recycled/reindexed row or unexpectedly changed content must be flagged.
        conflictingIndexes.add(dataIndex);
      }
      const previousMarkers = Object.values(previous.mediaMarkers).reduce((a, b) => a + b, 0);
      const newMarkers = Object.values(markers).reduce((a, b) => a + b, 0);
      if (visibleText.length > previous.visibleText.length ||
          (visibleText.length === previous.visibleText.length && newMarkers > previousMarkers)) {
        entries.set(dataIndex, { ...next, capturedAt: previous.capturedAt });
      }
    } catch {
      failedIndexes.add(dataIndex);
    }
  };

  const captureNode = node => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    const containingItem = node.closest?.("[data-index]");
    if (containingItem && list.contains(containingItem)) captureItem(containingItem);
    if (node.hasAttribute("data-index")) captureItem(node);
    for (const descendant of node.querySelectorAll("[data-index]")) captureItem(descendant);
  };

  const updateProgress = () => {
    const now = Date.now();
    if (now - lastUiRefresh < 150) return;
    lastUiRefresh = now;
    const indexes = [...entries.keys()];
    const min = indexes.length ? Math.min(...indexes) : "?";
    const max = indexes.length ? Math.max(...indexes) : "?";
    const noText = [...entries.values()].filter(entry => !entry.visibleText).length;
    byId("progress").textContent =
      `已暂存 ${entries.size} 个列表项；索引 ${min}–${max}；无可见文字 ${noText}；疑似冲突 ${conflictingIndexes.size}`;
  };

  const captureVisible = () => {
    if (stopped) return;
    if (!list.isConnected) {
      interrupted = true;
      finish("聊天列表已更换或离开页面，采集自动停止。请检查文件是否混合了不同会话。");
      return;
    }
    for (const item of list.children) captureItem(item);
    updateProgress();
  };

  const observer = new MutationObserver(records => {
    if (stopped) return;
    for (const record of records) {
      if (record.type === "characterData") {
        captureNode(record.target.parentElement);
      } else {
        captureNode(record.target);
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) captureNode(node);
        if (node.nodeType === Node.TEXT_NODE) captureNode(node.parentElement);
      }
    }
    captureVisible();
  });
  observer.observe(list, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["data-index", "class"]
  });
  scroller.addEventListener("scroll", captureVisible, { passive: true });
  const timer = setInterval(captureVisible, 150);

  const coverage = indexes => {
    if (!indexes.length) return { min: null, max: null, missing: 0, sample: [] };
    const min = Math.min(...indexes);
    const max = Math.max(...indexes);
    const present = new Set(indexes);
    const span = max - min + 1;
    const sample = [];
    if (span <= 1000000) {
      for (let i = min; i <= max && sample.length < 40; i++) {
        if (!present.has(i)) sample.push(i);
      }
    }
    return { min, max, missing: span - present.size, sample };
  };

  const finish = (message = "采集已停止。文件只会下载到你的电脑。") => {
    if (stopped) return;
    if (list.isConnected) {
      for (const item of list.children) captureItem(item);
    }
    stopped = true;
    observer.disconnect();
    scroller.removeEventListener("scroll", captureVisible);
    clearInterval(timer);
    const ordered = [...entries.values()].sort((a, b) => a.dataIndex - b.dataIndex);
    const indexes = ordered.map(entry => entry.dataIndex);
    const span = coverage(indexes);
    archive = {
      schemaVersion: "0.1.5-raw-preview",
      platform: "douyin",
      source: "user-visible-webpage-dom",
      scope: "one-open-chat-list",
      capturedAt: new Date().toISOString(),
      capture: {
        status: "partial",
        oldestBoundaryConfirmed: false,
        reason: "未验证历史边界、消息 ID、发送者、时间和类型；列表索引连续不等于全部历史已完整。",
        startedAt,
        stoppedAt: new Date().toISOString(),
        interrupted,
        scrollTopAtStart: Math.round(initialScrollTop),
        scrollTopAtStop: Math.round(scroller.scrollTop),
        observedCount: entries.size,
        minIndex: span.min,
        maxIndex: span.max,
        unobservedIndexesInRange: span.missing,
        missingIndexSample: span.sample,
        entriesWithNoVisibleText: ordered.filter(entry => !entry.visibleText).length,
        conflictingIndexes: [...conflictingIndexes].sort((a, b) => a - b),
        failedCaptureIndexes: [...failedIndexes].sort((a, b) => a - b)
      },
      voiceTranscription: {
        status: "not-verified", source: "douyin-native-only",
        reason: "本版尚未识别或自动转换语音。"
      },
      privacy: "该文件包含真实私聊文字，仅限本地保存，请勿上传到 GitHub 或公开聊天。",
      entries: ordered
    };
    byId("state").textContent = message;
    byId("finish").hidden = true;
    byId("json").hidden = false;
    byId("txt").hidden = false;
    byId("close").textContent = "关闭面板";
    byId("progress").hidden = true;
    byId("summary").hidden = false;
    byId("summary").textContent = [
      `已采集列表项：${entries.size}`,
      `索引范围：${span.min ?? "?"}–${span.max ?? "?"}`,
      `未观察索引：${span.missing}`,
      `无可见文字：${archive.capture.entriesWithNoVisibleText}`,
      `疑似重编号冲突：${conflictingIndexes.size}`,
      `读取异常索引：${failedIndexes.size}`,
      "历史完整性：未验证（partial）",
      "语音转换完整性：未验证"
    ].join("\n");
  };

  const download = (body, extension, mimeType) => {
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `douyin-chat-raw-${date}.${extension}`;
    const blob = new Blob([body], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  byId("finish").addEventListener("click", () => finish());
  byId("json").addEventListener("click", () => {
    if (archive) download(JSON.stringify(archive, null, 2), "json", "application/json;charset=utf-8");
  });
  byId("txt").addEventListener("click", () => {
    if (!archive) return;
    const lines = [
      "抖音聊天列表原始采集 · 实验预览（未验证完整）",
      `观察条目：${archive.capture.observedCount}；范围：${archive.capture.minIndex}–${archive.capture.maxIndex}`,
      `未观察索引：${archive.capture.unobservedIndexesInRange}；语音转写未验证`, ""
    ];
    for (const entry of archive.entries) {
      lines.push(`[列表位置 ${entry.dataIndex} · 未识别发送者/时间]`);
      lines.push(entry.visibleText || "[无可见文字；可能是媒体或其他非文本条目]");
      const markers = Object.entries(entry.mediaMarkers).filter(([, value]) => value);
      if (markers.length) lines.push(`[页面媒体标记：${markers.map(([k, v]) => `${k}=${v}`).join("，")}]`);
      lines.push("");
    }
    download(lines.join("\n"), "txt", "text/plain;charset=utf-8");
  });
  byId("close").addEventListener("click", () => {
    if (!stopped && !window.confirm("放弃此次采集？尚未下载的数据会丢失。")) return;
    if (!stopped) finish();
    host.remove();
    entries.clear();
    archive = null;
  });
  captureVisible();
})();
