import test from "node:test";
import assert from "node:assert/strict";
import "../extension/export-core.js";

const core = globalThis.__DOUYIN_EXPORT_CORE_V020__;
const row = (dataIndex, extra = {}) => ({
  dataIndex, visibleText: `文字${dataIndex}`, captureConfidence: "stable",
  platformMessageId: null, sender: "unknown", type: "text", ...extra
});

test("自动采集仍不能凭连续 index 谎称完整", () => {
  const archive = core.buildArchive({
    entries: Array.from({ length: 763 }, (_, dataIndex) => row(dataIndex)),
    runtime: { startedFromNewest: true, oldestBoundaryEvidence: "visual-end", conversationGuardVerified: false },
    conversationTag: "测试会话", createdAt: "start", stoppedAt: "stop"
  });
  assert.equal(archive.capture.gapCount, 0);
  assert.equal(archive.capture.state, "partial");
  assert.deepEqual(archive.entries.slice(0, 2).map(x => x.dataIndex), [762, 761]);
  assert.equal(archive.entries.at(-1).dataIndex, 0);
  assert.match(core.renderTxt(archive), /采集状态：partial/);
});

test("观察缺口、采集失败必须报告不完整", () => {
  const result = core.summarize([row(0), row(2)], { oldestBoundaryEvidence: "explicit-ui-no-more", failures: [1] });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.missingSample, [1]);
});

test("没有验证的消息 ID，哪怕有可见最早边界也不报 complete", () => {
  const state = core.summarize([row(0)], {
    oldestBoundaryEvidence: "explicit-ui-no-more", startedFromNewest: true, conversationGuardVerified: true
  });
  assert.equal(state.state, "partial");
});

test("消息类型识别谨慎，未知媒体不冒充文字", () => {
  assert.equal(core.typeFromSignals({ voiceHint: true, visibleText: "12秒" }), "voice");
  assert.equal(core.typeFromSignals({ canvas: 1 }), "unknown_media");
  assert.equal(core.typeFromSignals({ largeImages: 1 }), "image");
  assert.equal(core.typeFromSignals({ visibleText: "你好" }), "text");
});

test("时间解析不猜测没有时区的日期", () => {
  assert.equal(core.parseTime("2026-10-24 12:30"), null);
  assert.equal(core.parseTime("1792824000000"), "2026-10-24T06:40:00.000Z");
});

test("语音转写和未知类型分别计数，不把全部归为成功", () => {
  const stats = core.voiceSummary([
    row(0, { type: "voice", voiceTranscript: { status: "success", text: "您好" } }),
    row(1, { type: "voice", voiceTranscript: { status: "manual_required" } }),
    row(2, { type: "unknown_media" })
  ]);
  assert.equal(stats.total, 2);
  assert.equal(stats.success, 1);
  assert.equal(stats.manual_required, 1);
  assert.equal(stats.unknownTypeEntries, 1);
  assert.equal(stats.state, "partial");
});
