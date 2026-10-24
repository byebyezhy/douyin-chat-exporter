import test from "node:test";
import assert from "node:assert/strict";
import { indexCoverage, buildRawArchive, renderRawText } from "../src/raw-capture.mjs";

test("763 个连续位置没有观察空缺，但不能视为消息完整", () => {
  const coverage = indexCoverage(Array.from({ length: 763 }, (_, i) => i));
  assert.equal(coverage.observedCount, 763);
  assert.equal(coverage.unobservedIndexesInRange, 0);
  const archive = buildRawArchive({
    entries: [{ dataIndex: 0, visibleText: "测试", capturedAt: "test", mediaMarkers: {} }],
    startedAt: "start", stoppedAt: "stop"
  });
  assert.equal(archive.capture.status, "partial");
  assert.equal(archive.capture.oldestBoundaryConfirmed, false);
  assert.equal(archive.voiceTranscription.status, "not-verified");
});

test("空集合和缺口准确列示", () => {
  assert.equal(indexCoverage([]).minIndex, null);
  assert.deepEqual(indexCoverage([5, 5, 7]), {
    observedCount: 2, minIndex: 5, maxIndex: 7,
    unobservedIndexesInRange: 1, missingIndexSample: [6]
  });
});

test("较大索引代表更早列表项，JSON 和 TXT 均按从旧到新输出", () => {
  const archive = buildRawArchive({
    entries: [
      { dataIndex: 2, visibleText: "最早消息", capturedAt: "T2", mediaMarkers: { img: 1 }, captureConfidence: "stable" },
      { dataIndex: 0, visibleText: "最新消息", capturedAt: "T0", mediaMarkers: {}, captureConfidence: "provisional" },
      { dataIndex: 1, visibleText: "中间消息", capturedAt: "T1", mediaMarkers: {}, captureConfidence: "stable" }
    ],
    startedAt: "start", stoppedAt: "stop", confirmedConflicts: [2], transientChanges: [1, 2]
  });
  assert.deepEqual(archive.entries.map(item => item.dataIndex), [2, 1, 0]);
  assert.equal(archive.exportOrder, "oldest-first-by-observed-virtual-index");
  assert.deepEqual(archive.capture.confirmedConflictIndexes, [2]);
  assert.deepEqual(archive.capture.transientTextVariationIndexes, [1, 2]);
  assert.equal(archive.capture.stableEntries, 2);
  assert.equal(archive.capture.provisionalEntries, 1);
  const txt = renderRawText(archive);
  assert.ok(txt.indexOf("最早消息") < txt.indexOf("中间消息"));
  assert.ok(txt.indexOf("中间消息") < txt.indexOf("最新消息"));
  assert.match(txt, /未识别发送者\/时间/);
});
