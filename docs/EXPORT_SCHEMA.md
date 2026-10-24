# 第一版导出 JSON 草案

## v0.2.0 功能候选格式

实际导出 `schemaVersion: "0.2.0-rc.1"`，包含：

- `conversation.localTag`：用户在本机指定的会话标签，**不是平台会话 ID**。
- `exportOrder: "oldest-first-by-observed-virtual-index"`：当前网页版验证的阅读方向。
- `capture`：`state/reason/startedFromNewest/oldestBoundaryEvidence/verifiedPlatformMessageIds/observedCount/minIndex/maxIndex/gapCount/stableEntries/provisionalEntries` 等。
- `voiceTranscription`：`source: "douyin-native-only"` 以及 `total/success/pending/failed/manual_required/unavailable/unknownTypeEntries`。成功只针对识别出来的语音，不保证覆盖所有隐形语音。
- `entries[]`：`dataIndex, platformMessageId, messageIdConfidence, visibleText, type, sender, senderConfidence, createdAt, timeEvidence, mediaMarkers, captureConfidence, voiceTranscript`。缺失值为 `null` 或 `unknown`，不伪造 ID 和时间。

已知限制：不提供媒体二进制备份。页面末端只被视觉识别时，`capture.state` 不得标为 `complete`。

---

> 字段会在 M0 真实页面验证后确定。以下是**合成示例**，不包含实际聊天或平台凭据。

```json
{
  "schemaVersion": "0.1.0",
  "platform": "douyin",
  "conversation": { "id": "synthetic-conv-001", "displayName": "示例联系人" },
  "capture": {
    "status": "complete",
    "oldestBoundaryConfirmed": true,
    "capturedAt": "2026-10-24T12:00:00+08:00",
    "messageCount": 2
  },
  "voiceTranscription": {
    "status": "complete",
    "source": "douyin-native",
    "total": 1,
    "success": 1,
    "failed": 0,
    "pending": 0,
    "unavailable": 0
  },
  "messages": [
    {
      "messageId": "synthetic-msg-001",
      "type": "text",
      "sender": "self",
      "createdAtUs": "1792824000000000",
      "text": "这是合成测试数据。"
    },
    {
      "messageId": "synthetic-msg-002",
      "type": "voice",
      "sender": "peer",
      "createdAtUs": "1792824001000000",
      "voiceTranscript": {
        "source": "douyin-native",
        "status": "success",
        "text": "这是由抖音自身功能转出的示例文字。"
      },
      "media": { "status": "metadata_only" }
    }
  ]
}
```

要求：

- 消息数据的完整性与语音转写完整性两个状态分开报告。
- 一条语音即使转写失败，也不能从 `messages` 中消失。
- 时间统一带明确单位；消息 ID 原样保留为字符串，避免 64 位整数精度问题。
- 不对 `unknown` 消息类型做臆测，保留原始类型及失败说明。
- 扩展导出的内容绝不发送到开发者的远程服务器。
