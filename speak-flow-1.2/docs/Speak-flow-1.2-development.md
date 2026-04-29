# Speak flow 1.2 Development Notes

## 技术栈

- Electron 主进程：窗口、托盘、快捷键、录音状态、IPC、macOS 权限入口。
- React + Vite 渲染层：主界面、设置页、快捷键录入、ASR/LLM 配置。
- Swift native helper：全局快捷键监听、快捷键录入、macOS 系统语音。
- Python gesture helper：摄像头手掌识别。
- 本地数据：用户设置和历史记录保存在本机数据目录。

## 目录

```text
app/
  electron/
    main.cjs
    preload.cjs
    native/
    gesture-helper/
  src/
    App.tsx
    pages/SettingsPage.tsx
    lib/
  scripts/
    build-mac-app.mjs
    render-app-icon.swift
  assets/
```

## 构建链路

1. `vite build` 生成 renderer 到 `dist/`。
2. `scripts/build-mac-app.mjs` 复制 Electron.app 模板。
3. 编译 Swift helper。
4. 复制 `dist/`、`electron/`、图标资源到 `.app`。
5. 写入 Info.plist 元数据和权限描述。
6. 对 `.app` 做 ad-hoc codesign。
7. 顶层发布流程再生成 DMG、签名 DMG、计算 SHA-256。

## 版本信息

- `package.json`: `1.2.0`
- `CFBundleShortVersionString`: `1.2.0`
- `CFBundleVersion`: `12`

## 配置安全

发布目录只包含 `app/data/settings.example.json`。真实的 `settings.json`、API key、历史记录和缓存不能上传。

## 验证建议

```bash
node --check electron/main.cjs
node --check electron/preload.cjs
node --check server.mjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/typescript/bin/tsc --noEmit
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vite/bin/vite.js build
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/build-mac-app.mjs
```
