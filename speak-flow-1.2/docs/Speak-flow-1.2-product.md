# Speak flow 1.2 Product Notes

## 产品定位

Speak flow 是一个 macOS 语音输入工具。核心流程是触发、录音、转写、整理、插入光标位置，让用户可以在任何文本输入场景里用说话替代打字。

## 核心场景

- 在网页、聊天、文档、代码编辑器中快速输入原文。
- 把口语化内容整理成更清晰的表达。
- 用快捷键直接进入翻译模式。
- 使用响指或手掌识别做免触碰触发。

## 主要交互

- 主屏只展示当前状态和当前输出模式。
- 设置页保留简洁列表，ASR 和 LLM 配置进入二级详情。
- 键盘快捷键详情页只包含语音输入、翻译和翻译目标语言。
- 密钥输入默认隐藏，可通过眼睛按钮临时显示。
- 保存和恢复动作都给出短反馈，不打断工作流。

## 1.2 功能范围

- 语音输入快捷键：默认 `Left Control + Space`。
- 翻译快捷键：默认 `Left Command + Space`。
- 快捷键录入：支持 1 到 3 个按键。
- 翻译目标语言：中文、English、日本語、Deutsch、Français。
- ASR：OpenAI Whisper、Azure OpenAI Whisper、Groq Whisper、SiliconFlow SenseVoice、自定义 Whisper、本地系统语音 fallback。
- LLM：OpenAI、Anthropic、DeepSeek、Kimi、MiniMax、Qwen、自定义兼容接口。
- LLM Base URL 自动判断：包含 `/anthropic` 或 Anthropic 官方域名时走 Anthropic Messages，否则走 OpenAI Chat Completions。
- 录音悬浮窗：触发录音时置顶显示，不抢走当前应用焦点。
- 菜单栏托盘：绿色麦克风图标，保留点击打开面板和状态菜单。

## 发布限制

1.2 本地包是 ad-hoc signed DMG。它可以安装测试，但不是 Apple notarized 的最终公众发布包。
