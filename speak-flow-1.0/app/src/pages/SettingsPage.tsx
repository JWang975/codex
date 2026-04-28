import { useState, useEffect, useRef } from "react";
import type { AppSettings, GestureHelperStatus, LLMProvider, ASRProvider, LocalAsrStatus, ShortcutStatus } from "../lib/types";
import { LLM_PRESETS, ASR_PRESETS, applyLLMPreset, applyASRPreset } from "../lib/provider-presets";

const API = "http://localhost:19840";
export type SettingsSection = "shortcut" | "snap" | "camera" | "asr" | "llm";

interface Props {
  settings: AppSettings;
  initialSection?: SettingsSection | null;
  onSave: (settings: AppSettings) => Promise<AppSettings> | AppSettings | void;
  onClose?: () => void;
}

const emptyGestureStatus: GestureHelperStatus = {
  status: "disabled",
  capabilities: [],
  message: "手势触发已关闭。",
};

const emptyShortcutStatus: ShortcutStatus = {
  status: "disabled",
  backend: "native",
  shortcut: "Fn",
  message: "快捷键尚未注册。",
};

function gestureStatusLabel(status: GestureHelperStatus["status"]) {
  const labels: Record<GestureHelperStatus["status"], string> = {
    disabled: "已关闭",
    starting: "启动中",
    ready: "就绪",
    degraded: "部分可用",
    error: "出错",
    stopped: "已停止",
  };
  return labels[status];
}

function shortcutStatusLabel(status: ShortcutStatus["status"]) {
  const labels: Record<ShortcutStatus["status"], string> = {
    disabled: "已关闭",
    starting: "启动中",
    ready: "就绪",
    error: "出错",
    stopped: "已停止",
  };
  return labels[status];
}

type ModifierName = "Control" | "Alt" | "Shift" | "Command";

const modifierOrder: ModifierName[] = ["Control", "Alt", "Shift", "Command"];

function shortcutDisplayTokens(shortcut: string, display?: string[]) {
  if (display && display.length > 0) return display;
  return String(shortcut || "Control+Space")
    .split("+")
    .filter(Boolean)
    .map((token) => {
      if (token === "Alt" || token === "Option") return "Option";
      if (token === "CommandOrControl") return "Command / Control";
      return token;
    });
}

function inferShortcutBackend(shortcut: string): "electron" | "native" {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts[parts.length - 1] || "";
  if (parts.includes("Fn") || key === "Fn") return "native";
  if (parts.length === 1 && /^(Left|Right)?(Control|Ctrl|Alt|Option|Shift|Command|Cmd)$/i.test(key)) return "native";
  return "electron";
}

function cameraDisplay(settings: AppSettings, status?: GestureHelperStatus) {
  if (settings.gestureTrigger.cameraIndex === -1) return "自动选择 Mac 摄像头";
  return settings.gestureTrigger.cameraLabel || status?.cameraName || "已选择外接摄像头";
}

function serviceDisplay(ok: boolean, ready: string, missing: string) {
  return ok ? ready : missing;
}

function modifierFromEvent(event: KeyboardEvent): { key: ModifierName; label: string } | null {
  if (event.code === "ControlLeft") return { key: "Control", label: "Left Control" };
  if (event.code === "ControlRight") return { key: "Control", label: "Right Control" };
  if (event.code === "AltLeft") return { key: "Alt", label: "Left Option" };
  if (event.code === "AltRight") return { key: "Alt", label: "Right Option" };
  if (event.code === "ShiftLeft") return { key: "Shift", label: "Left Shift" };
  if (event.code === "ShiftRight") return { key: "Shift", label: "Right Shift" };
  if (event.code === "MetaLeft") return { key: "Command", label: "Left Command" };
  if (event.code === "MetaRight") return { key: "Command", label: "Right Command" };
  return null;
}

