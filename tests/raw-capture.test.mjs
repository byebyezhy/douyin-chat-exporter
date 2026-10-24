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

test("导出按列表位置排序，不臆造发送者或时间", () => {
  const archive = buildRawArchive({
    entries: [
      { dataIndex: 2, visibleText: "第二条", capturedAt: "T2", mediaMarkers: { img: 1 } },
      { dataIndex: 1, visibleText: "第一条", capturedAt: "T1", mediaMarkers: {} }
    ],
    startedAt: "start", stoppedAt: "stop", conflicts: [2]
  });
  assert.deepEqual(archive.entries.map(item => item.dataIndex), [1, 2]);
  assert.deepEqual(archive.capture.conflictingIndexes, [2]);
  const txt = renderRawText(archive);
  assert.ok(txt.indexOf("第一条") < txt.indexOf("第二条"));
  assert.match(txt, /未识别发送者\/时间/);
});
