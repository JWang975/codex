# Speak flow 1.0 Release Notes

## 下载

- 文件：`Speak-flow-1.0-macOS-arm64.zip`
- 平台：macOS Apple Silicon
- 应用：`Speak flow.app`
- SHA-256：`cf911619f9f592d233d00aed73097e8f7194a2585b4ec4e00620fa2313e393ea`

## 主要功能

- 按 Fn 开始/停止语音输入。
- 支持响指声音触发。
- 支持打开摄像头后用手掌触发。
- 支持 Azure OpenAI Whisper 转写。
- 支持 DeepSeek 智能整理。
- 支持原文、润色、翻译、待办四种常用输出方式。
- 转写完成后自动插入当前光标位置。
- 顶部菜单和主面板状态同步。

## 首次运行权限

需要在 macOS 系统设置中允许：

- 麦克风
- 摄像头
- 辅助功能
- 输入监控

如果提示应用来自未知开发者，可执行：

```bash
xattr -cr "Speak flow.app"
open "Speak flow.app"
```

## 配置

应用不会内置 API key。首次使用云端转写和智能整理时，在设置中填写：

- Azure OpenAI Whisper endpoint / deployment / API key
- DeepSeek base URL / model / API key
