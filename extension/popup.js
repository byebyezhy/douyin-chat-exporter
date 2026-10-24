"use strict";

const button = document.querySelector("#diagnose");
const status = document.querySelector("#status");
const result = document.querySelector("#result");

function inspectPage() {
  // Only structural counts/booleans are collected. Never return text, URLs,
  // DOM markup, profile identifiers, cookies or request headers.
  const scrollables = [...document.querySelectorAll("*")].filter((element) => {
    const style = getComputedStyle(element);
    return (style.overflowY === "auto" || style.overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 10;
  });
  return {
    host: location.hostname,
    readyState: document.readyState,
    iframes: document.querySelectorAll("iframe").length,
    contenteditables: document.querySelectorAll('[contenteditable="true"]').length,
    scrollableRegions: scrollables.length,
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
