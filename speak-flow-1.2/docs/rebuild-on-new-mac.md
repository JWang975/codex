# Rebuild Speak flow 1.2 On A New Mac

## 环境

- macOS Apple Silicon
- Node.js 20+ 或可运行 Vite/Electron 的 Node 版本
- pnpm
- Xcode Command Line Tools
- Python 3

安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

## 构建

```bash
cd speak-flow-1.2/app
corepack enable
pnpm install
python3 -m pip install -r electron/gesture-helper/requirements.txt
pnpm run app:build
open "release/Speak flow.app"
```

如果当前 Node 不能直接执行 Electron 的 Node 模式，可用：

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vite/bin/vite.js build
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/build-mac-app.mjs
```

## 生成 DMG

在 `speak-flow-1.2/` 目录执行：

```bash
mkdir -p release/dmg-staging
rm -rf "release/dmg-staging/Speak flow.app"
ditto "app/release/Speak flow.app" "release/dmg-staging/Speak flow.app"
ln -sfn /Applications "release/dmg-staging/Applications"
hdiutil create -volname "Speak flow 1.2" \
  -srcfolder "release/dmg-staging" \
  -ov -format UDZO \
  "release/Speak-flow-1.2-macOS-arm64.dmg"
codesign --force --sign - "release/Speak-flow-1.2-macOS-arm64.dmg"
shasum -a 256 "release/Speak-flow-1.2-macOS-arm64.dmg" > "release/Speak-flow-1.2-macOS-arm64.dmg.sha256"
```

## 真正下载即用发布

当前包是 ad-hoc signed。要做 Developer ID signed + notarized：

1. 安装 Apple Developer ID Application 证书。
2. 用 Developer ID 证书签名 `.app`。
3. 用 `xcrun notarytool submit --wait` 提交 DMG。
4. 用 `xcrun stapler staple` stapling。
5. 再上传到 GitHub Release。

没有 notarization 时，用户可能需要手动移除隔离属性：

```bash
xattr -cr "/Applications/Speak flow.app"
```
