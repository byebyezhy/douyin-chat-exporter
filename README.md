# 抖音聊天导出助手(网页插件版) / Douyin Chat Exporter

一个开源的 Chrome / Edge 扩展：由用户在抖音网页版自行登录，选择**一个会话**，将其**完整历史消息**导出到自己的电脑。
想法来自于跟女朋友在抖音里大量对话想保存下来留做纪念，但抖音并没有提供这个功能。github上有个开源项目但我感觉部署对于新手来说过于复杂。
所以就有了这个想法自己开发一个简易的插件版工具

使用很简单
1，下载最新版本插件包，需要注意的是解压的时候要解压两次，直到看见几个具体文件为止
2，在chrome/edge里面加载插件的文件夹
3，打开www.douyin.com，登录帐号进入到聊天主界面
4，启动插件，点击API导出
5，选择需要导出的会话名单，用上翻功能翻到最上面，启动，程序会自动导出文本，并且会转写语音记录
6，此版本会自动忽略红包记录，转发的视频记录。

## 参考项目

- [TeamBreakerr/douyin-chat-export](https://github.com/TeamBreakerr/douyin-chat-export)：已有独立服务形式的历史消息采集和媒体处理实现，可研究其公开技术方案。
- [Chrome `scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting)

本仓库目前没有复制参考项目代码。后续若使用第三方代码，应先确认许可证、标注出处并遵守义务。

## 提醒

本工具只处理用户本人已获授权访问的聊天。抖音网页与消息接口可能变更；历史消息是否仍保留、是否可读取，要以实际服务端分页返回为准。

License: MIT（详见仓库 LICENSE）。
