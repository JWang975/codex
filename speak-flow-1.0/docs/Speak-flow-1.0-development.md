# Speak flow 1.0 开发文档

## 当前版本目标

Speak flow 1.0 是一个 macOS 桌面语音输入应用。核心目标是复现当前最新体验：

- 浅色极简首页。
- 默认显示 `按 Fn，说话就输入`。
- 用户通过 Fn、响指、手掌或按钮开始/停止录音。
- 录音后走 ASR 转写和可选 LLM 整理。
- 最终文本自动插入原光标位置。
- 顶部菜单和客户端状态同步。

## 技术架构

```text
Electron main process
  ├─ settings/history JSON storage
  ├─ Tray / app menu
  ├─ globalShortcut + native shortcut helper
  ├─ Python gesture helper
  ├─ ASR / LLM fetch with AbortController
  ├─ clipboard + AppleScript paste
  └─ IPC bridge

Renderer
  ├─ React + Vite + TypeScript
  ├─ Home / Current settings / Settings / History
  ├─ MediaRecorder audio capture
  └─ recording state machine

Sidecars
  ├─ Swift native shortcut listener
  ├─ Swift macOS speech helper
  └─ Python snap + open palm helper
```

## 关键源码入口

- `electron/main.cjs`：主进程、菜单、设置、ASR/LLM、自动粘贴、helper 管理。
- `electron/preload.cjs`：安全暴露 IPC 到 renderer。
- `src/App.tsx`：主 UI、录音状态机、取消转写、设置同步。
- `src/pages/SettingsPage.tsx`：快捷键、响指、摄像头、ASR、LLM 设置。
- `src/styles.css`：浅色极简 UI。
- `electron/gesture-helper/speakon_gesture_helper.py`：响指和手掌识别。
- `electron/native/SpeakFlowShortcutListener.swift`：Fn 和特殊键监听。
- `scripts/build-mac-app.mjs`：macOS `.app` 打包。

## 录音链路

```text
触发事件
  → renderer recording:toggle
  → startRecording()
  → MediaRecorder / system speech
  → stopRecording()
  → audio:process 或 text:rewrite
  → ASR transcribe
  → LLM rewrite 或 raw passthrough
  → clipboard.writeText
  → activate original app
  → Cmd+V
```

## 触发方式

### 快捷键

- 默认展示为 Fn。
- Fn 和单修饰键使用 Swift native helper。
- Electron 支持的组合键继续可走 `globalShortcut`。
- Reset 恢复 `Left Control + Space`。
- 需要 macOS 辅助功能和输入监控权限。

### 响指

- Python helper 使用麦克风识别瞬态声音。
- 与摄像头解耦。
- 关闭摄像头不影响响指。
- 冷却时间用于避免连续误触。

### 手掌

- Python helper 使用 MediaPipe hand landmarker。
- 只有摄像头与手掌开关开启时生效。
- 自动摄像头选择优先避开 OBS / Virtual / Capture / Camo 等虚拟摄像头。
- Mac 自带摄像头优先。

## 设置与同步

设置保存走主进程 `settings:save`，保存后广播 `settings:changed`。renderer 订阅后更新本地状态，因此顶部菜单、首页、当前设置页和设置页保持一致。

受保护字段：

- ASR API key
- ASR base URL
- ASR model / deployment
- LLM API key
- LLM base URL
- LLM model

UI 简化或局部保存不能用空字符串覆盖已有配置。

## ASR

推荐 1.0 配置：

```json
{
  "provider": "azure_openai_whisper",
  "baseUrl": "https://YOUR_RESOURCE.openai.azure.com/",
  "model": "whisper",
  "apiVersion": "2024-02-01",
  "language": "zh"
}
```

Azure Whisper REST 请求格式：

```text
POST {endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version=2024-02-01
header: api-key
```

## LLM

推荐 1.0 配置：

```json
{
  "provider": "deepseek",
  "apiFormat": "openai_chat_completions",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "temperature": 0.2
}
```

原文模式跳过 LLM，速度最快。润色、翻译、待办会调用 LLM。

## UI 规范

1.0 使用浅色极简风格：

- 暖白背景。
- 黑色主按钮。
- 首页只放启动动作和当前输出入口。
- 技术配置放到设置页二级区域。
- 错误提示短中文。
- 录音浮层小黑胶囊，不抢焦点。

## 构建

```bash
cd app
corepack enable
pnpm install
python3 -m pip install -r electron/gesture-helper/requirements.txt
pnpm run app:build
open "release/Speak flow.app"
```

## 验证命令

```bash
node --check electron/main.cjs
node --check electron/preload.cjs
node --check server.mjs
PYTHONPYCACHEPREFIX=/tmp/speakon-pycache python3 -m py_compile electron/gesture-helper/speakon_gesture_helper.py
swiftc electron/native/SpeakFlowShortcutListener.swift -o /tmp/speakon-shortcut-listener-test
pnpm exec tsc --noEmit
pnpm run app:build
```

## 已知限制

- 当前 `.app` 未签名和公证。
- Python runtime 未内嵌，手势 helper 依赖系统 Python 或用户安装的 Python。
- 仅面向 macOS Apple Silicon 验证。
- API key 不随源码或下载包分发。

