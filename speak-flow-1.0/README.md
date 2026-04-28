# Speak flow 1.0

Speak flow 是一个 macOS AI 语音输入工具：按 Fn、打响指，或打开摄像头后用手掌触发，说话后自动转写、整理，并把文字插入当前光标位置。

## 下载即用

最新下载包会发布在 GitHub Release：

- Release: https://github.com/JWang975/codex/releases/tag/speak-flow-1.0
- 下载文件：`Speak-flow-1.0-macOS-arm64.zip`
- 仓库直链：https://github.com/JWang975/codex/raw/main/speak-flow-1.0/release/Speak-flow-1.0-macOS-arm64.zip
- SHA-256：`cf911619f9f592d233d00aed73097e8f7194a2585b4ec4e00620fa2313e393ea`

下载后解压，打开 `Speak flow.app`。首次运行需要允许：

- 麦克风：录音与响指识别
- 摄像头：手掌识别
- 辅助功能 / 输入监控：Fn 单键快捷键与自动插入

如果 macOS 阻止打开未签名应用，可在终端执行：

```bash
xattr -cr "Speak flow.app"
open "Speak flow.app"
```

## 产品说明

详细产品文档见：

- [docs/Speak-flow-1.0-product.md](docs/Speak-flow-1.0-product.md)

文档覆盖目标用户、典型场景、卖点、交互、功能范围，可直接拆成产品介绍 PPT。

## 开发复现

源码快照在 [app/](app/)。在新的 Mac 上：

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
- [docs/Speak-flow-1.0-development.md](docs/Speak-flow-1.0-development.md)

## 发布到 GitHub

登录 GitHub CLI 后，可在本目录执行：

```bash
scripts/publish-github-release.sh
```

脚本会推送 `speak-flow-1.0/` 到 `JWang975/codex`，并把 `release/Speak-flow-1.0-macOS-arm64.zip` 上传到 `speak-flow-1.0` Release。

## 配置说明

真实 API key 不上传到仓库。新电脑可参考：

- [app/data/settings.example.json](app/data/settings.example.json)

推荐配置：

- ASR：Azure OpenAI Whisper
- LLM：DeepSeek
- 默认输出：原文
- 默认触发：Fn、响指、手掌

## 目录结构

```text
speak-flow-1.0/
  README.md
  docs/
    Speak-flow-1.0-product.md
    Speak-flow-1.0-development.md
    rebuild-on-new-mac.md
    release-notes.md
  app/
    src/
    electron/
    scripts/
    assets/
    package.json
    pnpm-lock.yaml
    data/settings.example.json
  release/
    Speak-flow-1.0-macOS-arm64.zip
```

`release/` 内的 zip 是本地生成的下载包；GitHub 上最终以 Release asset 为准。
