import test from "node:test";
import assert from "node:assert/strict";
import "../extension/im-core.js";

const im = globalThis.__DOUYIN_IM_CORE_V040__;
const field = im.field;
const bytes = chunks => im.concat(chunks);

function makeMessage({ id, timestamp, text = "", conv = "0:1:101:102", voice = false }) {
  const content = voice
    ? { aweType: 0, duration: 6000, resource_url: { uri: "voice://synthetic", skey: "" } }
    : { aweType: 700, text };
  return bytes([
    field(1, conv, 2), field(3, id), field(4, timestamp),
    field(5, timestamp), field(6, 7), field(7, 101),
    field(8, JSON.stringify(content), 2), field(14, "sec_synthetic", 2)
  ]);
}
function reply(messages, hasMore, nextTs) {
  const payload = bytes([
    ...messages.map(message => field(1, message, 2)),
    field(2, nextTs), field(3, hasMore ? 1 : 0)
  ]);
  return field(6, field(301, payload, 2), 2);
}

test("独立 protobuf 编解码保留 uint64，不以虚拟索引伪造稳定 ID", () => {
  const body = im.buildHistoryRequest("0:1:101:102", "987654321098765432", "9999999999999999");
  assert.deepEqual(im.inspectHistoryRequest(body), {
    convId: "0:1:101:102", shortId: "987654321098765432"
  });
  const snowflake = ((1700000000n << 32n) | 42n).toString();
  const message = makeMessage({ id: snowflake, timestamp: "1672502400010000", text: "模拟文字" });
  const parsed = im.decodeHistoryResponse(reply([message], false, "1690000000000000"));
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].serverId, snowflake);
  assert.equal(parsed.messages[0].createdAtUs, "1672502400010000");
  assert.equal(parsed.hasMore, false);
  const row = im.normalizeMessage(parsed.messages[0], 0, "101");
  assert.equal(row.sender, "self");
  assert.equal(row.type, "text");
  assert.equal(row.visibleText, "模拟文字");
  assert.equal(row.createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(row.serverCreatedAtUs, "1672502400010000");
  assert.equal(row.timeEvidence, "server-id-high32-unix-seconds");
});

test("协议中的 created_at_us 是顺序键，不能误认为消息时间；无效 snowflake 不伪造日期", () => {
  assert.equal(im.timestampFromServerId(((1792175566n << 32n) | 1234n).toString()),
    "2026-10-16T18:32:46.000Z");
  assert.equal(im.timestampFromServerId("23"), null);
  assert.equal(im.timestampFromServerId("invalid"), null);
  const row = im.normalizeMessage({
    convId: "c", serverId: "23", createdAtUs: "1672502400010000",
    contentJson: JSON.stringify({ text: "无可靠时间" })
  }, 0);
  assert.equal(row.createdAt, null);
  assert.equal(row.timeEvidence, "unverified");
});

test("语音请求绑定服务端消息 ID，分批响应不能将转写串到别的消息", () => {
  const msg = im.decodeHistoryResponse(reply([
    makeMessage({ id: "23", timestamp: "1700000000000000", voice: true })
  ], false, "1")).messages[0];
  const row = im.normalizeMessage(msg, 0, "102");
  assert.equal(row.type, "voice");
  assert.equal(row.voiceDurationSeconds, 6);
  const request = im.voiceRequest(msg, row, "123", "device-test-uuid");
  assert.deepEqual(Object.keys(request), ["uri", "sec_uid", "uuid", "message_id", "message_type", "skey", "conv_short_id"]);
  assert.equal(request.message_id, "23");
  assert.equal(im.matchTranscriptions({ status_code: 0, data: { res_list: [
    { message_id: "23", text_result: "测试转写" }
  ] } }, [request])[0].text, "测试转写");
  const wrong = im.matchTranscriptions({ status_code: 0, data: { res_list: [
    { message_id: "different", text_result: "他人的语音" }
  ] } }, [request]);
  assert.equal(wrong[0].status, "failed");
  assert.equal(wrong[0].text, "");
});

test("截断的协议数据和丢失分页标识明确失败", () => {
  assert.throws(() => im.fields(new Uint8Array([0x0a, 0xff, 0xff])), /varint|length/);
  assert.throws(() => im.decodeHistoryResponse(reply([], true, "0").subarray(1)), /protobuf|message/);
  assert.throws(() => im.buildHistoryRequest("", "123"), /unverified/);
});

test("图像附件不能误认成语音，识别参数缺失必须标注不可用", () => {
  const base = { convId: "test", serverId: "123", createdAtUs: "1700000000000000", sequence: "1", senderUid: "8", contentJson: JSON.stringify({
    aweType: 2702, duration: 1000, resource_url: { uri: "image-uri" }
  }) };
  const row = im.normalizeMessage(base, 0);
  assert.equal(row.type, "image");
  assert.equal(im.voiceRequest(base, row, "123", "uuid"), null);
});

test("原生语音接口返回空文本、错误状态或缺少消息 ID 时不能虚报识别成功", () => {
  const req = ["23", "24"].map(message_id => ({ message_id }));
  const results = im.matchTranscriptions({ status_code: 0, data: { res_list: [
    { message_id: "23", text_result: "   " },
    { message_id: "24", status_code: 4001, text_result: "不应显示" }
  ] } }, req);
  assert.equal(results[0].status, "failed");
  assert.equal(results[1].status, "failed");
  assert.equal(results[1].text, "");
  const mismatch = im.matchTranscriptions({ status_code: 0, data: { res_list: [
    { message_id: "25", text_result: "另一个人的识别" },
    { text_result: "无绑定 ID 的识别" }
  ] } }, req);
  assert.deepEqual(mismatch.map(item => item.status), ["failed", "failed"]);
});
