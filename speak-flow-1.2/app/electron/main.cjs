const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, clipboard, nativeImage, Notification, session, screen } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORTABLE_APP_NAME = "Speak flow";
const LEGACY_APP_NAME = "SpeakON Lite";
const DEFAULT_VIEW = "home";
const MINIMAX_DEFAULT_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic";
const MINIMAX_LEGACY_ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic";
const MINIMAX_LEGACY_OPENAI_BASE_URL = "https://api.minimax.chat/v1";

const defaultSettings = {
  shortcut: "Control+Space",
  shortcutDisplay: ["Left Control", "Space"],
  shortcutBackend: "electron",
  shortcutDefaultMigrated: true,
  translateShortcut: "Command+Space",
  translateShortcutDisplay: ["Left Command", "Space"],
  translateShortcutBackend: "electron",
  defaultMode: "raw",
  targetLanguage: "English",
  autoCopy: true,
  autoPaste: true,
  asrMode: "auto",
  gestureTrigger: {
    enabled: true,
    snapEnabled: true,
    openPalmEnabled: true,
    holdDurationMs: 1200,
    cooldownMs: 3000,
    startupGraceMs: 2000,
    cameraIndex: -1,
    cameraLabel: "自动选择 Mac 摄像头",
  },
  llm: {
    provider: "deepseek",
    apiFormat: "anthropic_messages",
    authField: "ANTHROPIC_AUTH_TOKEN",
    apiKey: "",
    model: "DeepSeek-R1",
    temperature: 0.2,
    baseUrl: "https://api.deepseek.com/anthropic",
    baseUrlOpenAI: "https://api.deepseek.com/v1",
    baseUrlAnthropic: "https://api.deepseek.com/anthropic",
    anthropicVersion: "2023-06-01",
  },
  llmProfiles: {},
  asr: {
    provider: "openai_whisper",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "whisper-1",
    language: "zh",
    apiVersion: "2024-02-01",
  },
};

const HISTORY_LIMIT = 20;
let mainWindow = null;
let tray = null;
let micOverlayWindow = null;
let dictationWindow = null;
let dictationActive = false;
let systemSpeechProcess = null;
let systemSpeechTranscript = "";
let systemSpeechError = "";
let systemSpeechReadyResolver = null;
let systemSpeechStopPromise = null;
let currentStatus = "idle";
let currentView = DEFAULT_VIEW;
let settingsCache = null;
let gestureHelperProcess = null;
let gestureHelperStdout = "";
let gestureHelperConfigKey = "";
let gestureHelperStopping = false;
const shortcutHelpers = new Map();
let shortcutCaptureProcess = null;
const shortcutTriggerTimes = new Map();
let pasteTarget = null;
const activeJobs = new Map();
let gestureHelperStatus = {
  status: "disabled",
  capabilities: [],
  message: "手势触发已关闭。",
  updatedAt: Date.now(),
};
let shortcutStatus = {
  status: "disabled",
  backend: "electron",
  shortcut: defaultSettings.shortcut,
  message: "快捷键尚未注册。",
  updatedAt: Date.now(),
};

function appDataDir() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return path.join(app.getAppPath(), "data");
  }
  return app.getPath("userData");
}

function legacyAppDataDir() {
  if (!app.isPackaged) return null;
  return path.join(path.dirname(app.getPath("userData")), LEGACY_APP_NAME);
}

function migrateLegacyData() {
  const legacyDir = legacyAppDataDir();
  if (!legacyDir || legacyDir === appDataDir() || !fs.existsSync(legacyDir)) return;
  ensureDataDir();
  for (const fileName of ["settings.json", "history.json"]) {
    const from = path.join(legacyDir, fileName);
    const to = path.join(appDataDir(), fileName);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
    }
  }
}

function settingsFile() {
  return path.join(appDataDir(), "settings.json");
}

function historyFile() {
  return path.join(appDataDir(), "history.json");
}

function ensureDataDir() {
  fs.mkdirSync(appDataDir(), { recursive: true });
}

function deepMergeSettings(base, incoming) {
  const patch = incoming || {};
  const next = { ...base, ...patch };
  const llmSettings = mergeLLMSettings(base, patch);
  next.llm = llmSettings.llm;
  next.llmProfiles = llmSettings.llmProfiles;
  next.asr = mergeProtectedConfig(base.asr, patch.asr, [
    "apiKey",
    "baseUrl",
    "model",
    "apiVersion",
  ]);
  next.gestureTrigger = normalizeGestureSettings({ ...base.gestureTrigger, ...((patch && patch.gestureTrigger) || {}) });
  next.shortcutBackend = normalizeShortcutBackend(next.shortcut, next.shortcutBackend);
  next.translateShortcutBackend = normalizeShortcutBackend(next.translateShortcut, next.translateShortcutBackend);
  if (next.asrMode === "browser") next.asrMode = "system";
  if (!next.asrMode) next.asrMode = "auto";
  return next;
}

const LLM_PROTECTED_KEYS = [
  "apiKey",
  "baseUrl",
  "baseUrlOpenAI",
  "baseUrlAnthropic",
  "model",
  "anthropicVersion",
];

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function pickLLMBaseUrl(config) {
  const explicitBaseUrl = cleanBaseUrl(config?.baseUrl);
  if (explicitBaseUrl) return explicitBaseUrl;
  if (config?.apiFormat === "anthropic_messages") {
    return cleanBaseUrl(config.baseUrlAnthropic || config.baseUrlOpenAI);
  }
  if (config?.apiFormat === "openai_chat_completions") {
    return cleanBaseUrl(config.baseUrlOpenAI || config.baseUrlAnthropic);
  }
  return cleanBaseUrl(config?.baseUrlAnthropic || config?.baseUrlOpenAI);
}

function migrateLegacyProviderBaseUrl(config, baseUrl) {
  if (
    config?.provider === "minimax" &&
    baseUrl === MINIMAX_LEGACY_ANTHROPIC_BASE_URL &&
    cleanBaseUrl(config.baseUrlOpenAI) === MINIMAX_LEGACY_OPENAI_BASE_URL
  ) {
    return MINIMAX_DEFAULT_ANTHROPIC_BASE_URL;
  }
  return baseUrl;
}

function inferLLMApiFormatFromBaseUrl(baseUrl) {
  const normalized = cleanBaseUrl(baseUrl).toLowerCase();
  if (normalized.includes("anthropic.com") || normalized.includes("/anthropic")) {
    return "anthropic_messages";
  }
  return "openai_chat_completions";
}

function normalizeLLMConfig(config) {
  const next = { ...(config || {}) };
  const baseUrl = migrateLegacyProviderBaseUrl(next, pickLLMBaseUrl(next));
  const apiFormat = inferLLMApiFormatFromBaseUrl(baseUrl);
  next.baseUrl = baseUrl;
  next.apiFormat = apiFormat;
  if (apiFormat === "anthropic_messages") {
    next.baseUrlAnthropic = baseUrl;
  } else {
    next.baseUrlOpenAI = baseUrl;
  }
  next.anthropicVersion = next.anthropicVersion || "2023-06-01";
  return next;
}

function normalizeLLMProfileMap(profiles) {
  const normalized = {};
  for (const [provider, profile] of Object.entries(profiles || {})) {
    if (profile && typeof profile === "object") {
      normalized[provider] = normalizeLLMConfig({ ...profile, provider });
    }
  }
  return normalized;
}

function mergeLLMSettings(base, patch) {
  const baseLLM = normalizeLLMConfig(base.llm || defaultSettings.llm);
  const profiles = {
    ...normalizeLLMProfileMap(base.llmProfiles),
    ...normalizeLLMProfileMap(patch.llmProfiles),
  };
  profiles[baseLLM.provider] = profiles[baseLLM.provider] || baseLLM;

  const incomingProvider = patch.llm?.provider || baseLLM.provider;
  const profileBase = profiles[incomingProvider] || (incomingProvider === baseLLM.provider ? baseLLM : { provider: incomingProvider });
  const incomingLLM = patch.llm
    ? mergeProtectedConfig(profileBase, { ...patch.llm, provider: incomingProvider }, LLM_PROTECTED_KEYS)
    : profiles[incomingProvider] || baseLLM;
  const activeLLM = normalizeLLMConfig(incomingLLM);
  profiles[activeLLM.provider] = activeLLM;
  return { llm: activeLLM, llmProfiles: profiles };
}

function mergeProtectedConfig(baseConfig, incomingConfig, protectedKeys) {
  const next = { ...(baseConfig || {}) };
  if (!incomingConfig) return next;
  for (const [key, value] of Object.entries(incomingConfig)) {
    const existing = next[key];
    const shouldKeepExisting =
      protectedKeys.includes(key) &&
      typeof value === "string" &&
      value.trim() === "" &&
      typeof existing === "string" &&
      existing.trim() !== "";
    if (!shouldKeepExisting) next[key] = value;
  }
  return next;
}

