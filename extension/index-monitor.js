(() => {
  "use strict";

  const ID = "douyin-exporter-index-monitor-root";
  if (document.getElementById(ID)) return;

  const edit = document.querySelector('[contenteditable="true"]');
  const editRect = edit?.getBoundingClientRect();
  const centerX = editRect ? editRect.left + editRect.width / 2 : null;
  const scrollable = [...document.querySelectorAll("*")].find(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return centerX !== null && (style.overflowY === "auto" || style.overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 10 && box.left < centerX &&
      box.right > centerX && box.top < editRect.top && box.height > 200;
  });
  const list = scrollable?.firstElementChild;
  if (!list || ![...list.children].some(child => child.hasAttribute("data-index"))) {
    window.alert("未找到聊天消息索引容器。请先打开一个私信聊天窗口，再开始连续索引测试。");
    return;
  }

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;top:80px;right:18px;z-index:2147483647;width:320px";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}section{background:#fff;color:#1b2535;font:13px/1.5 system-ui,sans-serif;
        border:1px solid #c8d1e0;border-radius:10px;box-shadow:0 8px 30px #0002;padding:14px}
      strong{display:block;font-size:14px;margin-bottom:8px}p{margin:5px 0;color:#435169}
      button{border:0;border-radius:6px;background:#1768e8;color:white;padding:7px 10px;cursor:pointer;margin-top:8px}
      button.secondary{background:#65748a}textarea{margin-top:10px;width:100%;height:175px;resize:vertical;
        font:11px/1.4 ui-monospace,monospace;background:#f4f6fa;border:1px solid #c9d1df;border-radius:6px;padding:6px}
      small{display:block;color:#687386;margin-top:8px}
    </style>
    <section>
      <strong>聊天索引连续监听 · M0</strong>
      <p id="state">正在记录，请在聊天区缓慢向上滚动。</p>
      <p id="numbers">等待消息索引……</p>
      <button id="finish">停止并生成报告</button>
      <button id="copy" class="secondary" hidden>复制报告</button>
      <button id="close" class="secondary" hidden>关闭</button>
      <textarea id="report" readonly hidden></textarea>
      <small>仅记录 data-index 数字，不读取消息正文、账号或 Cookie。</small>
    </section>`;
  document.body.appendChild(host);

  const byId = id => shadow.getElementById(id);
  const seen = new Set();
  const startedAt = new Date();
  const firstScrollTop = scrollable.scrollTop;
  let firstSeen = null;
  let lastSeen = null;
  let minSeen = null;
  let maxSeen = null;
  let stopped = false;
  let lastRefresh = 0;

  const accept = value => {
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) return;
    const index = Number(value);
    if (!Number.isSafeInteger(index)) return;
    if (seen.has(index)) return;
    if (firstSeen === null) firstSeen = index;
    lastSeen = index;
    seen.add(index);
    minSeen = minSeen === null ? index : Math.min(minSeen, index);
    maxSeen = maxSeen === null ? index : Math.max(maxSeen, index);
  };
  const captureNode = node => {
    if (node.nodeType !== 1) return;
    if (node.hasAttribute("data-index")) accept(node.getAttribute("data-index"));
    for (const child of node.querySelectorAll("[data-index]")) {
      accept(child.getAttribute("data-index"));
    }
  };
  const captureVisible = () => {
    for (const child of list.children) {
      if (child.hasAttribute("data-index")) accept(child.getAttribute("data-index"));
    }
    const now = Date.now();
    if (now - lastRefresh < 150) return;
    lastRefresh = now;
    byId("numbers").textContent = `已观察 ${seen.size} 个索引；范围 ${minSeen ?? "?"}–${maxSeen ?? "?"}`;
  };

  const observer = new MutationObserver(records => {
    if (stopped) return;
    for (const record of records) {
      if (record.type === "attributes") captureNode(record.target);
      for (const node of record.addedNodes) captureNode(node);
    }
    captureVisible();
  });
  observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-index"] });
  scrollable.addEventListener("scroll", captureVisible, { passive: true });
  const timer = setInterval(captureVisible, 150);
  captureVisible();

  const finish = () => {
    if (stopped) return;
    captureVisible();
    stopped = true;
    observer.disconnect();
    scrollable.removeEventListener("scroll", captureVisible);
    clearInterval(timer);
    const min = minSeen;
    const max = maxSeen;
    const span = seen.size ? max - min + 1 : 0;
    let missed = null;
    const missingSample = [];
    if (seen.size && span <= 1000000) {
      missed = span - seen.size;
      for (let i = min; i <= max && missingSample.length < 40; i++) {
        if (!seen.has(i)) missingSample.push(i);
      }
    }
    const report = {
      version: "0.1.4-index-monitor",
      startedAt: startedAt.toISOString(),
      stoppedAt: new Date().toISOString(),
      observedCount: seen.size,
      firstObservedIndex: firstSeen,
      lastObservedIndex: lastSeen,
      minIndex: min,
      maxIndex: max,
      unobservedIndexesInRange: missed,
      missingIndexSample: missingSample,
      scrollTopAtStart: Math.round(firstScrollTop),
      scrollTopAtStop: Math.round(scrollable.scrollTop),
      // An unobserved index is not proof of a missing chat message.
      note: "仅统计虚拟列表索引；不代表服务端消息完整性，也未采集消息正文。"
    };
    byId("state").textContent = "监听已停止。请复制下方 JSON 报告。";
    byId("report").value = JSON.stringify(report, null, 2);
    byId("report").hidden = false;
    byId("copy").hidden = false;
    byId("close").hidden = false;
    byId("finish").hidden = true;
  };

  byId("finish").addEventListener("click", finish);
  byId("copy").addEventListener("click", async () => {
    const input = byId("report");
    try {
      await navigator.clipboard.writeText(input.value);
      byId("state").textContent = "已复制报告。";
    } catch {
      input.focus();
      input.select();
      byId("state").textContent = "请按 Ctrl+C 复制已选中的报告。";
    }
  });
  byId("close").addEventListener("click", () => host.remove());
})();
