/* Optional, DOM-only preparation for long chats. Reuses the already-tested
 * legacy virtual-list scroll direction; does NOT capture or parse messages.
 */
(() => {
  "use strict";
  function locateChat(doc = document, styleOf = element => getComputedStyle(element)) {
    const editor = doc.querySelector('[contenteditable="true"]');
    const box = editor?.getBoundingClientRect();
    if (!box) return null;
    const centerX = box.left + box.width / 2;
    const scroller = [...doc.querySelectorAll("*")].find(element => {
      const style = styleOf(element);
      const rect = element.getBoundingClientRect();
      return (style.overflowY === "auto" || style.overflowY === "scroll") &&
        element.scrollHeight > element.clientHeight + 10 &&
        rect.left < centerX && rect.right > centerX && rect.top < box.top && rect.height > 200;
    });
    const list = scroller?.firstElementChild;
    return list && [...list.children].some(element => element.hasAttribute?.("data-index"))
      ? { scroller, list } : null;
  }

  function hasOldestSentinel(scroller) {
    const nodes = scroller.querySelectorAll('[role="status"], [data-testid*="end"], [data-testid*="load-more"]');
    return [...nodes].some(node => !node.closest?.("[data-index]") &&
      /^(?:没有更多消息|没有更多聊天记录|已到最早消息|已经到底了)$/.test((node.innerText || "").trim()));
  }
  function maxIndex(list) {
    const indices = [...list.children].map(node => Number(node.getAttribute?.("data-index")))
      .filter(Number.isSafeInteger);
    return indices.length ? Math.max(...indices) : null;
  }
  const sleepMs = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function scrollToOldest({ surface, signal, expectedHref, href = () => location.href,
    verify = async () => {}, onProgress = () => {}, sleep = sleepMs,
    stepDelayMs = 450, maxSteps = 20000 }) {
    const { scroller, list } = surface || {};
    if (!scroller || !list) throw new Error("未检测到聊天列表，请先打开目标私信");
    let stagnant = 0;
    let indexStagnant = 0;
    let lastMax = maxIndex(list);
    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) return { state: "cancelled", steps: step };
      if (!scroller.isConnected || !list.isConnected || scroller.firstElementChild !== list ||
        (expectedHref && href() !== expectedHref)) throw new Error("网页或聊天列表已改变，已安全停止滚动");
      if (step % 8 === 0) await verify();
      if (signal?.aborted) return { state: "cancelled", steps: step };
      if (hasOldestSentinel(scroller)) return { state: "oldest-sentinel", steps: step };
      const before = scroller.scrollTop;
      const height = scroller.clientHeight;
      const maxTop = Math.max(0, scroller.scrollHeight - height);
      scroller.scrollTop = Math.min(maxTop, before + Math.max(220, Math.floor(height * 0.55)));
      await sleep(stepDelayMs);
      if (signal?.aborted) return { state: "cancelled", steps: step + 1 };
      const after = scroller.scrollTop;
      const currentMax = maxIndex(list);
      stagnant = Math.abs(after - before) < 2 ? stagnant + 1 : 0;
      indexStagnant = currentMax != null && currentMax === lastMax ? indexStagnant + 1 : 0;
      if (currentMax != null) lastMax = currentMax;
      onProgress({ step: step + 1, scrollTop: after, scrollHeight: scroller.scrollHeight,
        maxIndex: currentMax });
      // A virtualized list may expand scrollHeight on every historical fetch.
      // Repeated no-motion at its actual limit is the conservative fallback.
      if (stagnant >= 7 || (indexStagnant >= 18 &&
        scroller.scrollHeight - scroller.clientHeight - after < 2)) {
        return { state: "visual-end", steps: step + 1 };
      }
    }
    return { state: "step-limit", steps: maxSteps };
  }
  globalThis.__DOUYIN_CHAT_SCROLL_V042__ = Object.freeze({ locateChat, scrollToOldest });
})();