function normalizeGestureSettings(settings) {
  const holdDurationMs = Number(settings?.holdDurationMs);
  const cooldownMs = Number(settings?.cooldownMs);
  const startupGraceMs = Number(settings?.startupGraceMs);
  const cameraIndex = Number(settings?.cameraIndex);
  const snapEnabled = settings?.snapEnabled !== false;
  const openPalmEnabled = settings?.openPalmEnabled !== false;
  const cameraLabel = typeof settings?.cameraLabel === "string" && settings.cameraLabel.trim()
    ? settings.cameraLabel.trim()
    : "自动选择 Mac 摄像头";
  return {
    enabled: Boolean(snapEnabled || openPalmEnabled),
    snapEnabled,
    openPalmEnabled,
    holdDurationMs: Number.isFinite(holdDurationMs) ? Math.max(1200, Math.min(3000, Math.round(holdDurationMs))) : 1200,
    cooldownMs: Number.isFinite(cooldownMs) ? Math.max(3000, Math.min(10000, Math.round(cooldownMs))) : 3000,
    startupGraceMs: Number.isFinite(startupGraceMs) ? Math.max(1000, Math.min(10000, Math.round(startupGraceMs))) : 2000,
    cameraIndex: Number.isFinite(cameraIndex) ? Math.max(-1, Math.min(9, Math.round(cameraIndex))) : -1,
    cameraLabel,
  };
}

function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    const raw = fs.readFileSync(settingsFile(), "utf-8");
    settingsCache = deepMergeSettings(defaultSettings, JSON.parse(raw));
  } catch {
    settingsCache = { ...defaultSettings, llm: { ...defaultSettings.llm }, asr: { ...defaultSettings.asr } };
  }
  return settingsCache;
}

function saveSettings(nextSettings) {
  ensureDataDir();
  settingsCache = deepMergeSettings(loadSettings(), nextSettings);
  fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 2));
  registerShortcut();
  buildTrayMenu();
  syncGestureHelper();
  broadcastSettingsChanged(settingsCache);
  return settingsCache;
}

function broadcastSettingsChanged(settings = loadSettings()) {
  mainWindow?.webContents.send("settings:changed", settings);
}

function loadHistory() {
  try {
    const items = JSON.parse(fs.readFileSync(historyFile(), "utf-8"));
    return Array.isArray(items) ? items.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  ensureDataDir();
  fs.writeFileSync(historyFile(), JSON.stringify(items.slice(0, HISTORY_LIMIT), null, 2));
}

function addHistoryItem(item) {
  const items = loadHistory();
  const next = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: Date.now(),
      ...item,
    },
    ...items,
  ].slice(0, HISTORY_LIMIT);
  saveHistory(next);
  mainWindow?.webContents.send("history:changed", next);
  return next;
}

function modeLabel(mode) {
  const labels = {
    raw: "原文",
    polish: "润色",
    email: "邮件",
    slack: "飞书消息",
    todo: "待办",
    translate: "翻译",
    list: "列表",
  };
  return labels[mode] || mode;
}

function statusLabel(status) {
  const labels = {
    idle: "空闲",
    recording: "正在录音",
    listening: "正在聆听",
    transcribing: "正在转写",
    rewriting: "正在整理",
    processing: "正在处理",
    canceled: "已取消",
    copied: "已复制",
    done: "已插入",
    error: "出错",
    disabled: "已关闭",
    starting: "启动中",
    ready: "就绪",
    degraded: "部分可用",
    stopped: "已停止",
  };
  return labels[status] || status;
}

function setStatus(status) {
  const previousStatus = currentStatus;
  currentStatus = status;
  buildTrayMenu();
  if (tray) {
    tray.setToolTip(`${PORTABLE_APP_NAME}: ${statusLabel(status)}`);
    tray.setTitle(status === "recording" || status === "listening" ? "REC" : "");
  }
  if (status === "recording" || status === "listening" || status === "transcribing" || status === "rewriting" || status === "processing") {
    showMicOverlay(status);
  } else {
    hideMicOverlay();
  }
  const wasActive = previousStatus === "recording" || previousStatus === "listening";
  const isActive = status === "recording" || status === "listening";
  if (!wasActive && isActive) {
    showNotification(PORTABLE_APP_NAME, "已开始录音，再次触发可停止。");
  }
  if (wasActive && (status === "transcribing" || status === "rewriting" || status === "processing")) {
    showNotification(PORTABLE_APP_NAME, "录音已结束，正在处理。");
  }
}

function setGestureHelperStatus(nextStatus) {
  gestureHelperStatus = {
    ...gestureHelperStatus,
    ...nextStatus,
    capabilities: Array.isArray(nextStatus.capabilities) ? nextStatus.capabilities : gestureHelperStatus.capabilities,
    updatedAt: Date.now(),
  };
  mainWindow?.webContents.send("gesture:changed", gestureHelperStatus);
  buildTrayMenu();
}

function setShortcutStatus(nextStatus) {
  shortcutStatus = {
    ...shortcutStatus,
    ...nextStatus,
    updatedAt: Date.now(),
  };
  mainWindow?.webContents.send("shortcut:changed", shortcutStatus);
  buildTrayMenu();
}

function shortcutHelperPath() {
  return path.join(app.getAppPath(), "electron", "native", "speakon-shortcut-listener");
}

function normalizeShortcutBackend(shortcut, backend) {
  if (backend === "native" || requiresNativeShortcut(shortcut)) return "native";
  return "electron";
}

function requiresNativeShortcut(shortcut) {
  const parts = String(shortcut || "").split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts[parts.length - 1] || "";
  if (!key) return false;
  if (parts.includes("Fn") || key === "Fn") return true;
  return /^(Left|Right)?(Control|Ctrl|Alt|Option|Shift|Command|Cmd)$/i.test(key);
}

function normalizeNativeShortcut(shortcut) {
  return String(shortcut || "Control+Space")
    .replace(/\bCtrl\b/gi, "Control")
    .replace(/\bOption\b/gi, "Alt")
    .replace(/\bCmd\b/gi, "Command")
    .replace(/\bEnter\b/gi, "Return")
    .replace(/\bEsc\b/gi, "Escape")
    .replace(/\bCaps Lock\b/gi, "CapsLock")
    .replace(/\s+/g, "");
}

function shortcutStatusMessage(status, shortcut, fallback = "") {
  if (fallback) return fallback;
  if (status === "ready") return "快捷键已启用。";
  if (status === "starting") return "快捷键监听启动中。";
  return "";
}

function triggerShortcutAction(action) {
  const now = Date.now();
  const lastAt = shortcutTriggerTimes.get(action) || 0;
  if (now - lastAt < 350) return;
  shortcutTriggerTimes.set(action, now);
  capturePasteTarget().catch(() => {});
  sendRecordingEvent("recording:toggle", action === "translate" ? { mode: "translate" } : undefined);
}

function registerElectronShortcut(shortcut, action, reportStatus, failureMessage) {
  const electronShortcut = normalizeElectronShortcut(shortcut);
  const ok = globalShortcut.register(electronShortcut, () => triggerShortcutAction(action));
  if (ok) {
    if (reportStatus) {
      setShortcutStatus({
        status: "ready",
        backend: "electron",
        shortcut: electronShortcut,
        message: "快捷键已启用。",
        pid: undefined,
      });
    }
    return true;
  }

  if (reportStatus) {
    const message = failureMessage || `无法注册快捷键：${shortcut}`;
    setShortcutStatus({
      status: "error",
      backend: "electron",
      shortcut: electronShortcut,
      message,
      pid: undefined,
    });
    showNotification(PORTABLE_APP_NAME, message);
  }
  return false;
}

function tryElectronShortcutFallback(state, message) {
  if (!state.fallbackToElectron || state.fallbackStarted || requiresNativeShortcut(state.shortcut)) {
    return false;
  }
  state.fallbackStarted = true;
  return registerElectronShortcut(state.shortcut, state.action, state.reportStatus, message);
}

function handleShortcutHelperLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    console.log(`[shortcut-helper] ${trimmed}`);
    return;
  }

  if (event.type === "status") {
    const status = event.status || "stopped";
    const message = shortcutStatusMessage(status, state.shortcut, event.message || "");
    if (status === "error") state.lastError = message;
    if (state.reportStatus && !(status === "error" && state.fallbackToElectron)) {
      setShortcutStatus({
        status,
        backend: event.backend || "native",
        message,
        pid: state.child?.pid,
        shortcut: state.shortcut,
      });
    }
    return;
  }

  if (event.type === "trigger" && event.action === "toggle_recording") {
    triggerShortcutAction(state.action);
  }
}

function stopShortcutHelper(action, disabledStatus) {
  if (!action) {
    for (const key of Array.from(shortcutHelpers.keys())) {
      stopShortcutHelper(key);
    }
    if (disabledStatus) {
      setShortcutStatus({
        status: "disabled",
        backend: "native",
        shortcut: loadSettings().shortcut,
        message: disabledStatus,
        pid: undefined,
      });
    }
    return;
  }

  const state = shortcutHelpers.get(action);
  if (state) {
    state.stopping = true;
    state.child.kill("SIGTERM");
    shortcutHelpers.delete(action);
  }
  if (disabledStatus && action === "record") {
    setShortcutStatus({
      status: "disabled",
      backend: "native",
      shortcut: loadSettings().shortcut,
      message: disabledStatus,
      pid: undefined,
    });
  }
}

