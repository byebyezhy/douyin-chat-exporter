# v0.4.0：API-first 历史和语音转写候选版

## 背景与依据

参考 [TeamBreakerr/douyin-chat-export](https://github.com/TeamBreakerr/douyin-chat-export) 对抖音 IM Protobuf 历史接口、语音识别 API 和单聊 short ID 的研究。独立实现浏览器 JavaScript 编解码与面板，没有直接拷贝其 Python 源码（目前未在其根目录发现 LICENSE，后续代码复用仍须核对许可证）。

## 实现范围

- `im-core.js`：有限制的 uint64/Protobuf 编解码、服务端消息 ID/微秒时间解析、语音资源识别、原生语音批量请求与结果严格对齐。
- `im-page-bridge.js`：只在 `www.douyin.com` 主页面运行；在用户主动启动后监听抖音自身 IM 请求里的会话 ID/short ID，并在匹配当前选中会话时调用平台原生历史/语音 API。关闭面板时会还原观察用的 XHR 包装函数。
- `im-export.js`：独立的导出面板，开始/暂停/继续/停止、同会话本地断点、服务端时间正序、TXT/HTML/JSON 及明确的完整性/转写状态。
- 旧版 `full-export.js` 仍保留作为正文已验证的 DOM 兼容模式。发布包只需 `activeTab`、`scripting`、`storage`；不包含 debugger 服务线程。

## 待真实网页验证

1. 单聊的 short ID 可能因为 SDK 缓存而不重新发请求，不能通过猜测恢复；插件会要求用户切换会话触发请求，失败时停在等待状态。
2. 抖音 IM 的非公开 Protobuf 字段、CORS、登录态和接口响应结构可能变化。Node 合成测试不能证明已在真实账号成功请求。
3. 原生语音 API 需要 URI、message_id、sec_uid、short ID、用户 UUID 等真实参数；字段缺失会记为 `unavailable`，不会伪造文本。
4. 真实测试只能反馈脱敏结构统计、错误码或字段名；不得公开完整 JSON、聊天正文、会话 ID、Cookie/Token。

只访问用户当前有权查看的聊天数据，不绕过站点安全验证或限制。
