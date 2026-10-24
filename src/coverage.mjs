/**
 * A full-history export is only considered complete after verified pagination
 * termination. The UI must never equate "no visible messages" with completion.
 */
export function evaluateCoverage({
  reachedOldestBoundary = false,
  failedPages = 0,
  pendingPages = 0,
  cursorLoop = false,
  unexpectedGaps = 0
} = {}) {
  if (cursorLoop || unexpectedGaps > 0 || failedPages > 0) {
    return { state: "incomplete", reason: "分页异常或消息缺口" };
  }
  if (!reachedOldestBoundary || pendingPages > 0) {
    return { state: "partial", reason: "尚未证实已读取最早的历史消息" };
  }
  return { state: "complete", reason: "已到达历史分页边界且无已知分页异常" };
}

export function mergeMessagesById(existing, incoming) {
  const merged = new Map();
  for (const message of [...existing, ...incoming]) {
    if (!message || typeof message.messageId !== "string" || !message.messageId) {
      throw new TypeError("消息必须具有非空 messageId");
    }
    merged.set(message.messageId, message);
  }
  return [...merged.values()].sort((a, b) => {
    const t = Number(a.createdAtUs) - Number(b.createdAtUs);
    return t || a.messageId.localeCompare(b.messageId);
  });
}

/**
 * Transcript coverage is independent from historical-message capture coverage.
 * A voice without readable text is never silently treated as transcribed.
 */
export function evaluateVoiceTranscriptions(messages) {
  const voice = messages.filter(message => message.type === "voice");
  const counts = { total: voice.length, success: 0, pending: 0, failed: 0, unavailable: 0 };
  for (const message of voice) {
    const status = message.voiceTranscript?.status || "pending";
    if (!(status in counts) || status === "total") {
      throw new TypeError(`未知语音转写状态：${status}`);
    }
    counts[status]++;
    if (status === "success" && !message.voiceTranscript?.text?.trim()) {
      throw new TypeError("标记为转写成功的语音必须包含文字");
    }
  }
  const state = counts.failed || counts.unavailable
    ? "incomplete"
    : counts.pending ? "partial" : "complete";
  return { state, ...counts };
}