function startShortcutHelper(settings, reason = "native 快捷键监听已启动。", action = "record", reportStatus = action === "record", fallbackToElectron = false) {
  const helperPath = shortcutHelperPath();
  const shortcut = normalizeNativeShortcut(settings.shortcut);
  const configKey = JSON.stringify({ action, shortcut, backend: "native" });
  const startingMessage = shortcutStatusMessage("starting", shortcut, reason);

  if (!fs.existsSync(helperPath)) {
    stopShortcutHelper(action);
    if (fallbackToElectron && registerElectronShortcut(shortcut, action, reportStatus, `快捷键 helper 缺失，已尝试 Electron：${shortcut}`)) {
      return true;
    }
    if (reportStatus) setShortcutStatus({
      status: "error",
      backend: "native",
      shortcut,
      message: shortcutStatusMessage("error", shortcut, `快捷键 helper 缺失：${helperPath}`),
      pid: undefined,
    });
    return false;
  }
  const existing = shortcutHelpers.get(action);
  if (existing && existing.configKey === configKey) return true;
  stopShortcutHelper(action);

  if (reportStatus) setShortcutStatus({
    status: "starting",
    backend: "native",
    shortcut,
    message: startingMessage,
    pid: undefined,
  });

  const child = spawn(helperPath, ["--shortcut", shortcut, "--cooldown-ms", "700"], {
    cwd: path.dirname(helperPath),
    env: { ...process.env, PATH: helperPathEnv() },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = {
    action,
    child,
    configKey,
    fallbackStarted: false,
    fallbackToElectron,
    lastError: "",
    reportStatus,
    shortcut,
    stdout: "",
    stopping: false,
  };
  shortcutHelpers.set(action, state);
  if (reportStatus) setShortcutStatus({
    status: "starting",
    backend: "native",
    shortcut,
    message: startingMessage,
    pid: child.pid,
  });

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    state.stdout += chunk;
    const lines = state.stdout.split(/\r?\n/);
    state.stdout = lines.pop() || "";
    lines.forEach((line) => handleShortcutHelperLine(line, state));
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message) console.error(`[shortcut-helper] ${message}`);
  });

  child.on("error", (error) => {
    if (shortcutHelpers.get(action) === state) shortcutHelpers.delete(action);
    const message = `无法启动快捷键 helper：${error.message}`;
    if (tryElectronShortcutFallback(state, message)) return;
    if (reportStatus) setShortcutStatus({
      status: "error",
      backend: "native",
      shortcut,
      message: shortcutStatusMessage("error", shortcut, message),
      pid: undefined,
    });
  });

  child.on("close", (code, signal) => {
    if (shortcutHelpers.get(action) === state) shortcutHelpers.delete(action);
    if (state.stopping) {
      return;
    }
    const status = code === 0 ? "stopped" : "error";
    const exitMessage = `快捷键 helper 已退出${signal ? `：${signal}` : `，代码 ${code}`}。`;
    const message = state.lastError || shortcutStatusMessage(status, shortcut, exitMessage);
    if (tryElectronShortcutFallback(state, message)) return;
    if (reportStatus) setShortcutStatus({
      status,
      backend: "native",
      shortcut,
      message,
      pid: undefined,
    });
  });
  return true;
}

function captureShortcut() {
  return new Promise((resolve, reject) => {
    const helperPath = shortcutHelperPath();
    if (!fs.existsSync(helperPath)) {
      reject(new Error(`快捷键 helper 缺失：${helperPath}`));
      return;
    }

    if (shortcutCaptureProcess) {
      shortcutCaptureProcess.kill("SIGTERM");
      shortcutCaptureProcess = null;
    }

    const shouldRestoreShortcuts = shortcutHelpers.size > 0;
    stopShortcutHelper();

    const child = spawn(helperPath, ["--capture", "--timeout-ms", "10000"], {
      cwd: path.dirname(helperPath),
      env: { ...process.env, PATH: helperPathEnv() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    shortcutCaptureProcess = child;

    let stdout = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (shortcutCaptureProcess === child) shortcutCaptureProcess = null;
      child.kill("SIGTERM");
      if (shouldRestoreShortcuts) setTimeout(registerShortcut, 0);
      callback(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error("快捷键录制超时。"));
    }, 11000);

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "capture") {
          clearTimeout(timer);
          const shortcut = normalizeNativeShortcut(event.shortcut);
          finish(resolve, {
            shortcut,
            shortcutDisplay: Array.isArray(event.display) ? event.display : [shortcut],
            shortcutBackend: normalizeShortcutBackend(shortcut, event.backend),
          });
          return;
        }
        if (event.type === "status" && event.status === "error") {
          clearTimeout(timer);
          finish(reject, new Error(event.message || "快捷键录制失败。"));
          return;
        }
      }
    });

    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) console.error(`[shortcut-capture] ${message}`);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish(reject, error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        finish(reject, new Error(code === 0 ? "未捕获到快捷键。" : `快捷键录制失败，代码 ${code}。`));
      }
    });
  });
}

function gestureHelperScriptPath() {
  return path.join(app.getAppPath(), "electron", "gesture-helper", "speakon_gesture_helper.py");
}

function gestureHelperModelsDir() {
  return path.join(path.dirname(gestureHelperScriptPath()), "models");
}

function getGestureConfigKey(settings) {
  const gesture = settings.gestureTrigger;
  return JSON.stringify({
    enabled: gesture.enabled,
    snapEnabled: gesture.snapEnabled,
    openPalmEnabled: gesture.openPalmEnabled,
    holdDurationMs: gesture.holdDurationMs,
    cooldownMs: gesture.cooldownMs,
    startupGraceMs: gesture.startupGraceMs,
    cameraIndex: gesture.cameraIndex,
  });
}

function stopGestureHelper(disabledStatus) {
  if (gestureHelperProcess) {
    gestureHelperStopping = true;
    gestureHelperProcess.kill("SIGTERM");
    gestureHelperProcess = null;
  }
  gestureHelperStdout = "";
  gestureHelperConfigKey = "";
  if (disabledStatus) {
    setGestureHelperStatus({
      status: "disabled",
      capabilities: [],
      message: disabledStatus,
      pid: undefined,
    });
  }
}

