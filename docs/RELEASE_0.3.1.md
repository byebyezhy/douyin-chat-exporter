# v0.3.1：修复 debugger 授权失败（双安装包）

## 验证事实（没有公开聊天正文）

- 用户在 Edge 进行 v0.3 半程测试，反馈「启用增强语音右键」仍提示权限未授权。
- 本地 JSON 统计：338 个列表项、索引 0–337 连续、338 条快照稳定、0 个采集失败；17 条被分类为 voice，0 条转写成功，17 条 `manual_required`。历史终点未访问，`partial` 状态正确。
- 由官方 Chrome 扩展权限文档确认，`debugger` 属于**不可声明为运行时 optional 的权限**，因此先前 `chrome.permissions.request()` 方案不可行。

## 修正方式

不扩大所有用户的默认权限，而是由同一源码生成两种不能同时安装的发行包：

| 安装包 | 必需权限 | 语音操作 |
| --- | --- | --- |
| `douyin-chat-exporter-standard` | `activeTab`, `scripting`, `storage` | 文字自动导出；原生语音需用户自己点击右键再重扫 |
| `douyin-chat-exporter-enhanced` | 以上权限 + `debugger` | 安装时获浏览器授权，并经用户在扩展弹窗开启后，通过有限鼠标事件尝试原生语音右键与转写 |

新增构建产物的权限检查和测试。增强版仍只允许当前抖音网页请求 `Input.dispatchMouseEvent`，不执行抓包、远程代码或第三方语音识别。

**注意：** 用户主动关闭增强操作仅切换功能开关；强权限会一直存在于已安装的增强版中。如需收回 debugger 权限，请卸载增强版，改安装普通版。真实 Edge 自动右键与文字归属仍未完成验收。

官方依据：[Chrome permissions API — Permissions that can not be specified as optional](https://developer.chrome.com/docs/extensions/reference/api/permissions)。
