# Speak flow 1.2

Speak flow 是一个 macOS AI 语音输入工具：按快捷键、打响指，或用手掌触发录音，说话后自动转写、整理、翻译，并把文字插入当前光标位置。

## 下载

1.2 发布包会发布在 GitHub Release：

- Release: https://github.com/JWang975/codex/releases/tag/speak-flow-1.2
- 下载文件：`Speak-flow-1.2-macOS-arm64.dmg`
- 下载直链：https://github.com/JWang975/codex/releases/download/speak-flow-1.2/Speak-flow-1.2-macOS-arm64.dmg
- SHA-256：`080d7bca9710a537854b73f54bc2b6e32dac06b40e6740556a2c531551f76ca9`

打开 DMG 后，把 `Speak flow.app` 拖到 Applications。

## 签名说明

当前机器没有 Apple Developer ID 证书，所以这个 DMG 是 ad-hoc signed，不是 Apple notarized。它适合先内部测试和朋友手动安装，但 macOS 可能会提示“无法验证开发者”。

如果 macOS 阻止打开，可在终端执行：

```bash
xattr -cr "/Applications/Speak flow.app"
open "/Applications/Speak flow.app"
```

真正的“下载即用”发布需要后续使用 Developer ID Application 证书签名，并通过 Apple notarization。

## 首次运行权限

Speak flow 需要这些权限：

- 麦克风：录音与响指识别
- 摄像头：手掌识别
- 辅助功能 / 输入监控：全局快捷键与自动插入

## 1.2 更新重点

- 快捷键详情页支持语音输入和翻译两个快捷键。
- 快捷键输入区点击后直接录入，支持 1 到 3 个按键。
- 语音输入快捷键默认 `Left Control + Space`，翻译快捷键默认 `Left Command + Space`。
- 翻译支持中文、English、日本語、Deutsch、Français。
- DeepSeek、Kimi、MiniMax 支持 Anthropic-compatible Base URL 自动解析。
- LLM 和 ASR 密钥输入支持显示/隐藏，保存有轻量反馈。
- 录音悬浮窗在快捷键或手势触发时全局置顶。
- macOS 菜单栏托盘图标改为 Speak flow 绿色麦克风图标。

## 开发复现

源码快照在 [app/](app/)。

```bash
cd app
corepack enable
pnpm install
python3 -m pip install -r electron/gesture-helper/requirements.txt
pnpm run app:build
open "release/Speak flow.app"
```

完整步骤见：

- [docs/rebuild-on-new-mac.md](docs/rebuild-on-new-mac.md)
- [docs/Speak-flow-1.2-development.md](docs/Speak-flow-1.2-development.md)

## 发布到 GitHub

登录 GitHub CLI 后，可在本目录执行：

```bash
scripts/publish-github-release.sh
```

脚本会推送 `speak-flow-1.2/` 到 `JWang975/codex`，并把 `release/Speak-flow-1.2-macOS-arm64.dmg` 上传到 `speak-flow-1.2` Release。

## 安全配置

真实 API key 不上传到仓库。新电脑可参考：

- [app/data/settings.example.json](app/data/settings.example.json)

应用运行时的真实配置保存在用户本机数据目录，不属于发布源码快照。

## 目录结构

```text
speak-flow-1.2/
  README.md
  docs/
    Speak-flow-1.2-product.md
    Speak-flow-1.2-development.md
    rebuild-on-new-mac.md
    release-notes.md
  scripts/
    publish-github-release.sh
  app/
    src/
    electron/
    scripts/
    assets/
    package.json
    pnpm-lock.yaml
    data/settings.example.json
  release/
    Speak-flow-1.2-macOS-arm64.dmg
    Speak-flow-1.2-macOS-arm64.dmg.sha256
```

DMG 本地保存在 `release/`，GitHub 上以 Release asset 为准。