function resolvePythonExecutable() {
  const candidates = [
    process.env.SPEAKON_PYTHON,
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
    findExecutableSync("python3"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  return "python3";
}

function helperPathEnv() {
  return [
    process.env.PATH || "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean).join(path.delimiter);
}

function handleGestureHelperLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    console.log(`[gesture-helper] ${trimmed}`);
    return;
  }

  if (event.type === "status") {
    setGestureHelperStatus({
      status: event.status || "stopped",
      capabilities: event.capabilities || [],
      message: event.message || "",
      cameraIndex: typeof event.cameraIndex === "number" ? event.cameraIndex : undefined,
      cameraName: typeof event.cameraName === "string" ? event.cameraName : undefined,
    });
    return;
  }

  if (event.type === "trigger" && event.action === "toggle_recording") {
    capturePasteTarget().catch(() => {});
    sendRecordingEvent("recording:toggle");
  }
}

function startGestureHelper(settings) {
  const gesture = settings.gestureTrigger;
  const capabilities = [
    ...(gesture.snapEnabled ? ["snap"] : []),
    ...(gesture.openPalmEnabled ? ["open_palm"] : []),
  ];

  if (!gesture.enabled || capabilities.length === 0) {
    stopGestureHelper("手势触发已关闭。");
    return;
  }

  const scriptPath = gestureHelperScriptPath();
  if (!fs.existsSync(scriptPath)) {
    stopGestureHelper(`手势 helper 缺失：${scriptPath}`);
    setGestureHelperStatus({ status: "error", capabilities: [], pid: undefined });
    return;
  }

  const configKey = getGestureConfigKey(settings);
  if (gestureHelperProcess && gestureHelperConfigKey === configKey) return;
  stopGestureHelper();

  const python = resolvePythonExecutable();
  const args = [
    scriptPath,
    "--snap",
    gesture.snapEnabled ? "1" : "0",
    "--open-palm",
    gesture.openPalmEnabled ? "1" : "0",
    "--hold-ms",
    String(gesture.holdDurationMs),
    "--cooldown-ms",
    String(gesture.cooldownMs),
    "--startup-grace-ms",
    String(gesture.startupGraceMs),
    "--camera-index",
    String(gesture.cameraIndex),
    "--models-dir",
    gestureHelperModelsDir(),
  ];

  setGestureHelperStatus({
    status: "starting",
    capabilities,
    message: "正在启动手势 helper...",
    pid: undefined,
  });

  const child = spawn(python, args, {
    cwd: path.dirname(scriptPath),
    env: { ...process.env, PATH: helperPathEnv(), PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  gestureHelperProcess = child;
  gestureHelperConfigKey = configKey;
  setGestureHelperStatus({
    status: "starting",
    capabilities,
    message: "手势 helper 已启动。",
    pid: child.pid,
  });

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    gestureHelperStdout += chunk;
    const lines = gestureHelperStdout.split(/\r?\n/);
    gestureHelperStdout = lines.pop() || "";
    lines.forEach(handleGestureHelperLine);
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message) console.error(`[gesture-helper] ${message}`);
  });

  child.on("error", (error) => {
    if (gestureHelperProcess === child) gestureHelperProcess = null;
    setGestureHelperStatus({
      status: "error",
      capabilities: [],
      message: `无法启动手势 helper：${error.message}`,
      pid: undefined,
    });
  });

  child.on("close", (code, signal) => {
    if (gestureHelperProcess === child) gestureHelperProcess = null;
    if (gestureHelperStopping) {
      gestureHelperStopping = false;
      return;
    }
    setGestureHelperStatus({
      status: code === 0 ? "stopped" : "error",
      capabilities: [],
      message: `手势 helper 已退出${signal ? `：${signal}` : `，代码 ${code}`}。`,
      pid: undefined,
    });
  });
}

function syncGestureHelper(force = false) {
  const settings = loadSettings();
  if (force) gestureHelperConfigKey = "";
  startGestureHelper(settings);
}

function refreshShortcut() {
  registerShortcut();
  return shortcutStatus;
}

function micOverlayHtml() {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
          }
          body { display: grid; place-items: center; }
          .pill {
            width: 240px;
            height: 48px;
            border-radius: 999px;
            display: grid;
            grid-template-columns: 36px 1fr 36px;
            align-items: center;
            padding: 6px;
            background: rgba(22, 22, 24, 0.74);
            border: 1px solid rgba(255, 255, 255, 0.14);
            backdrop-filter: blur(34px) saturate(180%);
            box-shadow:
              0 12px 30px rgba(0, 0, 0, 0.34),
              inset 0 1px 0 rgba(255, 255, 255, 0.11);
            animation: settle 140ms ease-out;
          }
          button {
            width: 34px;
            height: 34px;
            border: 0;
            border-radius: 999px;
            display: grid;
            place-items: center;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
            transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
          }
          button:active { transform: scale(0.94); }
          #cancel { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.9); }
          #confirm { background: rgba(255, 255, 255, 0.94); color: #151516; }
          #confirm.hidden { visibility: hidden; }
          .center { min-width: 0; display: grid; gap: 2px; justify-items: center; color: white; }
          #title { font-size: 12px; font-weight: 760; letter-spacing: 0; line-height: 1.05; }
          .wave {
            height: 10px;
            display: grid;
            grid-template-columns: repeat(9, 3px);
            gap: 3px;
            align-items: center;
          }
          .wave span {
            display: block;
            width: 3px;
            height: 9px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.82);
            animation: meter 0.9s ease-in-out infinite;
          }
          .wave span:nth-child(2n) { animation-delay: 0.12s; }
          .wave span:nth-child(3n) { animation-delay: 0.24s; }
          .wave span:nth-child(4n) { animation-delay: 0.36s; }
          #sub {
            color: rgba(255, 255, 255, 0.62);
            font-size: 9px;
            font-variant-numeric: tabular-nums;
            line-height: 1;
          }
          @keyframes settle {
            from { transform: scale(0.96); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          @keyframes meter {
            0%, 100% { transform: scaleY(0.38); opacity: 0.52; }
            50% { transform: scaleY(0.9); opacity: 0.96; }
          }
        </style>
      </head>
      <body>
        <div class="pill">
          <button id="cancel" title="取消">×</button>
          <div class="center">
            <div id="title">正在录音</div>
            <div class="wave" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
            <div id="sub">00:00</div>
          </div>
          <button id="confirm" title="确认">✓</button>
        </div>
        <script>
          const { ipcRenderer } = require("electron");
          const title = document.getElementById("title");
          const sub = document.getElementById("sub");
          const confirm = document.getElementById("confirm");
          let startedAt = Date.now();
          window.setVoiceState = (status, text) => {
            const active = status === "recording" || status === "listening";
            title.textContent = text || "正在录音";
            confirm.classList.toggle("hidden", !active);
            if (active) startedAt = Date.now();
          };
          setInterval(() => {
            const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            sub.textContent = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
          }, 250);
          document.getElementById("cancel").addEventListener("click", () => ipcRenderer.send("voice-overlay:cancel"));
          document.getElementById("confirm").addEventListener("click", () => ipcRenderer.send("voice-overlay:confirm"));
        </script>
      </body>
    </html>
  `;
}

function createMicOverlayWindow() {
  micOverlayWindow = new BrowserWindow({
    width: 252,
    height: 58,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  micOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  micOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  micOverlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(micOverlayHtml())}`);
}

function overlayTextForStatus(status) {
  if (status === "transcribing") return "正在转写";
  if (status === "rewriting") return "正在整理";
  if (status === "processing") return "正在插入";
  if (status === "listening") return "正在聆听";
  return "正在录音";
}

function showMicOverlay(status = currentStatus) {
  if (!micOverlayWindow) createMicOverlayWindow();
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  micOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  micOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  micOverlayWindow.setPosition(Math.round(x + width / 2 - 126), Math.round(y + 14), false);
  micOverlayWindow.showInactive();
  micOverlayWindow.moveTop();
  micOverlayWindow.webContents.executeJavaScript(`window.setVoiceState(${JSON.stringify(status)}, ${JSON.stringify(overlayTextForStatus(status))})`).catch(() => {});
}

function hideMicOverlay() {
  micOverlayWindow?.hide();
}

function showOverlayForRecordingTrigger() {
  const overlayStatus = currentStatus === "recording" || currentStatus === "listening"
    ? currentStatus
    : "recording";
  showMicOverlay(overlayStatus);
}

function sendRecordingEvent(channel, payload) {
  if (!mainWindow) createMainWindow();
  if (channel === "recording:start" || channel === "recording:toggle") {
    showOverlayForRecordingTrigger();
  }
  mainWindow?.webContents.send(channel, payload);
}

function dictationCaptureHtml() {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
          }
          body {
            display: grid;
            place-items: center;
          }
          .pill {
            width: 118px;
            height: 72px;
            border-radius: 999px;
            display: grid;
            place-items: center;
            position: relative;
            background:
              radial-gradient(circle at 50% 20%, rgba(255, 255, 255, 0.58), transparent 40%),
              linear-gradient(180deg, rgba(250, 194, 132, 0.98), rgba(229, 148, 86, 0.98));
            box-shadow:
              0 18px 40px rgba(0, 0, 0, 0.34),
              inset 0 1px 0 rgba(255, 255, 255, 0.55);
            animation: breathe 1.15s ease-in-out infinite;
          }
          .mic {
            width: 38px;
            height: 38px;
            color: white;
            filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.18));
          }
          #dictationInput {
            position: absolute;
            width: 1px;
            height: 1px;
            opacity: 0.01;
            left: 50%;
            top: 50%;
            border: 0;
            padding: 0;
            outline: none;
            resize: none;
          }
          @keyframes breathe {
            0%, 100% { transform: scale(1); opacity: 0.96; }
            50% { transform: scale(1.045); opacity: 1; }
          }
        </style>
      </head>
      <body>
        <div class="pill">
          <svg class="mic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0v-5a3 3 0 0 0-3-3Z" fill="currentColor"/>
            <path d="M6 10.5a1 1 0 1 1 2 0v1a4 4 0 0 0 8 0v-1a1 1 0 1 1 2 0v1a6 6 0 0 1-5 5.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.58A6 6 0 0 1 6 11.5v-1Z" fill="currentColor"/>
          </svg>
          <textarea id="dictationInput" autofocus></textarea>
        </div>
        <script>
          const input = document.getElementById("dictationInput");
          function focusInput() {
            input.focus();
            input.selectionStart = input.value.length;
            input.selectionEnd = input.value.length;
          }
          window.resetDictationText = () => {
            input.value = "";
            focusInput();
          };
          window.getDictationText = () => input.value;
          window.addEventListener("focus", focusInput);
          window.addEventListener("DOMContentLoaded", focusInput);
          setInterval(focusInput, 500);
        </script>
      </body>
    </html>
  `;
}

async function ensureDictationWindow() {
  if (dictationWindow && !dictationWindow.isDestroyed()) return dictationWindow;

  dictationWindow = new BrowserWindow({
    width: 132,
    height: 86,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  dictationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dictationWindow.setAlwaysOnTop(true, "screen-saver");
  dictationWindow.on("closed", () => {
    dictationWindow = null;
    dictationActive = false;
  });
  await dictationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(dictationCaptureHtml())}`);
  return dictationWindow;
}

