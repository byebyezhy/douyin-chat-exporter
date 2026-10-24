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
  assert.equal(core.typeFromSignals({ visibleText: '28"', canvas: 1 }), "voice");
  assert.equal(core.typeFromSignals({ visibleText: '1"', canvas: 0 }), "text");
  assert.equal(core.typeFromSignals({ visibleText: "你好", canvas: 1 }), "text");
  assert.equal(core.typeFromSignals({ canvas: 1 }), "unknown_media");
  assert.equal(core.typeFromSignals({ largeImages: 1 }), "image");
  assert.equal(core.typeFromSignals({ visibleText: "你好" }), "text");
});

test("阅读版去掉索引/时间未知/媒体计数，保留文字与语音并合并其他消息", () => {
  const archive = core.buildArchive({
    entries: [
      row(5, { visibleText: "你好", sender: "peer" }),
      row(4, { type: "image", visibleText: "", mediaMarkers: { image: 2 } }),
      row(3, { type: "unknown_media", visibleText: "" }),
      row(2, { type: "voice", visibleText: '28"\n我来了', voiceTranscript: { status: "success", text: "我来了" }, sender: "self" }),
      row(1, { type: "voice", visibleText: '6"', voiceTranscript: { status: "manual_required" } }),
      row(0, { visibleText: "再见", sender: "self" })
    ],
    conversationTag: "演示", createdAt: "start", stoppedAt: "stop", runtime: {}
  });
  const text = core.renderReadableTxt(archive);
  assert.match(text, /对方：你好/);
  assert.match(text, /〔其他消息 × 2〕/);
  assert.match(text, /我：🎤 我来了/);
  assert.match(text, /1 条语音尚未转成文字/);
  assert.doesNotMatch(text, /索引|时间未知|媒体标记|28"|6"/);
  assert.ok(text.indexOf("你好") < text.indexOf("我来了"));
});

test("离线 HTML 阅读版对私聊文字严格转义，不含远程资源", () => {
  const archive = core.buildArchive({
    entries: [row(0, { visibleText: '<script>alert("danger")</script> & test' })],
    runtime: {}, conversationTag: "测试", createdAt: "start", stoppedAt: "stop"
  });
  const html = core.renderReadableHtml(archive);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes('<script>alert("danger")</script>'));
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script\b|https?:\/\//i);
});

test("阅读版按北京时间跨日分隔并为正文和语音标注真实分钟，旧版缺失时间不猜测", () => {
  const archive = core.buildArchive({
    entries: [
      row(3, { sender: "peer", visibleText: "昨天最后一条", createdAt: "2026-10-23T15:59:00.000Z" }),
      row(2, { sender: "self", visibleText: "今天第一条", createdAt: "2026-10-23T16:01:00.000Z" }),
      row(1, { sender: "peer", type: "voice", visibleText: '8"',
        voiceTranscript: { status: "success", text: "收到" }, createdAt: "2026-10-23T16:12:00.000Z" }),
      row(0, { sender: "self", visibleText: "没有可靠时间", createdAt: null })
    ],
    runtime: {}, conversationTag: "日期测试", createdAt: "start", stoppedAt: "stop"
  });
  const txt = core.renderReadableTxt(archive);
  assert.match(txt, /──── 2026年10月23日 ────[\s\S]*\[23:59\] 对方：昨天最后一条/);
  assert.match(txt, /──── 2026年10月24日 ────[\s\S]*\[00:01\] 我：今天第一条/);
  assert.match(txt, /\[00:12\] 对方：🎤 收到/);
  assert.match(txt, /我：没有可靠时间/);
  assert.equal((txt.match(/2026年10月24日/g) || []).length, 1);
  assert.doesNotMatch(txt, /时间未知|\[索引/);
  const html = core.renderReadableHtml(archive);
  assert.match(html, /2026年10月24日/);
  assert.match(html, /class="timestamp">00:12<\/div>/);
  assert.match(html, /较早 → 较近 · 北京时间/);
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
