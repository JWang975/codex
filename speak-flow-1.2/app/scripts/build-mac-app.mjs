import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const electronApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const releaseDir = path.join(root, "release");
const outApp = path.join(releaseDir, "Speak flow.app");
const legacyOutApp = path.join(releaseDir, "SpeakON Lite.app");
const resourcesDir = path.join(outApp, "Contents", "Resources");
const appDir = path.join(resourcesDir, "app");
const iconsetDir = path.join(root, "assets", "AppIcon.iconset");
const iconPath = path.join(root, "assets", "SpeakON.icns");
const iconFileName = "SpeakFlow.icns";
const menuBarIconPath = path.join(root, "assets", "SpeakFlowMenuBar.png");
const menuBarIconFileName = "SpeakFlowMenuBar.png";
const appVersion = "1.2.0";
const bundleVersion = "12";

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function removePath(target) {
  try {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (error?.code !== "ENOTEMPTY") throw error;
    await run("rm", ["-rf", target]);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: "inherit", ...options });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function copyAppFiles() {
  await fs.mkdir(appDir, { recursive: true });
  await fs.cp(path.join(root, "dist"), path.join(appDir, "dist"), { recursive: true });
  await fs.cp(path.join(root, "electron"), path.join(appDir, "electron"), { recursive: true });
  await fs.chmod(path.join(appDir, "electron", "native", "speakon-system-speech"), 0o755).catch(() => {});
  await fs.chmod(path.join(appDir, "electron", "native", "speakon-shortcut-listener"), 0o755).catch(() => {});
  await fs.writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "speak-flow",
        productName: "Speak flow",
        version: appVersion,
        type: "module",
        main: "electron/main.cjs",
      },
      null,
      2,
    ),
  );
}

async function buildNativeHelpers() {
  const source = path.join(root, "electron", "native", "SpeakFlowShortcutListener.swift");
  const output = path.join(root, "electron", "native", "speakon-shortcut-listener");
  await run("swiftc", [source, "-o", output], { cwd: root });
  await fs.chmod(output, 0o755);
}

async function buildIcon() {
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  if (!(await exists(iconPath)) || !(await exists(menuBarIconPath))) {
    await run("swift", [path.join(root, "scripts", "render-app-icon.swift")], { cwd: root });
    await run("iconutil", ["-c", "icns", iconsetDir, "-o", iconPath], { cwd: root });
  }
  await fs.copyFile(iconPath, path.join(resourcesDir, iconFileName));
  await fs.copyFile(menuBarIconPath, path.join(resourcesDir, menuBarIconFileName));
}

function setPlistString(plist, key, value) {
  const replacement = `<key>${key}</key>\n\t<string>${value}</string>`;
  const existing = new RegExp(`<key>${key}<\\/key>\\s*<string>[^<]*<\\/string>`);
  if (existing.test(plist)) return plist.replace(existing, replacement);
  const insertAt = plist.lastIndexOf("</dict>");
  if (insertAt === -1) throw new Error("Info.plist is missing closing dict");
  return `${plist.slice(0, insertAt)}\t${replacement}\n${plist.slice(insertAt)}`;
}

async function updatePlist() {
  const plistPath = path.join(outApp, "Contents", "Info.plist");
  let plist = await fs.readFile(plistPath, "utf-8");
  plist = plist
    .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]+<\/string>/, "<key>CFBundleDisplayName</key>\n\t<string>Speak flow</string>")
    .replace(/<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/, "<key>CFBundleName</key>\n\t<string>Speak flow</string>")
    .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]+<\/string>/, "<key>CFBundleIdentifier</key>\n\t<string>com.speakflow.app</string>")
    .replace(/<key>CFBundleIconFile<\/key>\s*<string>[^<]+<\/string>/, "<key>CFBundleIconFile</key>\n\t<string>SpeakFlow</string>")
    .replace(
      /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/,
      "<key>NSMicrophoneUsageDescription</key>\n\t<string>Speak flow 需要使用麦克风进行语音输入。</string>",
    )
    .replace(
      /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/,
      "<key>NSCameraUsageDescription</key>\n\t<string>Speak flow 需要使用摄像头检测手掌触发。</string>",
    );

  if (!plist.includes("LSUIElement")) {
    const insertAt = plist.lastIndexOf("</dict>");
    if (insertAt === -1) throw new Error("Info.plist is missing closing dict");
    plist = `${plist.slice(0, insertAt)}\t<key>LSUIElement</key>\n\t<false/>\n${plist.slice(insertAt)}`;
  } else {
    plist = plist.replace(/<key>LSUIElement<\/key>\s*<(true|false)\/>/, "<key>LSUIElement</key>\n\t<false/>");
  }
  if (!plist.includes("NSSpeechRecognitionUsageDescription")) {
    const insertAt = plist.lastIndexOf("</dict>");
    if (insertAt === -1) throw new Error("Info.plist is missing closing dict");
    plist = `${plist.slice(0, insertAt)}\t<key>NSSpeechRecognitionUsageDescription</key>\n\t<string>Speak flow 可在没有 ASR 接口时使用 macOS 系统语音。</string>\n${plist.slice(insertAt)}`;
  }
  if (!plist.includes("NSCameraUsageDescription")) {
    const insertAt = plist.lastIndexOf("</dict>");
    if (insertAt === -1) throw new Error("Info.plist is missing closing dict");
    plist = `${plist.slice(0, insertAt)}\t<key>NSCameraUsageDescription</key>\n\t<string>Speak flow 需要使用摄像头检测手掌触发。</string>\n${plist.slice(insertAt)}`;
  }
  if (!plist.includes("NSAppleEventsUsageDescription")) {
    const insertAt = plist.lastIndexOf("</dict>");
    if (insertAt === -1) throw new Error("Info.plist is missing closing dict");
    plist = `${plist.slice(0, insertAt)}\t<key>NSAppleEventsUsageDescription</key>\n\t<string>Speak flow 需要控制系统粘贴，把转写结果插入光标位置。</string>\n${plist.slice(insertAt)}`;
  }

  plist = setPlistString(plist, "CFBundleShortVersionString", appVersion);
  plist = setPlistString(plist, "CFBundleVersion", bundleVersion);

  await fs.writeFile(plistPath, plist);
}

async function main() {
  if (!(await exists(electronApp))) {
    throw new Error(`Electron.app not found at ${electronApp}`);
  }

  await fs.mkdir(releaseDir, { recursive: true });
  await removePath(outApp);
  await removePath(legacyOutApp);
  await run("ditto", [electronApp, outApp]);
  await buildNativeHelpers();
  await buildIcon();
  await copyAppFiles();
  await updatePlist();

  await run("xattr", ["-cr", outApp]).catch(() => {});
  await run("codesign", ["--force", "--deep", "--sign", "-", outApp]);
  console.log(`Built ${outApp}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
