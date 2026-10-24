"use strict";

const button = document.querySelector("#diagnose");
const status = document.querySelector("#status");
const result = document.querySelector("#result");

function inspectPage() {
  // Only structural counts/booleans are collected. Never return text, URLs,
  // DOM markup, profile identifiers, cookies or request headers.
  const rectangle = (element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return Object.fromEntries(
      Object.entries({ x, y, width, height }).map(([key, value]) => [key, Math.round(value)])
    );
  };
  const structuralPath = (element) => {
    const sections = [];
    let node = element;
    while (node && node !== document.documentElement && sections.length < 9) {
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement
        ? [...node.parentElement.children].filter(child => child.tagName === node.tagName)
        : [];
      const index = siblings.indexOf(node) + 1;
      sections.unshift(`${tag}:nth-of-type(${Math.max(index, 1)})`);
      node = node.parentElement;
    }
    return sections.join(" > ");
  };
  const scrollables = [...document.querySelectorAll("*")].filter((element) => {
    const style = getComputedStyle(element);
    return (style.overflowY === "auto" || style.overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 10;
  });
  const editables = [...document.querySelectorAll('[contenteditable="true"]')];
  const editorRect = editables[0]?.getBoundingClientRect();
  const editorCenterX = editorRect ? editorRect.x + editorRect.width / 2 : null;
  const chatIndex = editorCenterX === null ? -1 : scrollables.findIndex(element => {
    const box = element.getBoundingClientRect();
    return box.left < editorCenterX && box.right > editorCenterX &&
      box.top < editorRect.top && box.height > 200;
  });
  const chatContainer = chatIndex < 0 ? null : scrollables[chatIndex];

  const relativePath = (element, root) => {
    const steps = [];
    let current = element;
    while (current && current !== root && steps.length < 12) {
      const parent = current.parentElement;
      if (!parent) break;
      steps.unshift(`${current.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(current) + 1})`);
      current = parent;
    }
    return current === root ? steps.join(" > ") || "(root)" : "(deep) " + steps.join(" > ");
  };

  const structuralGroups = () => {
    if (!chatContainer) return [];
    const candidates = [chatContainer, ...chatContainer.querySelectorAll("*")];
    const found = [];
    for (const parent of candidates.slice(0, 6000)) {
      const children = [...parent.children];
      if (children.length < 4) continue;
      const counts = new Map();
      for (const child of children) counts.set(child.tagName, (counts.get(child.tagName) || 0) + 1);
      const largest = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (!largest || largest[1] < 4) continue;
      const attributeNames = [...new Set(children.slice(0, 3)
        .flatMap(child => [...child.attributes].map(attr => attr.name)))]
        .filter(name => name === "role" || name.startsWith("data-"))
        .slice(0, 8);
      found.push({
        pathFromChat: relativePath(parent, chatContainer),
        itemTag: largest[0].toLowerCase(),
        siblingCount: children.length,
        sameTagCount: largest[1],
        attributeNames
      });
    }
    return found.sort((a, b) => b.sameTagCount - a.sameTagCount).slice(0, 15);
  };

  return {
    host: location.hostname,
    readyState: document.readyState,
    iframes: document.querySelectorAll("iframe").length,
    viewport: { width: innerWidth, height: innerHeight },
    contenteditables: editables.length,
    editableRegions: editables.slice(0, 5).map(element => ({ rect: rectangle(element) })),
    chatCandidateIndex: chatIndex,
    chatStructure: {
      descendantElements: chatContainer?.querySelectorAll("*").length ?? 0,
      repeatedGroups: structuralGroups()
    },
    scrollableRegions: scrollables.slice(0, 12).map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      path: structuralPath(element),
      rect: rectangle(element),
      scrollTop: Math.round(element.scrollTop),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      childElements: element.children.length
    })),
    checkedAt: new Date().toISOString()
  };
}

button.addEventListener("click", async () => {
  button.disabled = true;
  result.hidden = true;
  status.textContent = "正在检测……";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/([a-z0-9-]+\.)*douyin\.com(?:\/|$)/i.test(tab.url || "")) {
      throw new Error("请在 https://www.douyin.com/ 打开网页版后再检测。 ");
    }
    const items = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectPage
    });
    const payload = items?.[0]?.result;
    if (!payload) throw new Error("页面未返回检测结果，请刷新抖音后重试。");
    result.textContent = JSON.stringify(payload, null, 2);
    result.hidden = false;
    status.textContent = "检测完成。未读取或上传聊天内容。";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "检测失败";
  } finally {
    button.disabled = false;
  }
});