async function showDictationWindow() {
  const win = await ensureDictationWindow();
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  win.setPosition(Math.round(x + width / 2 - 66), Math.round(y + 18), false);
  win.show();
  win.focus();
  await win.webContents.executeJavaScript("window.resetDictationText()");
}

function hideDictationWindow() {
  dictationWindow?.hide();
}

function triggerDictationShortcut() {
  return new Promise((resolve, reject) => {
    // F5 is the Dictation key on recent macOS keyboards. This mirrors the user's system shortcut.
    execFile("osascript", ["-e", 'tell application "System Events" to key code 96'], (error) => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}

async function readDictationText() {
  if (!dictationWindow || dictationWindow.isDestroyed()) return "";
  return dictationWindow.webContents.executeJavaScript("window.getDictationText()");
}

function createTrayImage() {
  const candidates = [
    path.join(process.resourcesPath || "", "SpeakFlowMenuBar.png"),
    path.join(__dirname, "..", "assets", "SpeakFlowMenuBar.png"),
  ];
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate).resize({ width: 18, height: 18 });
      if (!image.isEmpty()) {
        image.setTemplateImage(false);
        return image;
      }
    } catch {
      // Fall through to the vector fallback below.
    }
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <path fill="black" d="M9 1.5a3.1 3.1 0 0 1 3.1 3.1v4.15a3.1 3.1 0 1 1-6.2 0V4.6A3.1 3.1 0 0 1 9 1.5Z"/>
      <path fill="black" d="M4 7.55a.75.75 0 0 1 1.5 0v1.2a3.5 3.5 0 0 0 7 0v-1.2a.75.75 0 0 1 1.5 0v1.2a5 5 0 0 1-4.25 4.94v1.31h2.15a.75.75 0 0 1 0 1.5H6.1a.75.75 0 0 1 0-1.5h2.15v-1.31A5 5 0 0 1 4 8.75v-1.2Z"/>
    </svg>
  `);
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
  image.setTemplateImage(true);
  return image;
}

function showPanel(view = DEFAULT_VIEW) {
  currentView = view;
  if (!mainWindow) createMainWindow();
  positionPanel();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("view:set", view);
  buildTrayMenu();
}

function hidePanel() {
  mainWindow?.hide();
  buildTrayMenu();
}

function togglePanel() {
  if (mainWindow?.isVisible()) {
    hidePanel();
  } else {
    showPanel(currentView || DEFAULT_VIEW);
  }
}

const COMMON_MENU_MODES = ["raw", "polish", "translate", "todo"];

function shortcutMenuLabel(settings = loadSettings()) {
  return (settings.shortcutDisplay && settings.shortcutDisplay.length > 0)
    ? settings.shortcutDisplay.join(" + ")
    : String(settings.shortcut || "Control+Space").split("+").join(" + ");
}

function cameraMenuLabel(settings = loadSettings()) {
  const gesture = settings.gestureTrigger || {};
  if (gesture.cameraIndex === -1 || gesture.cameraIndex === undefined) return "自动选择 Mac 摄像头";
  return gesture.cameraLabel || "已选择外接摄像头";
}

function triggerMenuLabel(settings = loadSettings()) {
  const triggers = [shortcutMenuLabel(settings)];
  if (settings.gestureTrigger?.enabled && settings.gestureTrigger.snapEnabled) triggers.push("响指");
  if (settings.gestureTrigger?.enabled && settings.gestureTrigger.openPalmEnabled) triggers.push("手掌");
  return triggers.join("、");
}

function hasGestureCapability(settings = loadSettings()) {
  return Boolean(settings.gestureTrigger?.snapEnabled || settings.gestureTrigger?.openPalmEnabled);
}

function gestureTogglePatch(settings, patch) {
  const nextGesture = { ...(settings.gestureTrigger || {}), ...patch };
  return {
    gestureTrigger: {
      ...patch,
      enabled: Boolean(nextGesture.snapEnabled || nextGesture.openPalmEnabled),
    },
  };
}

function menuWarningItems(settings = loadSettings()) {
  const items = [];
  if (shortcutStatus.status === "error") {
    items.push({
      label: "需要开启输入监控权限",
      click: () => openPermissionsPane("input-monitoring"),
    });
  }
  if (hasGestureCapability(settings) && gestureHelperStatus.status === "error") {
    items.push({
      label: "手势触发需要检查设备权限",
      click: () => showPanel("settings"),
    });
  }
  return items;
}

function modeMenuItems(settings = loadSettings()) {
  return [
    ...COMMON_MENU_MODES.map((mode) => ({
      label: modeLabel(mode),
      type: "radio",
      checked: settings.defaultMode === mode,
      click: () => saveSettings({ defaultMode: mode }),
    })),
    { type: "separator" },
    { label: "更多设置...", click: () => showPanel("current") },
  ];
}

function openPermissionsPane(kind = "accessibility") {
  const targets = {
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    "input-monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  };
  const target = targets[kind] || targets.accessibility;
  execFile("open", [target], () => {});
}

function buildApplicationMenu() {
  if (!app.isReady()) return;
  const settings = loadSettings();
  const isActive = currentStatus === "recording" || currentStatus === "listening";
  const isBusy = currentStatus === "processing" || currentStatus === "transcribing" || currentStatus === "rewriting";
  const appMenu = Menu.buildFromTemplate([
    {
      label: PORTABLE_APP_NAME,
      submenu: [
        {
          label: isActive ? "停止语音输入" : "开始语音输入",
          enabled: !isBusy,
          click: () => sendRecordingEvent(isActive ? "recording:stop" : "recording:start"),
        },
        { label: `当前输出：${modeLabel(settings.defaultMode)}`, enabled: false },
        { label: "输出方式", submenu: modeMenuItems(settings) },
        { type: "separator" },
        { label: "打开主面板", click: () => showPanel(DEFAULT_VIEW) },
        { label: "设置...", accelerator: "Command+,", click: () => showPanel("settings") },
        { label: `版本 ${app.getVersion()}`, enabled: false },
        { type: "separator" },
        { label: "退出 Speak flow", role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(appMenu);
  app.dock?.setMenu(Menu.buildFromTemplate([
    { label: "打开主面板", click: () => showPanel(DEFAULT_VIEW) },
    { label: "设置...", click: () => showPanel("settings") },
  ]));
}

function positionPanel() {
  if (!mainWindow || !tray) return;
  const bounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x || 0, y: bounds.y || 0 });
  const workArea = display.workArea;
  const x = Math.round(Math.min(Math.max(bounds.x + bounds.width / 2 - windowBounds.width / 2, workArea.x), workArea.x + workArea.width - windowBounds.width));
  const y = Math.round((bounds.y || workArea.y) + (bounds.height || 24) + 6);
  mainWindow.setPosition(x, y, false);
}

function buildTrayMenu() {
  buildApplicationMenu();
  if (!tray) return;
  const settings = loadSettings();
  const isActive = currentStatus === "recording" || currentStatus === "listening";
  const isBusy = currentStatus === "processing" || currentStatus === "transcribing" || currentStatus === "rewriting";
  const warnings = menuWarningItems(settings);

  const menu = Menu.buildFromTemplate([
    ...warnings,
    ...(warnings.length > 0 ? [{ type: "separator" }] : []),
    {
      label: isActive ? "停止语音输入" : "开始语音输入",
      enabled: !isBusy,
      click: () => sendRecordingEvent(isActive ? "recording:stop" : "recording:start"),
    },
    {
      label: `当前输出：${modeLabel(settings.defaultMode)}`,
      enabled: false,
    },
    {
      label: "输出方式",
      submenu: modeMenuItems(settings),
    },
    { type: "separator" },
    { label: `快捷键：${shortcutMenuLabel(settings)}`, click: () => showPanel("settings") },
    {
      label: `响指：${settings.gestureTrigger?.snapEnabled ? "已开启" : "已关闭"}`,
      type: "checkbox",
      checked: Boolean(settings.gestureTrigger?.snapEnabled),
      click: () => saveSettings(gestureTogglePatch(settings, { snapEnabled: !settings.gestureTrigger?.snapEnabled })),
    },
    {
      label: "摄像头与手掌",
      submenu: [
        {
          label: "手掌识别",
          type: "checkbox",
          checked: Boolean(settings.gestureTrigger?.openPalmEnabled),
          click: () => saveSettings(gestureTogglePatch(settings, { openPalmEnabled: !settings.gestureTrigger?.openPalmEnabled })),
        },
        { label: `摄像头：${cameraMenuLabel(settings)}`, enabled: false },
        { type: "separator" },
        { label: "打开摄像头设置...", click: () => showPanel("settings") },
      ],
    },
    { type: "separator" },
    { label: mainWindow?.isVisible() ? "隐藏主面板" : "打开主面板", click: togglePanel },
    { label: "设置...", accelerator: "Command+,", click: () => showPanel("settings") },
    { label: `版本 ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "退出 Speak flow", role: "quit" },
  ]);

  tray.setContextMenu(menu);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 600,
    minWidth: 420,
    minHeight: 460,
    show: false,
    resizable: true,
    frame: true,
    title: PORTABLE_APP_NAME,
    skipTaskbar: false,
    backgroundColor: "#f7f3ed",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      hidePanel();
    }
  });
  mainWindow.on("show", buildTrayMenu);
  mainWindow.on("hide", buildTrayMenu);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    currentView = DEFAULT_VIEW;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("view:set", DEFAULT_VIEW);
    buildTrayMenu();
  });
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  stopShortcutHelper();
  const settings = loadSettings();

  const shortcuts = [
    {
      action: "record",
      reportStatus: true,
      shortcut: settings.shortcut,
    },
    {
      action: "translate",
      reportStatus: false,
      shortcut: settings.translateShortcut,
    },
  ].filter((item) => item.shortcut);

  for (const item of shortcuts) {
    const canUseElectronFallback = !requiresNativeShortcut(item.shortcut);
    startShortcutHelper(
      { shortcut: item.shortcut },
      "native 快捷键监听已启动。",
      item.action,
      item.reportStatus,
      canUseElectronFallback,
    );
    if (canUseElectronFallback) {
      registerElectronShortcut(item.shortcut, item.action, false);
    }
  }
}

