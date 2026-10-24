/* Independent, dependency-free parser for the observed Douyin web IM wire format.
 * Non-public protocol: reject malformed responses, never guess IDs/cursors.
 */
(() => {
  "use strict";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const MAX_BYTES = 16 * 1024 * 1024;
  const toBig = value => {
    const n = BigInt(value);
    if (n < 0n || n > (1n << 64n) - 1n) throw new Error("invalid uint64");
    return n;
  };
  function varint(value) {
    let n = toBig(value);
    const bytes = [];
    do { const low = Number(n & 127n); n >>= 7n; bytes.push(low | (n ? 128 : 0)); } while (n);
    return Uint8Array.from(bytes);
  }
  function concat(chunks) {
    const len = chunks.reduce((n, a) => n + a.length, 0);
    if (len > MAX_BYTES) throw new Error("protobuf too large");
    const result = new Uint8Array(len);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
  function field(number, value, wire = 0) {
    const tag = varint(number * 8 + wire);
    if (wire === 0) return concat([tag, varint(value)]);
    if (wire === 2) {
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      if (!(bytes instanceof Uint8Array)) throw new Error("invalid byte field");
      return concat([tag, varint(bytes.length), bytes]);
    }
    throw new Error("unsupported field wire");
  }
  function fields(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) throw new Error("invalid protobuf buffer");
    const out = [];
    let pos = 0;
    function readVarint() {
      let value = 0n;
      for (let i = 0; i < 10; i++) {
        if (pos >= bytes.length) throw new Error("truncated protobuf varint");
        const byte = bytes[pos++];
        if (i === 9 && byte > 1) throw new Error("overflow protobuf varint");
        value |= BigInt(byte & 127) << BigInt(i * 7);
        if (!(byte & 128)) return value;
      }
      throw new Error("oversize protobuf varint");
    }
    while (pos < bytes.length) {
      const tag = readVarint();
      const number = Number(tag >> 3n);
      const wire = Number(tag & 7n);
      if (!Number.isSafeInteger(number) || number < 1 || number > 10000) throw new Error("invalid protobuf tag");
      let value;
      if (wire === 0) value = readVarint();
      else if (wire === 2) {
        const len = Number(readVarint());
        if (!Number.isSafeInteger(len) || len < 0 || len > bytes.length - pos) throw new Error("invalid protobuf length");
        value = bytes.subarray(pos, pos + len);
        pos += len;
      } else if (wire === 1 || wire === 5) {
        const len = wire === 1 ? 8 : 4;
        if (pos + len > bytes.length) throw new Error("truncated fixed field");
        pos += len;
        continue;
      } else throw new Error("unsupported protobuf wire type");
      out.push({ number, wire, value });
    }
    return out;
  }
  const one = (items, number, wire) => items.find(item => item.number === number && item.wire === wire)?.value;
  const str = bytes => bytes ? decoder.decode(bytes) : "";
  function buildHistoryRequest(convId, shortId, timestamp = "9999999999999999") {
    if (!/^[\w:.-]{3,160}$/.test(convId) || !/^\d{1,22}$/.test(String(shortId))) throw new Error("unverified conversation identifiers");
    const query = concat([
      field(1, convId, 2), field(2, 1), field(3, shortId), field(4, 1),
      field(5, timestamp), field(6, 50)
    ]);
    return concat([
      field(1, 301), field(2, 10027), field(3, "0.1.6", 2), field(4, "", 2),
      field(5, 3), field(6, 0), field(7, "fef1a80:p/lzg/store", 2),
      field(8, field(301, query, 2), 2), field(9, "0", 2),
      field(11, "douyin_pc", 2), field(14, "360000", 2), field(18, 1),
      field(21, "douyin_pc", 2)
    ]);
  }
  function inspectHistoryRequest(bytes) {
    const body = one(fields(bytes), 8, 2);
    const query = body && one(fields(body), 301, 2);
    if (!query) return null;
    const data = fields(query);
    const convId = str(one(data, 1, 2));
    const shortId = one(data, 3, 0)?.toString() ?? "";
    return convId && /^[1-9]\d*$/.test(shortId) ? { convId, shortId } : null;
  }
  function decodeMessage(data) {
    const list = fields(data);
    const serverId = one(list, 3, 0)?.toString() || "";
    return {
      convId: str(one(list, 1, 2)),
      serverId,
      createdAtUs: one(list, 4, 0)?.toString() || "",
      sequence: one(list, 5, 0)?.toString() || "",
      typeCode: Number(one(list, 6, 0) ?? 0),
      senderUid: one(list, 7, 0)?.toString() || "",
      senderSecUid: str(one(list, 14, 2)),
      contentJson: str(one(list, 8, 2)),
      recalled: Number(one(list, 11, 0) ?? 0) === 1
    };
  }
  function decodeHistoryResponse(bytes) {
    const envelope = one(fields(bytes), 6, 2);
    const body = envelope && one(fields(envelope), 301, 2);
    if (!body) throw new Error("IM response missing message payload");
    const list = fields(body);
    const messages = list.filter(item => item.number === 1 && item.wire === 2).map(item => decodeMessage(item.value));
    const nextTs = one(list, 2, 0)?.toString() ?? null;
    const hasMore = one(list, 3, 0) === 1n;
    if (hasMore && (!nextTs || !/^\d+$/.test(nextTs))) throw new Error("IM pagination cursor missing");
    return { messages, nextTs, hasMore };
  }
  function normalizeMessage(message, dataIndex, selfUid = "") {
    let body = {};
    try { body = JSON.parse(message.contentJson || "{}"); } catch { /* keep unparsed data non-text */ }
    if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    const resource = body.resource_url && typeof body.resource_url === "object" ? body.resource_url : {};
    const duration = body.duration ?? resource.duration;
    const hasVoice = Boolean((duration !== null && duration !== undefined && duration !== "") &&
      (resource.uri || resource.url || resource.tkey || body.tkey) &&
      ![2702, 2703, 2704].includes(Number(body.aweType)) && !body.video?.vid);
    const aweType = Number(body.aweType);
    const type = hasVoice ? "voice" : [2702, 2703, 2704].includes(aweType) ? "image" :
      [11054, 11055, 11063, 11066, 11067, 11069, 11070, 11029, 10500, 10401].includes(aweType) ? "other" :
        (typeof body.text === "string" && body.text.length > 0) ? "text" : "unknown_media";
    const visibleText = type === "text" ? body.text :
      type === "voice" ? `${Math.max(0, Math.round(Number(duration) / 1000))}\"` : "";
    const timestamp = /^\d{1,18}$/.test(message.createdAtUs)
      ? new Date(Number(BigInt(message.createdAtUs) / 1000n)) : null;
    return {
      dataIndex, platformMessageId: message.serverId || null,
      messageIdConfidence: message.serverId ? "verified" : "unavailable",
      recordKind: "im-server-message", visibleText, type,
      sender: selfUid ? (message.senderUid === selfUid ? "self" : "peer") : "unknown",
      senderConfidence: selfUid ? "server-id" : "unverified",
      createdAt: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null,
      serverCreatedAtUs: message.createdAtUs,
      serverSequence: message.sequence,
      timeEvidence: "server-created_at_us", captureConfidence: "stable",
      capturedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
      ...(hasVoice ? {
        voiceDurationSeconds: Number(duration) / 1000,
        voiceResource: {
          uri: resource.uri || resource.url || body.tkey || "",
          skey: resource.skey || body.skey || "",
          secUid: message.senderSecUid
        },
        voiceTranscript: { status: "pending", source: "douyin-native-api" }
      } : {})
    };
  }
  function voiceRequest(message, entry, convShortId, selfUuid) {
    if (entry.type !== "voice" || !entry.voiceResource?.uri ||
      !entry.voiceResource?.secUid || !entry.platformMessageId || !selfUuid || !convShortId) return null;
    return {
      uri: entry.voiceResource.uri,
      sec_uid: entry.voiceResource.secUid,
      uuid: selfUuid,
      message_id: entry.platformMessageId,
      message_type: 7,
      skey: entry.voiceResource.skey || "",
      conv_short_id: convShortId
    };
  }
  function matchTranscriptions(reply, requests) {
    if (!reply || typeof reply !== "object" || ![0, 200].includes(Number(reply.status_code ?? 0))) {
      throw new Error("native recognition returned an API error");
    }
    function extract(value, depth = 0) {
      if (depth > 5 || value == null) return [];
      if (Array.isArray(value)) return value.flatMap(item => extract(item, depth + 1));
      if (typeof value === "string") return [{ text_result: value }];
      if (typeof value !== "object") return [];
      if (typeof value.text_result === "string") return [value];
      for (const key of ["res_list", "recognition_results", "result", "results", "data", "items", "list", "req_list"]) {
        if (value[key] != null) {
          const found = extract(value[key], depth + 1);
          if (found.length) return found;
        }
      }
      return Object.entries(value).flatMap(([id, item]) =>
        /^\d{8,}$/.test(id) && typeof item === "string" ? [{ message_id: id, text_result: item }] : []);
    }
    const results = extract(reply);
    const explicit = results.filter(item => item && (item.message_id || item.msg_id));
    const named = new Map(explicit.map(item => [String(item.message_id || item.msg_id), item]));
    const positionalAllowed = !explicit.length && results.length === requests.length;
    return requests.map((request, index) => {
      const item = named.get(String(request.message_id)) || (positionalAllowed ? results[index] : null);
      const text = typeof item?.text_result === "string" ? item.text_result.trim() : "";
      const statusCode = item?.status_code ?? item?.error_code;
      const apiFailed = statusCode != null && ![0, 200].includes(Number(statusCode));
      return {
        messageId: String(request.message_id),
        status: text && !apiFailed ? "success" : "failed",
        text: !apiFailed ? text : ""
      };
    });
  }
  globalThis.__DOUYIN_IM_CORE_V040__ = Object.freeze({
    field, fields, concat, buildHistoryRequest, inspectHistoryRequest, decodeHistoryResponse,
    normalizeMessage, voiceRequest, matchTranscriptions
  });
})();
