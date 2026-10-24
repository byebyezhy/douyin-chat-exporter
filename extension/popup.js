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
  return {
    host: location.hostname,
    readyState: document.readyState,
    iframes: document.querySelectorAll("iframe").length,
    viewport: { width: innerWidth, height: innerHeight },
    contenteditables: editables.length,
    editableRegions: editables.slice(0, 5).map(element => ({ rect: rectangle(element) })),
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