function keyFromEvent(event: KeyboardEvent): { accelerator: string; label: string; isFunctionKey: boolean } | null {
  if (event.key === "Fn" || event.key === "Function" || event.code === "Fn") {
    return { accelerator: "Fn", label: "Fn", isFunctionKey: true };
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
    return { accelerator: event.code, label: event.code, isFunctionKey: true };
  }
  if (event.code.startsWith("Key")) {
    const key = event.code.slice(3).toUpperCase();
    return { accelerator: key, label: key, isFunctionKey: false };
  }
  if (event.code.startsWith("Digit")) {
    const key = event.code.slice(5);
    return { accelerator: key, label: key, isFunctionKey: false };
  }

  const map: Record<string, { accelerator: string; label: string }> = {
    Space: { accelerator: "Space", label: "Space" },
    Enter: { accelerator: "Return", label: "Return" },
    Tab: { accelerator: "Tab", label: "Tab" },
    CapsLock: { accelerator: "CapsLock", label: "Caps Lock" },
    Escape: { accelerator: "Escape", label: "Escape" },
    Backspace: { accelerator: "Backspace", label: "Backspace" },
    Delete: { accelerator: "Delete", label: "Delete" },
    Insert: { accelerator: "Insert", label: "Insert" },
    Home: { accelerator: "Home", label: "Home" },
    End: { accelerator: "End", label: "End" },
    PageUp: { accelerator: "PageUp", label: "Page Up" },
    PageDown: { accelerator: "PageDown", label: "Page Down" },
    ArrowUp: { accelerator: "Up", label: "Up" },
    ArrowDown: { accelerator: "Down", label: "Down" },
    ArrowLeft: { accelerator: "Left", label: "Left" },
    ArrowRight: { accelerator: "Right", label: "Right" },
    Minus: { accelerator: "-", label: "-" },
    Equal: { accelerator: "=", label: "=" },
    Comma: { accelerator: ",", label: "," },
    Period: { accelerator: ".", label: "." },
    Slash: { accelerator: "/", label: "/" },
    Backslash: { accelerator: "\\", label: "\\" },
    Semicolon: { accelerator: ";", label: ";" },
    Quote: { accelerator: "'", label: "'" },
    BracketLeft: { accelerator: "[", label: "[" },
    BracketRight: { accelerator: "]", label: "]" },
    Backquote: { accelerator: "`", label: "`" },
    AudioVolumeUp: { accelerator: "VolumeUp", label: "Volume Up" },
    AudioVolumeDown: { accelerator: "VolumeDown", label: "Volume Down" },
    AudioVolumeMute: { accelerator: "VolumeMute", label: "Volume Mute" },
    MediaTrackNext: { accelerator: "MediaNextTrack", label: "Media Next" },
    MediaTrackPrevious: { accelerator: "MediaPreviousTrack", label: "Media Previous" },
    MediaPlayPause: { accelerator: "MediaPlayPause", label: "Media Play/Pause" },
  };
  const mapped = map[event.code];
  return mapped ? { ...mapped, isFunctionKey: false } : null;
}