function normalizeElectronShortcut(shortcut) {
  return String(shortcut || "Control+Space")
    .replace(/\bCtrl\b/gi, "Control")
    .replace(/\bOption\b/gi, "Alt")
    .replace(/\s+/g, "");
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function escapeAppleScriptString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function capturePasteTarget() {
  const script = `
tell application "System Events"
  set frontProc to first application process whose frontmost is true
  set bundleId to bundle identifier of frontProc
  set procName to name of frontProc
  return bundleId & linefeed & procName
end tell
`;
  const { stdout } = await execFilePromise("osascript", ["-e", script], { timeout: 1200 });
  const [bundleId = "", name = ""] = String(stdout || "").trim().split(/\r?\n/);
  if (!bundleId || isSelfPasteTarget(bundleId, name)) {
    pasteTarget = null;
    return { ok: false, ignored: true };
  }
  pasteTarget = { bundleId, name, capturedAt: Date.now() };
  return { ok: true, ...pasteTarget };
}

function isSelfPasteTarget(bundleId, name) {
  const id = String(bundleId || "").toLowerCase();
  const appName = String(name || "").toLowerCase();
  return id === "com.speakflow.app" ||
    id === "com.github.electron" ||
    appName === "speak flow" ||
    appName === "electron";
}

function runAutoPaste(target = pasteTarget) {
  return new Promise((resolve) => {
    if (!target?.bundleId) {
      resolve({ ok: false, error: "没有可恢复的输入位置。" });
      return;
    }
    const bundleId = escapeAppleScriptString(target.bundleId);
    const script = `
tell application id "${bundleId}" to activate
delay 0.12
tell application "System Events" to keystroke "v" using command down
`;
    execFile("osascript", ["-e", script], (error, _stdout, stderr) => {
      resolve({ ok: !error, error: error ? cleanNativeSpeechError(stderr || error.message) : "" });
    });
  });
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    if (options.signal) {
      options.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }
  });
}

function isVirtualCameraName(name) {
  return /obs|virtual|screen|capture|camo|snap camera/i.test(String(name || ""));
}

function isPreferredCameraName(name) {
  return /facetime|built-in|built in|macbook|isight|高清相机|内置/i.test(String(name || ""));
}

async function listAvfoundationCameras() {
  const ffmpeg = findExecutableSync("ffmpeg");
  if (!ffmpeg) return [];
  try {
    const { stdout, stderr } = await execFilePromise(ffmpeg, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], { timeout: 2500 });
    const devices = [];
    for (const line of `${stderr}\n${stdout}`.split(/\r?\n/)) {
      if (!line.includes("] [")) continue;
      try {
        const rest = line.split("] [").pop() || "";
        const [idxText, namePart = ""] = rest.split("]", 2);
        const label = namePart.trim();
        const index = Number.parseInt(idxText, 10);
        if (Number.isFinite(index) && label && !isVirtualCameraName(label)) {
          devices.push({ index, label, builtIn: isPreferredCameraName(label) });
        }
      } catch {
        // Ignore malformed ffmpeg device lines.
      }
    }
    return devices;
  } catch {
    return [];
  }
}

async function listSystemProfilerCameras() {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execFilePromise("system_profiler", ["SPCameraDataType", "-json"], { timeout: 2500 });
    const data = JSON.parse(stdout || "{}");
    const items = Array.isArray(data.SPCameraDataType) ? data.SPCameraDataType : [];
    const devices = [];
    for (let index = 0; index < items.length; index += 1) {
      const label = String(items[index]?._name || "").trim();
      if (!label || isVirtualCameraName(label)) continue;
      devices.push({ index, label, builtIn: isPreferredCameraName(label) });
    }
    return devices;
  } catch {
    return [];
  }
}

async function listCameraDevices() {
  let devices = [];
  if (process.platform === "darwin") {
    const avfoundationDevices = await listAvfoundationCameras();
    devices = avfoundationDevices.length > 0 ? avfoundationDevices : await listSystemProfilerCameras();
  }
  devices.sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.label.localeCompare(b.label));
  return [
    { index: -1, label: "自动选择 Mac 摄像头", builtIn: true, automatic: true },
    ...devices,
  ];
}

function createJob(requestId) {
  const id = String(requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  activeJobs.get(id)?.abort();
  const controller = new AbortController();
  activeJobs.set(id, controller);
  return { requestId: id, controller };
}

function finishJob(requestId, controller) {
  if (activeJobs.get(requestId) === controller) {
    activeJobs.delete(requestId);
  }
}

function cancelJob(requestId) {
  const id = String(requestId || "");
  if (id && activeJobs.has(id)) {
    activeJobs.get(id).abort();
    activeJobs.delete(id);
    setStatus("idle");
    return true;
  }
  return false;
}

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|abort/i.test(String(error?.message || error || ""));
}

