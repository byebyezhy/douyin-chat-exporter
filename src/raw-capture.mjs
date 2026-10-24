/**
 * data-index identifies a position in the currently observed virtual list,
 * NOT a stable platform message ID. Coverage in this range proves neither
 * server-side history completeness nor semantic message parsing.
 */
export function indexCoverage(indexes, sampleSize = 40) {
  const numeric = [...new Set(indexes)].filter(Number.isSafeInteger).sort((a, b) => a - b);
  if (!numeric.length) {
    return { observedCount: 0, minIndex: null, maxIndex: null, unobservedIndexesInRange: 0, missingIndexSample: [] };
  }
  const minIndex = numeric[0];
  const maxIndex = numeric.at(-1);
  const unobservedIndexesInRange = maxIndex - minIndex + 1 - numeric.length;
  const present = new Set(numeric);
  const missingIndexSample = [];
  // Avoid walking a multi-million-entry gap when only a small sample is needed.
  for (let value = minIndex; value <= maxIndex && missingIndexSample.length < sampleSize; value++) {
    if (!present.has(value)) missingIndexSample.push(value);
  }
  return { observedCount: numeric.length, minIndex, maxIndex, unobservedIndexesInRange, missingIndexSample };
}

export function buildRawArchive({ entries, startedAt, stoppedAt, conflicts = [], failures = [], interrupted = false }) {
  const ordered = [...entries].sort((a, b) => a.dataIndex - b.dataIndex);
  const coverage = indexCoverage(ordered.map(item => item.dataIndex));
  return {
    schemaVersion: "0.1.5-raw-preview",
    platform: "douyin",
    source: "user-visible-webpage-dom",
    scope: "one-open-chat-list",
    capturedAt: stoppedAt,
    capture: {
      status: "partial",
      oldestBoundaryConfirmed: false,
      reason: "尚未验证最早历史边界、平台消息 ID、消息分类与时间/发送者归属；虚拟列表索引连续不等于历史消息完整。",
      startedAt,
      stoppedAt,
      interrupted,
      ...coverage,
      entriesWithNoVisibleText: ordered.filter(item => !item.visibleText).length,
      conflictingIndexes: [...conflicts].sort((a, b) => a - b),
      failedCaptureIndexes: [...failures].sort((a, b) => a - b)
    },
    voiceTranscription: {
      status: "not-verified",
      source: "douyin-native-only",
      reason: "当前试验版未识别语音条目，也未自动调用平台转文字功能。"
    },
    privacy: "文件包含真实私聊内容，仅保存在本机；请勿上传至公开 GitHub、Issue 或聊天窗口。",
    entries: ordered
  };
}

export function renderRawText(archive) {
  const lines = [
    "抖音聊天列表原始采集 · 实验预览",
    "注意：本文件不是已验证完整的消息备份。",
    `采集范围：${archive.capture.minIndex ?? "?"}–${archive.capture.maxIndex ?? "?"}；观察条目：${archive.capture.observedCount}`,
    `未观察索引：${archive.capture.unobservedIndexesInRange}；冲突索引：${archive.capture.conflictingIndexes.length}`,
    "语音转写：未验证",
    ""
  ];
  for (const entry of archive.entries) {
    lines.push(`[列表位置 ${entry.dataIndex} · 未识别发送者/时间 · ${entry.capturedAt}]`);
    lines.push(entry.visibleText || "[无可见文字；可能是图片、语音或其他非文本条目]");
    const nonText = Object.entries(entry.mediaMarkers ?? {}).filter(([, count]) => count > 0);
    if (nonText.length) lines.push(`[页面媒体标记：${nonText.map(([name, count]) => `${name}=${count}`).join("，")}]`);
    lines.push("");
  }
  return lines.join("\n");
}
