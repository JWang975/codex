# Speak flow 1.2 Release Notes

## 下载

- 文件：`Speak-flow-1.2-macOS-arm64.dmg`
- 平台：macOS Apple Silicon
- 应用：`Speak flow.app`
- SHA-256：`080d7bca9710a537854b73f54bc2b6e32dac06b40e6740556a2c531551f76ca9`

## 重要说明

本版本在当前机器上只能生成 ad-hoc signed DMG。它不是 Developer ID signed，也没有 notarization，所以 macOS 首次打开时可能需要手动允许。

## 新增与修复

- 新增翻译快捷键，默认 `Left Command + Space`，只让本次录音进入翻译模式。
- 语音输入快捷键默认 `Left Control + Space`，快捷键详情页支持 1 到 3 个按键录入。
- 语音输入和翻译快捷键都提供 `恢复` 操作。
- 翻译目标语言支持中文、English、日本語、Deutsch、Français。
- DeepSeek、Kimi、MiniMax 支持独立模型配置和 Anthropic-compatible Base URL。
- MiniMax 默认使用国际站 `https://api.minimax.io/anthropic`。
- 密钥输入支持眼睛按钮显示/隐藏，保存后显示状态反馈。
- 录音悬浮窗通过快捷键或手势触发时会全局置顶显示。
- macOS 菜单栏图标改为和 app 图标一致的绿色麦克风图标。

## 首次运行权限

需要在 macOS 系统设置中允许：

- 麦克风
- 摄像头
- 辅助功能
- 输入监控

如果提示应用来自未知开发者，可执行：

```bash
xattr -cr "/Applications/Speak flow.app"
open "/Applications/Speak flow.app"
```

## API 配置

应用不会内置 API key。首次使用云端转写和智能整理时，在设置中填写：

- ASR provider / endpoint / model / API key
- LLM provider / model / Base URL / API key

参考模板：`app/data/settings.example.json`。
