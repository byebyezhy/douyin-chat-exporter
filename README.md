# 抖音聊天导出助手 / Douyin Chat Exporter

一个计划中的开源 Chrome / Edge 扩展：由用户在抖音网页版自行登录，选择**一个会话**，将其**完整历史消息**导出到自己的电脑。

> **项目状态：M0 技术验证骨架（尚不支持导出聊天记录）。** 当前扩展只在用户点击时检查抖音网页的基本结构，不读取、保存或发送聊天内容。不要把它当作已完成的备份工具。

## 第一版目标

- 一次处理一个由用户主动选择的会话。
- 自动上翻并逐批保存历史（用户已确认网页版可以翻到最早消息），而不只读取屏幕当前显示的消息；如遇网页虚拟列表/遗漏，再评估当前登录态的分页接口。
- 保留时间、发送者、消息类型、消息 ID、文本、附件元数据和原始平台顺序。
- 语音调用抖音网页内建的右键「转成文字」，将识别结果作为文本写入导出文件；不接第三方语音识别服务。
- 导出 JSON（主格式）以及便于阅读的 TXT。HTML 可在消息一致性验证后加入。
- 未拿到完整历史边界、出现漏抓或语音转写未完成时，**不能报告“全部完成”**；独立呈现历史采集和语音转写两种状态。
- 无云端中转；无需额外账号；无自动发送、自动回复及联系人采集。

详见 [实施计划](docs/IMPLEMENTATION.md)、[验收标准](docs/ACCEPTANCE.md)、[安全规范](docs/SECURITY.md)。

## 本地运行 M0 检测

1. 在 GitHub Actions 的 `CI` 工作流中下载 `douyin-chat-exporter-extension`，或在源码目录执行 `npm run build`。
2. 在 Edge 打开 `edge://extensions`，或在 Chrome 打开 `chrome://extensions`。
3. 开启「开发人员模式」→「加载解压缩的扩展程序」→ 选择 `dist/extension` 文件夹。
4. 在浏览器中自行登录 `https://www.douyin.com/`，打开一位联系人的私信窗口。
5. 点击扩展图标 →「检测当前页面」。只显示统计摘要，不采集对话正文。

Windows 上的 `npm run build` 需要 Node.js 22+；如没有 Node.js，可以直接将 `extension/` 作为解压缩扩展加载。

## 开发与发布

- `main`：经过人工验收的稳定代码。
- `feature/*`：各开发任务分支，经过 Pull Request 审核再合并。
- CI：语法/静态约束检查、单元测试、构建扩展包并上传 Actions artifact。
- 正式版本：完成真实账号验收后手工打 `vX.Y.Z` 标签；不自动向商店发布。

```bash
npm test
npm run build
```

## 参考项目

- [TeamBreakerr/douyin-chat-export](https://github.com/TeamBreakerr/douyin-chat-export)：已有独立服务形式的历史消息采集和媒体处理实现，可研究其公开技术方案。
- [Chrome `scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting)

本仓库目前没有复制参考项目代码。后续若使用第三方代码，应先确认许可证、标注出处并遵守义务。

## 提醒

本工具只处理用户本人已获授权访问的聊天。抖音网页与消息接口可能变更；历史消息是否仍保留、是否可读取，要以实际服务端分页返回为准。

License: MIT（详见仓库 LICENSE）。
