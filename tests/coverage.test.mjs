import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCoverage, evaluateVoiceTranscriptions, mergeMessagesById } from "../src/coverage.mjs";

test("没有到达历史边界不能声称完整", () => {
  assert.equal(evaluateCoverage({ reachedOldestBoundary: false }).state, "partial");
});

test("已到边界但分页失败仍是不完整", () => {
  assert.equal(evaluateCoverage({ reachedOldestBoundary: true, failedPages: 1 }).state, "incomplete");
});

test("游标循环导致不完整", () => {
  assert.equal(evaluateCoverage({ reachedOldestBoundary: true, cursorLoop: true }).state, "incomplete");
});

test("无异常且确实到达最早边界才完整", () => {
  assert.equal(evaluateCoverage({ reachedOldestBoundary: true }).state, "complete");
});

test("增量合并依据消息 ID 去重并排序", () => {
  const old = [{ messageId: "b", createdAtUs: "2000", text: "old" }];
  const incoming = [
    { messageId: "a", createdAtUs: "1000", text: "first" },
    { messageId: "b", createdAtUs: "2000", text: "updated" }
  ];
  assert.deepEqual(mergeMessagesById(old, incoming).map(x => x.messageId), ["a", "b"]);
  assert.equal(mergeMessagesById(old, incoming)[1].text, "updated");
});

test("语音转写未完成时不能显示全部完成", () => {
  const messages = [
    { type: "text", text: "hello" },
    { type: "voice", voiceTranscript: { status: "success", text: "你好" } },
    { type: "voice", voiceTranscript: { status: "pending" } }
  ];
  assert.deepEqual(evaluateVoiceTranscriptions(messages), {
    state: "partial", total: 2, success: 1, pending: 1, failed: 0, unavailable: 0
  });
});

test("原生转写失败必须保留失败状态", () => {
  const messages = [{ type: "voice", voiceTranscript: { status: "failed" } }];
  assert.equal(evaluateVoiceTranscriptions(messages).state, "incomplete");
});

test("语音成功状态不能缺文字", () => {
  assert.throws(() => evaluateVoiceTranscriptions([
    { type: "voice", voiceTranscript: { status: "success", text: "" } }
  ]), /必须包含文字/);
});
