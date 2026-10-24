# v0.4.2：正确的服务端消息时间与历史预滚动

## 时间错误的根因

用户上传的 v0.4.1 JSON 有 861 条消息，但旧算法根据 Protobuf 字段 4 `created_at_us` 计算出全部日期落在 2023-01-01 的约 8.6 秒内。这是协议字段语义错误，与时区无关。

比对公开项目 [TeamBreakerr/douyin-chat-export](https://github.com/TeamBreakerr/douyin-chat-export) 的消息协议研究，字段 4 `created_at_us` 是排序位置，真正的 Unix 秒时间来自十进制 `server_id` 的高 32 位（`BigInt(serverId) >> 32n`）。用用户样本的**结构字段**验证后，时间范围变为 2026-09 至 2026-10，具有真实聊天记录的时间跨度。没有公开或提交用户聊天内容、原始 ID、语音和 JSON。

## 修复范围

- `im-core.js`：从服务器消息 ID 提取 Unix 秒时间，先检查格式、uint64 范围和合理年份；解析失败时不伪造时间。保留原本 `created_at_us` 作为消息顺序键，不再转换成日历日期。
- `im-export.js`：生成最终 JSON/TXT/HTML 时，使用稳定服务器消息 ID 修复旧版 v0.4.0/v0.4.1 API 断点中的历史错误时间；断点格式和原 API 分页/语音策略不改变。
- `chat-scroll.js`：将旧版已经验证的滚动方向和虚拟列表定位逻辑独立成新 helper，仅做启动 API 导出前的 DOM 预备滚动。用户可单独开始/停止，滚动阶段不解析正文、也不会启动 IM 抓取。
- 会话标识由当前抖音页内引擎检查，滚动途中每若干步检查是否换了会话；网页/列表重建、手动停止和步数达到上限时均安全退出。
- 明确区分“网页已经滚到最早可见端”和“服务端 API 证明消息完整”。滚动完成不自动标记历史为 complete。

## 验收

1. 打开要导出的聊天，点击「自动滚动到最早消息」，观察页面逐步翻页；可点击「停止滚动」。
2. 观察会话标识捕获成功，点击原来的「开始 API 历史导出」。
3. 新生成的 JSON `createdAt` 与 `platformMessageId` 高 32 位一致，时间区间合理。服务端消息仍按原 `serverCreatedAtUs` 键排序，避免同一秒内轻微乱序。
4. TXT/HTML 的日期分隔和 `HH:mm` 使用北京时间，语音转写仍保持正确的消息 ID 归属。
5. `npm run check`、`npm test`、`npm run build` 和 GitHub Actions 均通过，且发行包没有 debugger 权限。

本次复用参考项目的协议知识并独立实现 JS，没有直接复制对方源码。
