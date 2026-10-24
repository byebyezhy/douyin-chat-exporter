"use strict";

// Powerful Chrome debugger access is optional and user-granted. This service
// worker only translates a tightly scoped Douyin content-script request into
// one trusted mouse click. No Runtime.evaluate, Network or data collection.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "DOUYIN_EXPORT_TRUSTED_MOUSE") return false;

  const go = async () => {
    const tabId = sender.tab?.id;
    const url = sender.url || sender.tab?.url || "";
    const x = message.x;
    const y = message.y;
    const button = message.button;
    if (!Number.isInteger(tabId) || !/^https:\/\/www\.douyin\.com\//.test(url) ||
        (sender.id && sender.id !== chrome.runtime.id) ||
        (sender.frameId !== undefined && sender.frameId !== 0)) {
      return { ok: false, reason: "not-authorized-douyin-tab" };
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 12000 || y > 12000 ||
        !["right", "left"].includes(button)) {
      return { ok: false, reason: "invalid-click" };
    }
    if (!await chrome.permissions.contains({ permissions: ["debugger"] })) {
      return { ok: false, reason: "debugger-permission-required" };
    }
    const target = { tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      const coordinate = { x: Math.round(x), y: Math.round(y) };
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved", ...coordinate, button: "none", buttons: 0
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed", ...coordinate, button,
        buttons: button === "right" ? 2 : 1, clickCount: 1
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased", ...coordinate, button, buttons: 0, clickCount: 1
      });
      return { ok: true };
    } catch {
      // No page contents, raw DevTools errors or private request data in reply.
      return { ok: false, reason: "trusted-input-unavailable" };
    } finally {
      if (attached) {
        try { await chrome.debugger.detach(target); } catch { /* already detached */ }
      }
    }
  };

  void go().then(sendResponse).catch(() => sendResponse({ ok: false, reason: "internal-error" }));
  return true;
});