function ShortcutRecorder({
  shortcut,
  display,
  onRecord,
  onReset,
  onPermissionError,
}: {
  shortcut: string;
  display?: string[];
  onRecord: (shortcut: string, display: string[], backend?: "electron" | "native") => void;
  onReset: () => void;
  onPermissionError?: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string>("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const activeModifiersRef = useRef<Partial<Record<ModifierName, string>>>({});
  const modifierTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!recording) return;
    if (window.speakon) return;

    const updatePreview = () => {
      const tokens = modifierOrder.map((key) => activeModifiersRef.current[key]).filter(Boolean) as string[];
      setPreview(tokens.length > 0 ? tokens : null);
    };

    const clearModifierTimer = () => {
      if (modifierTimerRef.current) window.clearTimeout(modifierTimerRef.current);
      modifierTimerRef.current = null;
    };

    const finishShortcut = (accelerator: string, displayTokens: string[]) => {
      clearModifierTimer();
      activeModifiersRef.current = {};
      setPreview(null);
      setRecording(false);
      setMessage("");
      onRecord(accelerator, displayTokens, inferShortcutBackend(accelerator));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const modifier = modifierFromEvent(event);
      if (modifier) {
        activeModifiersRef.current[modifier.key] = modifier.label;
        setMessage("继续按一个键，或松手设为单键");
        updatePreview();
        clearModifierTimer();
        modifierTimerRef.current = window.setTimeout(() => {
          finishShortcut(modifier.label.replace(/\s+/g, ""), [modifier.label]);
        }, 420);
        return;
      }

      const key = keyFromEvent(event);
      if (!key) {
        setMessage("这个按键暂不支持，请换一个组合");
        return;
      }

      clearModifierTimer();
      const modifierKeys = modifierOrder.filter((name) => activeModifiersRef.current[name]);
      const accelerator = [...modifierKeys, key.accelerator].join("+");
      const displayTokens = [
        ...modifierKeys.map((name) => activeModifiersRef.current[name] || name),
        key.label,
      ];
      finishShortcut(accelerator, displayTokens);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const modifier = modifierFromEvent(event);
      if (modifier) {
        delete activeModifiersRef.current[modifier.key];
        updatePreview();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    buttonRef.current?.focus();
    return () => {
      clearModifierTimer();
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [onRecord, recording]);

  const tokens = preview || shortcutDisplayTokens(shortcut, display);
  const beginCapture = async () => {
    activeModifiersRef.current = {};
    setPreview(null);
    setMessage("按下新的快捷键");
    setRecording(true);
    if (!window.speakon) return;
    try {
      const result = await window.speakon.captureShortcut();
      if ("ok" in result && result.ok === false) {
        setMessage(result.error);
        if (result.needsPermission) onPermissionError?.(result.error);
        return;
      }
      onRecord(result.shortcut, result.shortcutDisplay, result.shortcutBackend);
      setMessage("");
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
    } finally {
      setPreview(null);
      setRecording(false);
    }
  };

  return (
    <div className="shortcut-recorder">
      <div className="shortcut-capture-row">
        <button
          ref={buttonRef}
          className={`shortcut-capture ${recording ? "recording" : ""}`}
          type="button"
          onClick={beginCapture}
        >
          {recording && !preview ? (
            <span className="shortcut-placeholder">按下快捷键</span>
          ) : (
            tokens.map((token) => <span className="key-chip" key={token}>{token}</span>)
          )}
        </button>
        <button className="shortcut-reset" type="button" onClick={onReset}>
          重置
        </button>
      </div>
      <div className="shortcut-message">{message || "点击后直接按键盘组合"}</div>
    </div>
  );
}

export default function SettingsPage({ settings, initialSection = null, onSave, onClose }: Props) {
  const [local, setLocal] = useState<AppSettings>(settings);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [gestureStatus, setGestureStatus] = useState<GestureHelperStatus>(emptyGestureStatus);
  const [localAsrStatus, setLocalAsrStatus] = useState<LocalAsrStatus | null>(null);
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus>(emptyShortcutStatus);
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(initialSection);
  const [permissionHint, setPermissionHint] = useState<string>("");
  const [temperatureText, setTemperatureText] = useState(String(settings.llm.temperature ?? 0.2));
  const [temperatureError, setTemperatureError] = useState("");
  const [cameraOptions, setCameraOptions] = useState<Array<{ index: number; label: string; builtIn?: boolean; automatic?: boolean }>>([
    { index: -1, label: "自动选择 Mac 摄像头", builtIn: true, automatic: true },
  ]);

  useEffect(() => setLocal(settings), [settings]);
  useEffect(() => setActiveSection(initialSection), [initialSection]);
  useEffect(() => setTemperatureText(String(settings.llm.temperature ?? 0.2)), [settings.llm.temperature]);
  useEffect(() => {
    if (!window.speakon) return;
    window.speakon.getGestureStatus().then(setGestureStatus).catch(() => {});
    window.speakon.listCameras().then(setCameraOptions).catch(() => {});
    window.speakon.getLocalAsrStatus().then(setLocalAsrStatus).catch(() => {});
    window.speakon.getShortcutStatus().then(setShortcutStatus).catch(() => {});
    const removeGesture = window.speakon.onGestureChanged(setGestureStatus);
    const removeShortcut = window.speakon.onShortcutChanged(setShortcutStatus);
    return () => {
      removeGesture();
      removeShortcut();
    };
  }, []);

  const update = (patch: Partial<AppSettings>) => setLocal({ ...local, ...patch });
  const updateLLM = (patch: Partial<AppSettings["llm"]>) => setLocal({ ...local, llm: { ...local.llm, ...patch } });
  const updateASR = (patch: Partial<AppSettings["asr"]>) => setLocal({ ...local, asr: { ...local.asr, ...patch } });
  const updateGesture = (patch: Partial<AppSettings["gestureTrigger"]>) =>
    setLocal({ ...local, gestureTrigger: { ...local.gestureTrigger, ...patch } });

  const persist = async (updated: AppSettings) => {
    setLocal(updated);
    const saved = await onSave(updated);
    if (saved) setLocal(saved);
    return saved || updated;
  };

  const handleSave = () => {
    persist(local).catch(() => {});
  };

  const saveShortcut = (shortcut: string, shortcutDisplay: string[], shortcutBackend = inferShortcutBackend(shortcut)) => {
    const updated = { ...local, shortcut, shortcutDisplay, shortcutBackend };
    persist(updated).catch(() => {});
  };

  const resetShortcut = async () => {
    const fallback = {
      ...local,
      shortcut: "Control+Space",
      shortcutDisplay: ["Left Control", "Space"],
      shortcutBackend: "electron" as const,
      shortcutDefaultMigrated: true,
    };
    try {
      if (window.speakon) {
        const updated = await window.speakon.resetShortcut();
        setLocal(updated);
      } else {
        await persist(fallback);
      }
    } catch {
      persist(fallback).catch(() => {});
    }
  };

  const saveGesture = (patch: Partial<AppSettings["gestureTrigger"]>) => {
    const nextGesture = { ...local.gestureTrigger, ...patch };
    const updated = {
      ...local,
      gestureTrigger: {
        ...nextGesture,
        enabled: nextGesture.snapEnabled || nextGesture.openPalmEnabled,
      },
    };
    persist(updated).catch(() => {});
  };

  const restartGestureHelper = async () => {
    if (!window.speakon) return;
    setGestureStatus(await window.speakon.restartGestureHelper());
  };

  const handleLLMProviderChange = (provider: LLMProvider) => {
    const next = applyLLMPreset(provider, { ...local.llm, provider });
    const updated = { ...local, llm: next };
    persist(updated).catch(() => {});
  };

  const handleASRProviderChange = (provider: ASRProvider) => {
    const next = applyASRPreset(provider, { ...local.asr, provider });
    const updated = { ...local, asr: next };
    persist(updated).catch(() => {});
  };

  const handleTestLLM = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await persist(local);
      const data = window.speakon
        ? await window.speakon.testLLM()
        : await fetch(`${API}/api/test-llm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }).then((resp) => resp.json());
      if (data.ok) {
        setTestResult({ ok: true, text: data.text || "智能整理已连接" });
      } else {
        setTestResult({ ok: false, text: data.text || data.error || "未知错误" });
      }
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setTesting(false);
  };

  const hasAsrApiKey = local.asr.provider === "local_whisper_cpp" || local.asr.apiKey.trim().length > 0;
  const isAzureAsr = local.asr.provider === "azure_openai_whisper";
  const asrProviderName = ASR_PRESETS[local.asr.provider]?.label || local.asr.provider;
  const llmProviderName = LLM_PRESETS[local.llm.provider]?.label || local.llm.provider;
  const shortcutSummary = shortcutDisplayTokens(local.shortcut, local.shortcutDisplay).join(" + ");
  const shortcutNeedsPermission = shortcutStatus.status === "error" || Boolean(permissionHint);
  const currentCameraLabel = cameraDisplay(local, gestureStatus);
  const asrSummary = serviceDisplay(hasAsrApiKey, `${asrProviderName} 已配置`, "未配置，使用系统语音");
  const llmSummary = serviceDisplay(local.llm.apiKey.trim().length > 0, `${llmProviderName} 已配置`, "未配置，原文模式可用");
  const openPermissions = (kind: "accessibility" | "input-monitoring" | "microphone" | "camera") => {
    window.speakon?.openPermissions(kind).catch(() => {});
  };
  const refreshShortcut = async () => {
    if (!window.speakon) return;
    try {
      const status = await window.speakon.refreshShortcut();
      setShortcutStatus(status);
      if (status.status === "ready") setPermissionHint("");
    } catch (err) {
      setPermissionHint(err instanceof Error ? err.message : String(err));
    }
  };
  const saveTemperature = () => {
    const value = Number(temperatureText);
    if (!Number.isFinite(value) || value < 0 || value > 2) {
      setTemperatureError("请输入 0 到 2 之间的数值。");
      return;
    }
    setTemperatureError("");
    const updated = { ...local, llm: { ...local.llm, temperature: value } };
    persist(updated).catch(() => {});
  };

  useEffect(() => {
    if (!window.speakon) return;
    const handleFocus = () => {
      if (activeSection === "shortcut" && (shortcutNeedsPermission || permissionHint)) {
        refreshShortcut();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [activeSection, permissionHint, shortcutNeedsPermission]);

  return (
    <div className="settings-minimal">
      <header className="page-header">
        <button className="ghost-link" type="button" onClick={onClose}>返回</button>
        <h1>设置</h1>
        <button className="done-link" type="button" onClick={onClose}>完成</button>
      </header>

      <div className="settings-list">
        <button className="list-row" type="button" onClick={() => setActiveSection(activeSection === "shortcut" ? null : "shortcut")}>
          <span>快捷键</span>
          <strong>{shortcutNeedsPermission ? "需要权限" : shortcutSummary}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => setActiveSection(activeSection === "snap" ? null : "snap")}>
          <span>响指</span>
          <strong>{local.gestureTrigger.snapEnabled ? "已开启" : "已关闭"}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => setActiveSection(activeSection === "camera" ? null : "camera")}>
          <span>摄像头与手掌</span>
          <strong>{local.gestureTrigger.openPalmEnabled ? currentCameraLabel : "未开启"}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => setActiveSection(activeSection === "asr" ? null : "asr")}>
          <span>转写服务</span>
          <strong>{asrSummary}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => setActiveSection(activeSection === "llm" ? null : "llm")}>
          <span>智能整理</span>
          <strong>{llmSummary}</strong>
        </button>
      </div>

      {activeSection === "shortcut" && (
        <section className="settings-detail">
          <div className="detail-heading">
            <strong>键盘快捷键</strong>
            <span className={`shortcut-status ${shortcutStatus.status}`}>{shortcutStatusLabel(shortcutStatus.status)}</span>
          </div>
          <div className="shortcut-setting-row compact">
            <div>
              <strong>语音输入</strong>
              <span>点击右侧后，直接按下想用的键。Fn 单键会走原生监听。</span>
            </div>
            <ShortcutRecorder
              shortcut={local.shortcut}
              display={local.shortcutDisplay}
              onRecord={(shortcut, display, backend) => {
                setPermissionHint("");
                saveShortcut(shortcut, display, backend);
              }}
              onReset={resetShortcut}
              onPermissionError={setPermissionHint}
            />
          </div>
          {shortcutNeedsPermission && (
            <div className="permission-callout">
              <span>{permissionHint || "需要在 macOS 隐私设置中允许 Speak flow 使用输入监控/辅助功能。"}</span>
              <div className="btn-row compact">
                <button className="btn btn-secondary" type="button" onClick={() => openPermissions("accessibility")}>打开辅助功能</button>
                <button className="btn btn-secondary" type="button" onClick={() => openPermissions("input-monitoring")}>打开输入监控</button>
                <button className="btn btn-secondary" type="button" onClick={refreshShortcut}>重新检测</button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeSection === "snap" && (
        <section className="settings-detail">
          <div className={`route-card gesture ${gestureStatus.status}`}>
            <strong>响指：{local.gestureTrigger.snapEnabled ? "已开启" : "已关闭"}</strong>
            <span>使用麦克风检测响指。关闭摄像头不会影响响指触发。</span>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={local.gestureTrigger.snapEnabled} onChange={(e) => saveGesture({ snapEnabled: e.target.checked })} />
            <span>
              <strong>启用响指触发</strong>
              <small>使用麦克风检测，灵敏度已调低。</small>
            </span>
          </label>
          <details className="advanced-details">
            <summary>高级参数</summary>
            <div className="form-row">
              <div className="form-group">
                <label>触发冷却</label>
                <input type="text" inputMode="numeric" value={local.gestureTrigger.cooldownMs} onChange={(e) => updateGesture({ cooldownMs: parseInt(e.target.value, 10) || 3000 })} onBlur={handleSave} />
              </div>
            </div>
          </details>
        </section>
      )}

      {activeSection === "camera" && (
        <section className="settings-detail">
          <div className={`route-card gesture ${gestureStatus.status}`}>
            <strong>视觉触发：{gestureStatusLabel(gestureStatus.status)}</strong>
            <span>{local.gestureTrigger.openPalmEnabled ? (gestureStatus.message || "摄像头开启后可识别手掌。") : "摄像头关闭时，只有手掌识别不生效。"}</span>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={local.gestureTrigger.openPalmEnabled} onChange={(e) => saveGesture({ openPalmEnabled: e.target.checked })} />
            <span>
              <strong>摄像头与手掌</strong>
              <small>打开摄像头后识别手掌；关闭后不影响快捷键和响指。</small>
            </span>
          </label>
          <div className="camera-options">
            {cameraOptions.map((camera) => (
              <button
                key={`${camera.index}-${camera.label}`}
                className={local.gestureTrigger.cameraIndex === camera.index ? "camera-option active" : "camera-option"}
                type="button"
                onClick={() => saveGesture({ cameraIndex: camera.index, cameraLabel: camera.label })}
              >
                <strong>{camera.label}</strong>
                <span>{camera.automatic ? "默认，优先避开虚拟摄像头" : camera.builtIn ? "Mac 自带摄像头" : "外接摄像头"}</span>
              </button>
            ))}
          </div>
          {gestureStatus.cameraName && (
            <div className="hint">当前手掌检测使用：{gestureStatus.cameraName}</div>
          )}
          <div className="btn-row">
            <button className="btn btn-secondary" type="button" onClick={() => openPermissions("camera")}>打开摄像头权限</button>
            {window.speakon && <button className="btn btn-secondary" type="button" onClick={restartGestureHelper}>重启手势</button>}
          </div>
          <p className="hint">快捷键和响指与摄像头解耦；关闭摄像头后仍可用快捷键和响指触发语音输入。</p>
        </section>
      )}

      {activeSection === "asr" && (
        <section className="settings-detail">
          <div className={`route-card ${hasAsrApiKey ? "api" : "system"}`}>
            <strong>{hasAsrApiKey ? "转写服务已配置" : "未配置转写服务"}</strong>
            <span>{hasAsrApiKey ? "录音会发送到转写服务，完成后直接插入光标位置。" : "未配置时会回退到系统语音。"}</span>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={local.autoPaste} onChange={(e) => {
              const updated = { ...local, autoPaste: e.target.checked };
              persist(updated).catch(() => {});
            }} />
            <span>
              <strong>完成后直接插入</strong>
              <small>关闭后只复制到剪贴板。</small>
            </span>
          </label>
          <div className="form-group">
            <label>ASR 服务</label>
            <select value={local.asr.provider} onChange={(e) => handleASRProviderChange(e.target.value as ASRProvider)}>
              {Object.entries(ASR_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{isAzureAsr ? "Azure OpenAI 地址" : local.asr.provider === "local_whisper_cpp" ? "whisper.cpp 可执行文件" : "ASR 接口地址"}</label>
            <input type="text" value={local.asr.baseUrl} onChange={(e) => updateASR({ baseUrl: e.target.value })} onBlur={handleSave} placeholder={isAzureAsr ? "https://YOUR_RESOURCE.openai.azure.com/" : "https://api.openai.com/v1"} />
          </div>
          <div className="form-group">
            <label>{isAzureAsr ? "Azure 部署名" : local.asr.provider === "local_whisper_cpp" ? "模型文件路径" : "ASR 模型"}</label>
            <input type="text" value={local.asr.model} onChange={(e) => updateASR({ model: e.target.value })} onBlur={handleSave} placeholder={isAzureAsr ? "whisper" : "whisper-1"} />
          </div>
          {isAzureAsr && (
            <div className="form-group">
              <label>Azure API 版本</label>
              <input type="text" value={local.asr.apiVersion || "2024-02-01"} onChange={(e) => updateASR({ apiVersion: e.target.value })} onBlur={handleSave} placeholder="2024-02-01" />
            </div>
          )}
          <div className="form-group">
            <label>ASR 密钥</label>
            <input type="password" value={local.asr.apiKey} onChange={(e) => updateASR({ apiKey: e.target.value })} onBlur={handleSave} placeholder="留空则使用系统语音" />
          </div>
          <div className="form-group">
            <label>语音语言</label>
            <input type="text" value={local.asr.language || ""} onChange={(e) => updateASR({ language: e.target.value })} onBlur={handleSave} placeholder="zh" />
          </div>
          {localAsrStatus && (
            <div className={`route-card ${localAsrStatus.available ? "ready" : "system"}`}>
              <strong>本地极速引擎：{localAsrStatus.available ? "已检测到" : "未启用"}</strong>
              <span>{localAsrStatus.message}</span>
            </div>
          )}
        </section>
      )}

      {activeSection === "llm" && (
        <section className="settings-detail">
          <div className="form-group">
            <label>服务商</label>
            <select value={local.llm.provider} onChange={(e) => handleLLMProviderChange(e.target.value as LLMProvider)}>
              {Object.entries(LLM_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>模型</label>
            <input type="text" value={local.llm.model} onChange={(e) => updateLLM({ model: e.target.value })} onBlur={handleSave} placeholder="deepseek-chat" />
          </div>
          <div className="form-group">
            <label>密钥</label>
            <input type="password" value={local.llm.apiKey} onChange={(e) => updateLLM({ apiKey: e.target.value })} onBlur={handleSave} placeholder="sk-..." />
          </div>
          <div className="form-group">
            <label>接口地址</label>
            <input type="text" value={local.llm.baseUrl} onChange={(e) => updateLLM({ baseUrl: e.target.value })} onBlur={handleSave} placeholder="https://api.deepseek.com/v1" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>翻译目标语言</label>
              <input type="text" value={local.targetLanguage} onChange={(e) => update({ targetLanguage: e.target.value })} onBlur={handleSave} placeholder="English / 中文" />
            </div>
            <div className="form-group">
              <label>温度</label>
              <input
                type="text"
                inputMode="decimal"
                value={temperatureText}
                onChange={(e) => {
                  setTemperatureText(e.target.value);
                  setTemperatureError("");
                }}
                onBlur={saveTemperature}
                placeholder="0.2"
              />
              {temperatureError && <div className="field-error">{temperatureError}</div>}
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleTestLLM} disabled={testing}>
              {testing ? "测试中..." : "测试智能整理"}
            </button>
            <button className="btn btn-secondary" onClick={handleSave}>保存</button>
          </div>
          {testResult && (
            <div className={`test-result ${testResult.ok ? "success" : "error"}`}>
              {testResult.text}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