function findExecutableSync(names) {
  const candidates = Array.isArray(names) ? names : [names];
  const pathDirs = String(process.env.PATH || "").split(path.delimiter);
  pathDirs.push("/opt/homebrew/bin", "/usr/local/bin");
  const isExecutable = (target) => {
    try {
      fs.accessSync(target, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  for (const name of candidates) {
    if (path.isAbsolute(name) && isExecutable(name)) return name;
    for (const dir of pathDirs) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return "";
}

function resolveWhisperExecutable(config = {}) {
  const configured = String(config.baseUrl || "").trim();
  if (configured) return findExecutableSync(configured);
  return findExecutableSync(["whisper-cli", "whisper-cpp", "main"]);
}

function getLocalAsrStatus(config = loadSettings().asr) {
  const executable = resolveWhisperExecutable(config);
  const ffmpeg = findExecutableSync("ffmpeg");
  const model = String(config.model || "").trim();
  const modelExists = model && fs.existsSync(model);
  if (executable && ffmpeg && modelExists) {
    return {
      available: true,
      executable,
      ffmpeg,
      message: "已检测到 whisper.cpp、ffmpeg 和模型文件，可使用本地极速转写。",
    };
  }
  const missing = [
    executable ? "" : "whisper.cpp 可执行文件",
    ffmpeg ? "" : "ffmpeg",
    modelExists ? "" : "模型文件",
  ].filter(Boolean).join("、");
  return {
    available: false,
    executable,
    ffmpeg,
    message: `未检测到完整的本地环境${missing ? `，缺少：${missing}` : ""}。当前继续使用云端转写。`,
  };
}

async function transcribeWithWhisperCpp(audioBuffer, config, signal) {
  const status = getLocalAsrStatus(config);
  if (!status.available) throw new Error(status.message);

  const tmpDir = fs.mkdtempSync(path.join(app.getPath("temp"), "speak-flow-"));
  const inputPath = path.join(tmpDir, "input.webm");
  const wavPath = path.join(tmpDir, "input.wav");
  const outputPrefix = path.join(tmpDir, "transcript");
  try {
    fs.writeFileSync(inputPath, Buffer.from(audioBuffer));
    await execFilePromise(status.ffmpeg, [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ], { signal });

    const args = [
      "-m",
      String(config.model),
      "-f",
      wavPath,
      "-l",
      normalizeSpeechLanguage(config.language || "zh").split("-")[0],
      "-nt",
      "-otxt",
      "-of",
      outputPrefix,
    ];
    const { stdout } = await execFilePromise(status.executable, args, { signal, maxBuffer: 1024 * 1024 * 16 });
    const outputPath = `${outputPrefix}.txt`;
    const text = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf-8") : stdout;
    const cleaned = String(text || "").trim();
    if (!cleaned) throw new Error("本地转写没有返回文本。");
    return cleaned;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getLLMBaseUrl(config) {
  return pickLLMBaseUrl(config);
}

function inferLLMFormat(config) {
  return inferLLMApiFormatFromBaseUrl(getLLMBaseUrl(config));
}

function buildAnthropicMessagesEndpoint(baseUrl) {
  const normalized = cleanBaseUrl(baseUrl);
  if (/\/anthropic\/messages$/i.test(normalized)) {
    return normalized.replace(/\/messages$/i, "/v1/messages");
  }
  if (/\/messages$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function resolveLLMEndpoint(config) {
  const normalizedConfig = normalizeLLMConfig(config);
  const baseUrl = getLLMBaseUrl(normalizedConfig);
  if (!baseUrl) return "";
  const apiFormat = inferLLMFormat(normalizedConfig);
  if (apiFormat === "openai_chat_completions") return `${baseUrl}/chat/completions`;
  if (apiFormat === "anthropic_messages") return buildAnthropicMessagesEndpoint(baseUrl);
  return baseUrl;
}

function extractLLMErrorMessage(body) {
  const raw = String(body || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return (
      parsed?.error?.message ||
      parsed?.error?.error?.message ||
      parsed?.message ||
      parsed?.error ||
      raw
    );
  } catch {
    return raw;
  }
}

function formatLLMHttpError(status, statusText, body, endpoint) {
  const serverMessage = extractLLMErrorMessage(body);
  const haystack = `${status} ${statusText} ${serverMessage} ${body}`.toLowerCase();
  let hint = "服务商返回了错误，请检查模型、Key、余额和接口地址。";
  if (haystack.includes("insufficient balance") || haystack.includes("1008") || haystack.includes("余额不足")) {
    hint = "接口已连通，但账户余额不足或项目没有可用额度。";
  } else if (status === 401 || status === 403) {
    hint = "Key 无效、已过期，或不属于当前服务商/区域。";
  } else if (status === 404) {
    hint = "Base URL 或区域域名不正确，请检查接口地址。";
  }
  return `智能整理失败：${hint}\n状态：${status} ${statusText}\n服务端：${serverMessage || "无详细错误"}\n请求地址：${endpoint}`;
}

function createLLMHttpError(status, statusText, body, endpoint) {
  const error = new Error(formatLLMHttpError(status, statusText, body, endpoint));
  error.status = status;
  error.resolvedEndpoint = endpoint;
  return error;
}

async function callLLM(config, messages, signal) {
  config = normalizeLLMConfig(config);
  if (!config.apiKey) throw new Error("缺少智能整理 API Key。");
  if (!config.model) throw new Error("缺少智能整理模型。");
  const baseUrl = getLLMBaseUrl(config);
  if (!baseUrl) throw new Error("缺少智能整理接口地址。");
  const apiFormat = inferLLMFormat(config);

  if (apiFormat === "openai_chat_completions") {
    const endpoint = `${baseUrl}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(config.extraHeaders || {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.2,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw createLLMHttpError(response.status, response.statusText, body, endpoint);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("智能整理没有返回文本。");
    return text;
  }

  if (apiFormat === "anthropic_messages") {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const anthropicMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));
    const headers = {
      "Content-Type": "application/json",
      "anthropic-version": config.anthropicVersion || "2023-06-01",
      ...(config.extraHeaders || {}),
    };
    if (config.authField === "ANTHROPIC_API_KEY") {
      headers["x-api-key"] = config.apiKey;
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const endpoint = buildAnthropicMessagesEndpoint(baseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model: config.model,
        system,
        messages: anthropicMessages,
        max_tokens: 2048,
        temperature: config.temperature ?? 0.2,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw createLLMHttpError(response.status, response.statusText, body, endpoint);
    }
    const data = await response.json();
    const text = data.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n").trim();
    if (!text) throw new Error("智能整理没有返回文本。");
    return text;
  }

  throw new Error("当前版本暂不支持 OpenAI Responses 协议。");
}

function buildRewritePrompt(mode, transcript, targetLanguage = "English") {
  if (mode === "raw") return transcript;
  if (mode === "polish") {
    return `你是一个语音输入文本整理器。用户说的是口语，请把它改写为可直接发送的自然文本。

要求：
1. 保留原意，不添加新事实。
2. 删除口癖、重复、停顿词。
3. 修正明显语法问题。
4. 输出最终文本即可，不要解释。

原始转写：
${transcript}`;
  }
  if (mode === "email") {
    return `把下面口语内容改写成一封可以直接发送的专业邮件。

要求：
1. 保留原意。
2. 语气专业、清晰、克制。
3. 不添加原文没有的事实。
4. 如果缺少收件人或署名，不要编造。
5. 输出邮件正文即可，不要解释。

原始转写：
${transcript}`;
  }
  if (mode === "slack") {
    return `把下面口语内容改写成适合 Slack、飞书或企业即时消息发送的短消息。

要求：
1. 保留原意，不添加新事实。
2. 语气自然、清晰、可执行。
3. 删除口癖、重复和停顿。
4. 如果原文有行动项，用简短条目表达。
5. 只输出消息正文，不要解释。

原始转写：
${transcript}`;
  }
  if (mode === "translate") {
    return `把下面内容翻译成 ${targetLanguage}。

要求：
1. 自然、准确。
2. 不改变原意。
3. 删除明显口癖和重复。
4. 只输出译文，不要解释。

原始转写：
${transcript}`;
  }
  if (mode === "todo") {
    return `从下面口语内容中提取待办事项。

要求：
1. 只提取明确需要执行的事项。
2. 每条必须包含动作和对象。
3. 如果 owner 缺失，标记为"待确认"。
4. 如果截止时间缺失，不要编造。
5. 明确取消、否定、不做的事项不要进入待办。
6. 输出 Markdown 列表。

格式：
- [ ] 动作 + 对象 | Owner：xxx | 截止时间：xxx

原始转写：
${transcript}`;
  }
  if (mode === "list") {
    return `把下面口语内容整理成结构清晰的 Markdown 列表。

要求：
1. 保留原意，不添加新事实。
2. 合并重复表达。
3. 按主题或顺序拆分成条目。
4. 只输出列表，不要解释。

原始转写：
${transcript}`;
  }
  return transcript;
}

async function rewriteTranscript({ transcript, mode, targetLanguage, settings, signal }) {
  const rewriteMode = mode || settings.defaultMode;
  if (rewriteMode === "raw") return transcript;
  const prompt = buildRewritePrompt(rewriteMode, transcript, targetLanguage || settings.targetLanguage);
  return callLLM(settings.llm, [
    { role: "system", content: "你是一个高精度语音输入文本整理助手。你只输出最终可使用文本，不解释。" },
    { role: "user", content: prompt },
  ], signal);
}

async function transcribeAudio(audioBuffer, config, signal) {
  if (config.provider === "local_whisper_cpp") {
    return transcribeWithWhisperCpp(audioBuffer, config, signal);
  }
  if (!config.apiKey) throw new Error("缺少 ASR API Key。");
  if (!config.baseUrl) throw new Error("缺少 ASR 接口地址。");
  if (!config.model) throw new Error("缺少 ASR 模型或部署名。");

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/webm" }), "recording.webm");
  if (config.language) formData.append("language", config.language);

  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const isAzureWhisper = config.provider === "azure_openai_whisper" || baseUrl.includes(".openai.azure.com");
  const endpoint = isAzureWhisper
    ? `${baseUrl}/openai/deployments/${encodeURIComponent(config.model)}/audio/transcriptions?api-version=${encodeURIComponent(config.apiVersion || "2024-02-01")}`
    : `${baseUrl}/audio/transcriptions`;

  if (!isAzureWhisper) formData.append("model", config.model);

  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: isAzureWhisper ? { "api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`转写失败：${response.status} ${response.statusText} ${body}`);
  }
  const data = await response.json();
  if (!data.text) throw new Error("ASR 没有返回文本。");
  return data.text;
}

async function startSystemSpeech() {
  if (systemSpeechProcess) {
    throw new Error("macOS 系统语音正在录音。");
  }

  const nativePath = path.join(app.getAppPath(), "electron", "native", "speakon-system-speech");
  if (!fs.existsSync(nativePath)) {
    throw new Error(`macOS 系统语音 helper 缺失：${nativePath}`);
  }

  const language = normalizeSpeechLanguage(loadSettings().asr.language || "zh");
  systemSpeechTranscript = "";
  systemSpeechError = "";

  await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(nativePath, [language], { stdio: ["pipe", "pipe", "pipe"] });
    systemSpeechProcess = child;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopNativeSpeechProcess();
      reject(new Error("macOS 系统语音 helper 没有就绪。"));
    }, 8000);

    systemSpeechReadyResolver = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      systemSpeechTranscript += chunk;
    });

    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      systemSpeechError += text;
      if (text.includes("READY")) {
        systemSpeechReadyResolver?.();
      }
      if (text.includes("ERROR:") && !settled) {
        settled = true;
        clearTimeout(timeout);
        stopNativeSpeechProcess();
        reject(new Error(cleanNativeSpeechError(text)));
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      systemSpeechProcess = null;
      reject(error);
    });

    child.on("close", (code) => {
      systemSpeechProcess = null;
      systemSpeechReadyResolver = null;
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(cleanNativeSpeechError(systemSpeechError) || `macOS 系统语音 helper 已退出，代码 ${code}。`));
      }
    });
  });

  return { ok: true };
}

async function stopSystemSpeech() {
  if (!systemSpeechProcess) {
    return { transcript: systemSpeechTranscript.trim() };
  }

  const child = systemSpeechProcess;
  if (!systemSpeechStopPromise) {
    systemSpeechStopPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopNativeSpeechProcess();
        reject(new Error("macOS 系统语音 helper 未能正常停止。"));
      }, 8000);

      child.once("close", (code) => {
        clearTimeout(timeout);
        systemSpeechStopPromise = null;
        if (code !== 0 && !systemSpeechTranscript.trim()) {
          reject(new Error(cleanNativeSpeechError(systemSpeechError) || `macOS 系统语音 helper 已退出，代码 ${code}。`));
          return;
        }
        resolve({ transcript: systemSpeechTranscript.trim() });
      });

      child.stdin.write("stop\n");
    });
  }

  return systemSpeechStopPromise;
}

function normalizeSpeechLanguage(language) {
  const value = String(language || "zh").trim();
  const map = { zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
  return map[value] || value;
}

function cleanNativeSpeechError(message) {
  return String(message || "").replace(/^ERROR:\s*/m, "").trim();
}

function isPermissionMessage(message) {
  return /权限|输入监控|辅助功能|accessibility|input monitoring|listen event|not trusted|permission/i.test(String(message || ""));
}

function stopNativeSpeechProcess() {
  if (systemSpeechProcess) {
    systemSpeechProcess.kill("SIGTERM");
    systemSpeechProcess = null;
  }
  systemSpeechReadyResolver = null;
  systemSpeechStopPromise = null;
}

async function finalizeResult({ requestId, transcript, result, mode, durationMs }) {
  const settings = loadSettings();
  if (settings.autoCopy) clipboard.writeText(result);
  let pasted = false;
  let pasteError = "";
  if (settings.autoPaste) {
    const pasteResult = await runAutoPaste(pasteTarget);
    pasted = pasteResult.ok;
    pasteError = pasteResult.error || "";
  }
  pasteTarget = null;
  addHistoryItem({
    rawTranscript: transcript,
    rewrittenText: result,
    mode,
    durationMs,
  });
  setStatus(pasted ? "done" : "copied");
  showNotification(PORTABLE_APP_NAME, pasted ? "文字已插入光标位置" : "已复制，请手动粘贴");
  return { requestId, transcript, result, mode, copied: settings.autoCopy, pasted, pasteError };
}

function installIpcHandlers() {
  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:save", (_event, nextSettings) => saveSettings(nextSettings));
  ipcMain.handle("history:get", () => loadHistory());
  ipcMain.handle("history:clear", () => {
    saveHistory([]);
    mainWindow?.webContents.send("history:changed", []);
    return [];
  });
  ipcMain.handle("clipboard:copy", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  });
  ipcMain.handle("llm:test", async (_event, candidateSettings) => {
    const settings = candidateSettings ? deepMergeSettings(loadSettings(), candidateSettings) : loadSettings();
    const resolvedEndpoint = resolveLLMEndpoint(settings.llm);
    try {
      const result = await callLLM(settings.llm, [
        { role: "system", content: "你是一个 API 连通性测试助手。" },
        { role: "user", content: "请只回复 OK" },
      ]);
      return {
        ok: result.trim().toLowerCase().includes("ok"),
        text: `${result}\n请求地址：${resolvedEndpoint}`,
        resolvedEndpoint,
      };
    } catch (error) {
      return {
        ok: false,
        text: error?.message || "智能整理测试失败。",
        resolvedEndpoint: error?.resolvedEndpoint || resolvedEndpoint,
      };
    }
  });
  ipcMain.handle("system-speech:start", async (_event, payload) => {
    setStatus("listening");
    return startSystemSpeech(payload?.language);
  });
  ipcMain.handle("system-speech:stop", async (_event, payload) => {
    if (!payload?.silent) setStatus("transcribing");
    return stopSystemSpeech();
  });
  ipcMain.handle("gesture:get-status", () => gestureHelperStatus);
  ipcMain.handle("gesture:restart", () => {
    syncGestureHelper(true);
    return gestureHelperStatus;
  });
  ipcMain.handle("gesture:list-cameras", () => listCameraDevices());
  ipcMain.handle("shortcut:get-status", () => shortcutStatus);
  ipcMain.handle("shortcut:refresh", () => refreshShortcut());
  ipcMain.handle("shortcut:capture", async () => {
    try {
      return { ok: true, ...(await captureShortcut()) };
    } catch (error) {
      const message = cleanNativeSpeechError(error?.message || error) || "快捷键录制失败。";
      return {
        ok: false,
        error: isPermissionMessage(message)
          ? "需要在 macOS 隐私设置中允许 Speak flow 使用输入监控/辅助功能。"
          : message,
        needsPermission: isPermissionMessage(message),
      };
    }
  });
  ipcMain.handle("shortcut:reset", () => saveSettings({
    shortcut: "Control+Space",
    shortcutDisplay: ["Left Control", "Space"],
    shortcutBackend: "native",
    shortcutDefaultMigrated: true,
  }));
  ipcMain.handle("system:open-permissions", (_event, kind) => {
    openPermissionsPane(kind);
    return { ok: true };
  });
  ipcMain.handle("paste-target:prepare", () => capturePasteTarget());
  ipcMain.handle("job:cancel", (_event, requestId) => {
    cancelJob(requestId);
    return { ok: true };
  });
  ipcMain.handle("asr:local-status", () => getLocalAsrStatus());
  ipcMain.handle("audio:process", async (_event, payload) => {
    const settings = loadSettings();
    const mode = payload?.mode || settings.defaultMode;
    const job = createJob(payload?.requestId);
    try {
      setStatus("transcribing");
      const audioBuffer = Buffer.from(payload.audio);
      const transcript = await transcribeAudio(audioBuffer, settings.asr, job.controller.signal);
      setStatus(mode === "raw" ? "processing" : "rewriting");
      const result = await rewriteTranscript({
        transcript,
        mode,
        targetLanguage: payload?.targetLanguage,
        settings,
        signal: job.controller.signal,
      });
      return finalizeResult({ requestId: job.requestId, transcript, result, mode, durationMs: payload?.durationMs });
    } catch (error) {
      setStatus(isAbortError(error) ? "idle" : "error");
      throw error;
    } finally {
      finishJob(job.requestId, job.controller);
    }
  });
  ipcMain.handle("text:rewrite", async (_event, payload) => {
    const settings = loadSettings();
    const transcript = String(payload?.transcript || "");
    const mode = payload?.mode || settings.defaultMode;
    if (!transcript.trim()) throw new Error("没有可整理的转写文本。");
    const job = createJob(payload?.requestId);
    try {
      setStatus(mode === "raw" ? "processing" : "rewriting");
      const result = await rewriteTranscript({
        transcript,
        mode,
        targetLanguage: payload?.targetLanguage,
        settings,
        signal: job.controller.signal,
      });
      return finalizeResult({ requestId: job.requestId, transcript, result, mode });
    } catch (error) {
      setStatus(isAbortError(error) ? "idle" : "error");
      throw error;
    } finally {
      finishJob(job.requestId, job.controller);
    }
  });
  ipcMain.on("status:set", (_event, status) => setStatus(status));
  ipcMain.on("panel:show", (_event, view) => showPanel(view || DEFAULT_VIEW));
  ipcMain.on("voice-overlay:cancel", () => sendRecordingEvent("recording:cancel"));
  ipcMain.on("voice-overlay:confirm", () => sendRecordingEvent("recording:stop"));
}

app.setName(PORTABLE_APP_NAME);
app.setActivationPolicy?.("regular");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  showPanel(DEFAULT_VIEW);
});

app.on("activate", () => {
  showPanel(currentView || DEFAULT_VIEW);
});

app.whenReady().then(async () => {
  migrateLegacyData();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "microphone");
  });
  try {
    await require("electron").systemPreferences.askForMediaAccess("microphone");
    await require("electron").systemPreferences.askForMediaAccess("camera");
  } catch {
    // The renderer and gesture helper will still surface helpful permission errors.
  }

  installIpcHandlers();
  createMainWindow();
  tray = new Tray(createTrayImage());
  tray.setToolTip(PORTABLE_APP_NAME);
  tray.on("click", togglePanel);
  buildTrayMenu();
  registerShortcut();
  syncGestureHelper(true);
});

app.on("before-quit", () => {
  app.isQuitting = true;
  for (const controller of activeJobs.values()) controller.abort();
  activeJobs.clear();
  stopNativeSpeechProcess();
  stopGestureHelper();
  stopShortcutHelper();
  shortcutCaptureProcess?.kill("SIGTERM");
  shortcutCaptureProcess = null;
  hideDictationWindow();
  dictationWindow?.destroy();
  dictationWindow = null;
  micOverlayWindow?.destroy();
  micOverlayWindow = null;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
