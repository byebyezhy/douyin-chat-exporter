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
    // Real Douyin sample: voice bubbles with waveform canvas have a bare
    // duration such as 28", 6", 1". Canvas alone is NOT a voice signal:
    // it appears in ordinary text messages too.
    if (voiceHint || (canvas > 0 && /^\d{1,3}\s*["″”]$/.test(visibleText.trim()))) return "voice";
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
      schemaVersion: "0.3.0-rc.1",
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

  // Real IM timestamps are ISO instants in UTC. Render them consistently in
  // China Standard Time, independent of the browser's configured timezone.
  // Never invent a time when the legacy DOM collector did not observe one.
  const beijingClock = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  function readableTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return null;
    const parts = Object.fromEntries(beijingClock.formatToParts(instant)
      .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return {
      dayKey: `${parts.year}-${parts.month}-${parts.day}`,
      dayLabel: `${parts.year}年${parts.month}月${parts.day}日`,
      time: `${parts.hour}:${parts.minute}`
    };
  }

  function readableItems(archive) {
    const items = [];
    let lastDay = null;
    function append(entry, item) {
      const clock = readableTimestamp(entry.createdAt);
      if (clock && item.kind !== "voice-pending" && clock.dayKey !== lastDay) {
        items.push({ kind: "date", text: clock.dayLabel });
        lastDay = clock.dayKey;
      }
      items.push(clock ? { ...item, time: clock.time } : item);
    }
    for (const entry of archive.entries) {
      const visible = (entry.visibleText || "").trim();
      if (entry.type === "voice" || /^\d{1,3}\s*["″”]$/.test(visible) && entry.mediaMarkers?.canvas > 0) {
        const transcript = entry.voiceTranscript;
        if (transcript?.status === "success" && transcript.text?.trim()) {
          append(entry, { kind: "voice", sender: entry.sender || "unknown", text: transcript.text.trim() });
        } else {
          items.push({ kind: "voice-pending", sender: entry.sender || "unknown" });
        }
        continue;
      }
      if (/^\d{2}\/\d{2}$/.test(visible) || entry.type === "system") {
        if (visible) items.push({ kind: "date", text: visible });
        continue;
      }
      if (["image", "video", "unknown_media", "other"].includes(entry.type) || !visible ||
          /^(?:\[?红包\]?|\[?图片\]?|\[?视频\]?|分享的视频|查看视频|领取红包)$/.test(visible)) {
        append(entry, { kind: "other" });
        continue;
      }
      append(entry, { kind: "text", sender: entry.sender || "unknown", text: visible });
    }
    return items;
  }

  function readableBlocks(archive) {
    const source = readableItems(archive);
    const blocks = [];
    for (const item of source) {
      // Multiple adjacent non-text entries become one unobtrusive placeholder.
      if (item.kind === "other" && blocks.at(-1)?.kind === "other") {
        blocks.at(-1).count++;
      } else {
        blocks.push(item.kind === "other" ? { kind: "other", count: 1 } : item);
      }
    }
    return blocks;
  }

  function renderReadableTxt(archive) {
    const lines = [
      "抖音聊天记录",
      `会话：${archive.conversation?.localTag || "未命名会话"}`,
      "按时间方向：较早 → 较近",
      "时间：北京时间（UTC+8）；未取得真实时间的旧版消息不显示时间",
      ""
    ];
    let untranscribed = 0;
    for (const item of readableBlocks(archive)) {
      if (item.kind === "date") lines.push(`──── ${item.text} ────`);
      else if (item.kind === "text") lines.push(`${item.time ? `[${item.time}] ` : ""}${item.sender === "self" ? "我：" : item.sender === "peer" ? "对方：" : ""}${item.text}`);
      else if (item.kind === "voice") lines.push(`${item.time ? `[${item.time}] ` : ""}${item.sender === "self" ? "我：" : item.sender === "peer" ? "对方：" : ""}🎤 ${item.text}`);
      else if (item.kind === "voice-pending") untranscribed++;
      else if (item.kind === "other") lines.push(item.count === 1 ? "〔其他消息〕" : `〔其他消息 × ${item.count}〕`);
      if (item.kind !== "voice-pending") lines.push("");
    }
    if (untranscribed) lines.push(`注：${untranscribed} 条语音尚未转成文字（详情请查看 JSON 完整性报告）。`);
    return lines.join("\n").trimEnd() + "\n";
  }

  function renderReadableHtml(archive) {
    const safe = text => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    let pending = 0;
    const elements = [];
    for (const item of readableBlocks(archive)) {
      if (item.kind === "date") elements.push(`<div class="date">${safe(item.text)}</div>`);
      else if (item.kind === "text" || item.kind === "voice") {
        const side = item.sender === "self" ? "self" : item.sender === "peer" ? "peer" : "unknown";
        const badge = item.kind === "voice" ? "<span class=\"voice\">🎤 语音转写</span>" : "";
        const time = item.time ? `<div class="timestamp">${safe(item.time)}</div>` : "";
        elements.push(`<div class="line ${side}"><div class="bubble">${badge}<div>${safe(item.text)}</div>${time}</div></div>`);
      } else if (item.kind === "other") elements.push(`<div class="muted">${item.count === 1 ? "其他消息" : `其他消息 × ${item.count}`}</div>`);
      else if (item.kind === "voice-pending") pending++;
    }
    const note = pending ? `<p class="notice">${pending} 条语音未转成文字；完整状态见 JSON。</p>` : "";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>抖音聊天记录</title><style>*{box-sizing:border-box}body{font:15px/1.7 system-ui,sans-serif;background:#f4f6fb;color:#243244;margin:0}header{padding:24px 16px;text-align:center;background:white;border-bottom:1px solid #ddd}h1{font-size:20px;margin:0}small{color:#77839a}main{max-width:820px;margin:auto;padding:22px 14px}.line{display:flex;margin:12px 0}.line.self{justify-content:flex-end}.line.peer{justify-content:flex-start}.line.unknown{justify-content:center}.bubble{max-width:min(78%,620px);background:white;padding:11px 15px;border-radius:15px;box-shadow:0 1px 5px #1223;white-space:pre-wrap;overflow-wrap:anywhere}.self .bubble{background:#d6edff}.unknown .bubble{background:#e9edf4}.date,.muted{text-align:center;color:#8a96a8;margin:16px 0;font-size:12px}.voice{font-size:12px;color:#1768a7;display:block;margin-bottom:5px}.timestamp{text-align:right;color:#9aa6b2;font-size:11px;margin-top:4px;font-variant-numeric:tabular-nums}.notice{margin-top:30px;color:#865318;background:#fff5dd;padding:12px;border-radius:10px}</style></head><body><header><h1>抖音聊天记录</h1><small>${safe(archive.conversation?.localTag || "未命名会话")} · 较早 → 较近 · 北京时间</small></header><main>${elements.join("\n")}${note}</main></body></html>`;
  }

  globalThis.__DOUYIN_EXPORT_CORE_V020__ = Object.freeze({ coverage, typeFromSignals, parseTime, summarize, voiceSummary, buildArchive, renderTxt,
    readableItems, readableBlocks, renderReadableTxt, renderReadableHtml });
})();
