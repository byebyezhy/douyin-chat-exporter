/* Pure, dependency-free archive model shared by the browser and Node tests. */
(() => {
  "use strict";

  const uniqSorted = values => [...new Set(values.filter(Number.isSafeInteger))].sort((a, b) => a - b);

  function coverage(values) {
    const nums = uniqSorted(values);
    if (!nums.length) return { observedCount: 0, minIndex: null, maxIndex: null, gapCount: 0, missingSample: [] };
    const minIndex = nums[0];
    const maxIndex = nums.at(-1);
    const gapCount = maxIndex - minIndex + 1 - nums.length;
    const sample = [];
    for (let n = 1; n < nums.length && sample.length < 40; n++) {
      for (let missing = nums[n - 1] + 1; missing < nums[n] && sample.length < 40; missing++) sample.push(missing);
    }
    return { observedCount: nums.length, minIndex, maxIndex, gapCount, missingSample: sample };
  }

  function typeFromSignals({ visibleText = "", voiceHint = false, image = 0, largeImages = 0, video = 0, canvas = 0, timeLabel = false } = {}) {
    if (timeLabel) return "system";
    if (voiceHint) return "voice";
    if (video > 0) return "video";
    if (largeImages > 0) return "image";
    if (visibleText.trim()) return "text";
    if (image > 0 || canvas > 0) return "unknown_media";
    return "unknown";
  }

  function parseTime(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    const text = raw.trim();
    if (/^\d{13}$/.test(text)) {
      const date = new Date(Number(text));
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    if (/^\d{10}$/.test(text)) {
      const date = new Date(Number(text) * 1000);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(text)) {
      const date = new Date(text);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    // Ambiguous calendar labels without a timezone must stay raw.
    return null;
  }

  function summarize(entries, runtime = {}) {
    const span = coverage(entries.map(entry => entry.dataIndex));
    const stable = entries.filter(entry => entry.captureConfidence === "stable").length;
    const failures = runtime.failures ?? [];
    const verifiedIds = entries.length > 0 && entries.every(entry => entry.platformMessageId && entry.messageIdConfidence === "verified");
    const explicitBoundary = runtime.oldestBoundaryEvidence === "explicit-ui-no-more" || runtime.oldestBoundaryEvidence === "server-no-more";
    const complete = explicitBoundary && runtime.startedFromNewest === true && runtime.conversationGuardVerified === true &&
      span.gapCount === 0 && stable === entries.length && failures.length === 0 && verifiedIds &&
      !runtime.interrupted && !runtime.storageFailure;
    const incomplete = span.gapCount > 0 || failures.length > 0 || runtime.interrupted || runtime.storageFailure;
    return {
      state: complete ? "complete" : incomplete ? "incomplete" : "partial",
      reason: complete ? "已验证起点与最早边界，且无已知采集异常" :
        incomplete ? "观察到索引缺口、中断或采集异常" : "尚未证实完整历史边界、稳定消息 ID 或单会话绑定",
      startedFromNewest: Boolean(runtime.startedFromNewest),
      oldestBoundaryEvidence: runtime.oldestBoundaryEvidence ?? "unverified",
      conversationGuardVerified: Boolean(runtime.conversationGuardVerified),
      verifiedPlatformMessageIds: verifiedIds,
      ...span,
      stableEntries: stable,
      provisionalEntries: entries.length - stable,
      failedCaptureIndexes: [...failures]
    };
  }

  function voiceSummary(entries) {
    const voices = entries.filter(entry => entry.type === "voice");
    const counts = { total: voices.length, success: 0, pending: 0, failed: 0, unavailable: 0, manual_required: 0 };
    for (const row of voices) {
      const status = row.voiceTranscript?.status || "pending";
      if (status in counts && status !== "total") counts[status]++;
      else counts.pending++;
    }
    const unknownType = entries.filter(entry => entry.type === "unknown" || entry.type === "unknown_media").length;
    return {
      state: voices.length === 0 ? "not-verified" :
        unknownType > 0 || counts.pending || counts.failed || counts.unavailable || counts.manual_required
          ? "partial" : "complete-for-classified-voice",
      source: "douyin-native-only",
      detectionCoverage: "heuristic-not-verified",
      unknownTypeEntries: unknownType,
      ...counts
    };
  }

  function buildArchive({ entries, runtime, conversationTag, createdAt, stoppedAt }) {
    const ordered = [...entries].sort((a, b) => b.dataIndex - a.dataIndex);
    return {
      schemaVersion: "0.2.0-rc.1",
      platform: "douyin",
      scope: "one-user-selected-chat",
      conversation: { localTag: conversationTag, platformIdVerified: false },
      exportOrder: "oldest-first-by-observed-virtual-index",
      capturedAt: stoppedAt,
      startedAt: createdAt,
      capture: summarize(ordered, runtime),
      voiceTranscription: voiceSummary(ordered),
      privacy: "包含私人聊天内容；仅保存本地。不得上传到公开 GitHub Issue、PR 或群聊。",
      limitations: [
        "data-index 是虚拟列表位置，不是永久消息 ID。",
        "推测发送者和消息类型时保留置信度，未知值不伪造。",
        "未知附件只保存页面观察到的标记，不包含二进制备份。"
      ],
      entries: ordered
    };
  }

  function renderTxt(archive) {
    const c = archive.capture;
    const lines = [
      "抖音聊天本地导出 · 完整性请查看报告（从旧到新）",
      `本地会话标签：${archive.conversation.localTag}`,
      `记录数：${c.observedCount}；索引范围：${c.minIndex}–${c.maxIndex}；缺口：${c.gapCount}`,
      `采集状态：${c.state}（${c.reason}）`,
      `语音转写状态：${archive.voiceTranscription.state}`,
      ""
    ];
    for (const item of archive.entries) {
      lines.push(`[索引 ${item.dataIndex}] [${item.createdAt || "时间未知"}] [${item.sender || "发送者未知"}] [${item.type || "类型未知"}]`);
      const transcriptText = item.type === "voice" && item.voiceTranscript?.status === "success"
        ? item.voiceTranscript.text?.trim() : null;
      const rawText = transcriptText && item.visibleText?.endsWith(transcriptText)
        ? item.visibleText.slice(0, -transcriptText.length).trim() : item.visibleText;
      lines.push(rawText || "[无可见文字]");
      if (item.type === "voice") {
        const transcript = item.voiceTranscript;
        lines.push(transcript?.status === "success"
          ? `[抖音转文字：${transcript.text}]` : `[语音转写：${transcript?.status || "pending"}]`);
      }
      if (item.mediaMarkers && (item.mediaMarkers.image || item.mediaMarkers.video || item.mediaMarkers.canvas)) {
        lines.push(`[媒体标记：${JSON.stringify(item.mediaMarkers)}；未下载媒体文件]`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  globalThis.__DOUYIN_EXPORT_CORE_V020__ = Object.freeze({ coverage, typeFromSignals, parseTime, summarize, voiceSummary, buildArchive, renderTxt });
})();
