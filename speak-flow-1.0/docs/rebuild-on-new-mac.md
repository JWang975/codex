# 在新 Mac 上复现 Speak flow 1.0

## 1. 下载源码

```bash
git clone https://github.com/JWang975/codex.git
cd codex/speak-flow-1.0/app
```

## 2. 安装基础工具

需要：

- macOS Apple Silicon
- Xcode Command Line Tools
- Node.js 20+
- pnpm / Corepack
- Python 3

安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

启用 pnpm：

```bash
corepack enable
```

## 3. 安装依赖

```bash
pnpm install
python3 -m pip install -r electron/gesture-helper/requirements.txt
```

如果 Python 依赖安装到指定环境，启动时可设置：

```bash
export SPEAKON_PYTHON=/path/to/python3
```

## 4. 配置 API

真实配置不要提交到 GitHub。可参考：

```bash
cp data/settings.example.json data/settings.json
```

然后在应用设置中填写：

- Azure OpenAI Whisper endpoint
- Azure OpenAI Whisper deployment
- Azure OpenAI Whisper API key
- DeepSeek base URL
- DeepSeek model
- DeepSeek API key

也可以首次启动后直接在设置页填写。

## 5. 构建应用

```bash
pnpm run app:build
```

构建产物：

```text
release/Speak flow.app
```

打开：

```bash
open "release/Speak flow.app"
```

## 6. 生成下载包

```bash
cd release
ditto -c -k --sequesterRsrc --keepParent "Speak flow.app" "Speak-flow-1.0-macOS-arm64.zip"
```

## 7. 首次运行权限

在 macOS 系统设置中允许：

- 隐私与安全性 → 麦克风 → Speak flow
- 隐私与安全性 → 摄像头 → Speak flow
- 隐私与安全性 → 辅助功能 → Speak flow
- 隐私与安全性 → 输入监控 → Speak flow

如果 Fn 快捷键无效，打开设置里的快捷键区域，点击：

```text
重新检测
```

如果应用被系统拦截：

```bash
xattr -cr "release/Speak flow.app"
open "release/Speak flow.app"
```

## 8. 验收清单

- 首页是浅色极简界面。
- 首页显示 `按 Fn，说话就输入`。
- 点击主按钮能开始/停止录音。
- 顶部菜单能打开主面板。
- 输出方式在顶部菜单和客户端同步。
- 响指可以触发录音。
- 关闭摄像头后，Fn 和响指仍可用。
- 配置 Azure Whisper 后能转写。
- 配置 DeepSeek 后，润色/翻译/待办可用。
- 转写结果能自动插入光标位置。

