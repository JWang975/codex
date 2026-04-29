import { useState, useEffect, useRef, useCallback } from "react";
import type { AppSettings, GestureHelperStatus, LLMProvider, ASRProvider, LocalAsrStatus, ShortcutStatus } from "../lib/types";
import { LLM_PRESETS, ASR_PRESETS, applyASRPreset, defaultLLMConfigForProvider, normalizeLLMConfig, normalizeLLMProfiles } from "../lib/provider-presets";

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
  backend: "electron",
  shortcut: "Control+Space",
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

type ModifierName = "Control" | "Alt" | "Shift" | "Command";
type ModifierState = { label: string; accelerator: string };

const modifierOrder: ModifierName[] = ["Control", "Alt", "Shift", "Command"];
const MAX_SHORTCUT_KEYS = 3;
type ShortcutSaveResult = { ok: boolean; message?: string };

function isModifierToken(value: string) {
  return /^(Left|Right)?(Control|Ctrl|Alt|Option|Shift|Command|Cmd)$/i.test(value);
}

function comparableShortcut(shortcut: string) {
  return String(shortcut || "")
    .replace(/\bCtrl\b/gi, "Control")
    .replace(/\bOption\b/gi, "Alt")
    .replace(/\bCmd\b/gi, "Command")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isSameShortcut(a: string, b: string) {
  return comparableShortcut(a) === comparableShortcut(b);
}
const TRANSLATION_LANGUAGES = [
  { label: "中文", value: "Chinese" },
  { label: "English", value: "English" },
  { label: "日本語", value: "Japanese" },
  { label: "Deutsch", value: "German" },
  { label: "Français", value: "French" },
];

function normalizedTargetLanguage(value: string) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "中文" || text === "chinese" || text === "zh") return "Chinese";
  if (text === "日本語" || text === "japanese" || text === "ja") return "Japanese";
  if (text === "deutsch" || text === "german" || text === "de") return "German";
  if (text === "français" || text === "francais" || text === "french" || text === "fr") return "French";
  return "English";
}

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
  if (isModifierToken(key)) return "native";
  return "electron";
}

function cameraDisplay(settings: AppSettings, status?: GestureHelperStatus) {
  if (settings.gestureTrigger.cameraIndex === -1) return "自动选择 Mac 摄像头";
  return settings.gestureTrigger.cameraLabel || status?.cameraName || "已选择外接摄像头";
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84" />
      <path d="M9.36 5.36A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a12.7 12.7 0 0 1-2.1 3.18" />
      <path d="M6.35 6.35C4.48 7.69 3.17 9.74 2.5 12c1 2.5 4.5 7 9.5 7 1.54 0 2.92-.43 4.1-1.08" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12c1-2.5 4.5-7 9.5-7s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7Z" />
      <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={active ? "status-dot active" : "status-dot"} aria-hidden="true" />;
}

function SwitchControl({ checked }: { checked: boolean }) {
  return (
    <span className={checked ? "switch-control on" : "switch-control"} aria-hidden="true">
      <span />
    </span>
  );
}

function SecretInput({
  value,
  visible,
  onToggle,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
}: {
  value: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <div className="secret-input">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
      />
      <button className="secret-toggle" type="button" onMouseDown={(event) => event.preventDefault()} onClick={onToggle} aria-label={ariaLabel} title={ariaLabel}>
        <EyeIcon hidden={!visible} />
      </button>
    </div>
  );
}

function modifierFromEvent(event: KeyboardEvent): ({ key: ModifierName } & ModifierState) | null {
  if (event.code === "ControlLeft") return { key: "Control", label: "Left Control", accelerator: "Control" };
  if (event.code === "ControlRight") return { key: "Control", label: "Right Control", accelerator: "Control" };
  if (event.code === "AltLeft") return { key: "Alt", label: "Left Option", accelerator: "Alt" };
  if (event.code === "AltRight") return { key: "Alt", label: "Right Option", accelerator: "Alt" };
  if (event.code === "ShiftLeft") return { key: "Shift", label: "Left Shift", accelerator: "Shift" };
  if (event.code === "ShiftRight") return { key: "Shift", label: "Right Shift", accelerator: "Shift" };
  if (event.code === "MetaLeft") return { key: "Command", label: "Left Command", accelerator: "Command" };
  if (event.code === "MetaRight") return { key: "Command", label: "Right Command", accelerator: "Command" };
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
  resetLabel,
}: {
  shortcut: string;
  display?: string[];
  onRecord: (shortcut: string, display: string[], backend?: "electron" | "native") => ShortcutSaveResult | void | Promise<ShortcutSaveResult | void>;
  onReset?: () => ShortcutSaveResult | void | Promise<ShortcutSaveResult | void>;
  onPermissionError?: (message: string) => void;
  resetLabel?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string>("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const activeModifiersRef = useRef<Partial<Record<ModifierName, ModifierState>>>({});
  const modifierTimerRef = useRef<number | null>(null);
  const captureAttemptRef = useRef(0);
  const committedRef = useRef(false);
  const recordingRef = useRef(false);

  const commitShortcut = useCallback(async (accelerator: string, displayTokens: string[], backend?: "electron" | "native") => {
    const result = await onRecord(accelerator, displayTokens, backend);
    if (result?.ok === false) {
      setMessage(result.message || "保存失败");
      return;
    }
    setMessage(result?.message || "已保存");
  }, [onRecord]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    if (!recording) return;

    const updatePreview = () => {
      const tokens = modifierOrder.map((key) => activeModifiersRef.current[key]?.label).filter(Boolean) as string[];
      setPreview(tokens.length > 0 ? tokens : null);
    };

    const clearModifierTimer = () => {
      if (modifierTimerRef.current) window.clearTimeout(modifierTimerRef.current);
      modifierTimerRef.current = null;
    };

    const finishShortcut = (accelerator: string, displayTokens: string[], backend = inferShortcutBackend(accelerator)) => {
      if (displayTokens.length > MAX_SHORTCUT_KEYS) {
        clearModifierTimer();
        activeModifiersRef.current = {};
        setPreview(null);
        setRecording(false);
        setMessage("快捷键最多支持 3 个按键");
        return;
      }
      clearModifierTimer();
      committedRef.current = true;
      captureAttemptRef.current += 1;
      activeModifiersRef.current = {};
      setPreview(null);
      setRecording(false);
      setMessage("");
      commitShortcut(accelerator, displayTokens, backend).catch(() => {});
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (committedRef.current) return;
      event.preventDefault();
      event.stopPropagation();

      const modifier = modifierFromEvent(event);
      if (modifier) {
        activeModifiersRef.current[modifier.key] = {
          label: modifier.label,
          accelerator: modifier.accelerator,
        };
        const modifierEntries = modifierOrder
          .map((name) => activeModifiersRef.current[name])
          .filter(Boolean) as ModifierState[];
        const displayTokens = modifierEntries.map((item) => item.label);
        const accelerators = modifierEntries.map((item) => item.accelerator);
        if (displayTokens.length > MAX_SHORTCUT_KEYS) {
          finishShortcut(accelerators.join("+"), displayTokens, "native");
          return;
        }
        setMessage("继续按键，或停顿保存当前组合");
        updatePreview();
        clearModifierTimer();
        modifierTimerRef.current = window.setTimeout(() => {
          finishShortcut(accelerators.join("+"), displayTokens, "native");
        }, 620);
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
        ...modifierKeys.map((name) => activeModifiersRef.current[name]?.label || name),
        key.label,
      ];
      finishShortcut(accelerator, displayTokens);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (committedRef.current) return;
      const modifier = modifierFromEvent(event);
      if (modifier) {
        delete activeModifiersRef.current[modifier.key];
        updatePreview();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    buttonRef.current?.focus();
    return () => {
      clearModifierTimer();
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [commitShortcut, recording]);

  const tokens = preview || shortcutDisplayTokens(shortcut, display);
  const visibleMessage = message && !message.includes("macOS 隐私设置") ? message : "";
  const messageTone = /失败|最多|重复|已被|不可用|不支持|超时|未捕获/.test(visibleMessage)
    ? "error"
    : /已保存|已恢复/.test(visibleMessage)
      ? "success"
      : "";

  const beginCapture = () => {
    const captureAttempt = captureAttemptRef.current + 1;
    captureAttemptRef.current = captureAttempt;
    committedRef.current = false;
    activeModifiersRef.current = {};
    setPreview(null);
    setMessage("");
    setRecording(true);
    const api = window.speakon;
    if (!api) return;

    window.setTimeout(() => {
      if (captureAttempt !== captureAttemptRef.current || committedRef.current || !recordingRef.current) return;
      api.captureShortcut()
        .then(async (result) => {
          if (captureAttempt !== captureAttemptRef.current || committedRef.current) return;
          if ("ok" in result && result.ok === false) {
            setMessage(result.error);
            if (result.needsPermission) onPermissionError?.(result.error);
            return;
          }
          if (result.shortcutDisplay.length > MAX_SHORTCUT_KEYS) {
            setMessage("快捷键最多支持 3 个按键");
            return;
          }
          committedRef.current = true;
          setPreview(null);
          setRecording(false);
          await commitShortcut(result.shortcut, result.shortcutDisplay, result.shortcutBackend);
        })
        .catch((err) => {
          if (captureAttempt !== captureAttemptRef.current || committedRef.current) return;
          const text = err instanceof Error ? err.message : String(err);
          setMessage(text);
        })
        .finally(() => {
          if (captureAttempt === captureAttemptRef.current && !committedRef.current) {
            setPreview(null);
            setRecording(false);
          }
        });
    }, 120);
  };

  const handleReset = async () => {
    if (!onReset) return;
    setMessage("");
    try {
      const result = await onReset();
      if (result?.ok === false) {
        setMessage(result.message || "恢复失败");
        return;
      }
      setMessage(result?.message || "已恢复");
    } catch {
      setMessage("恢复失败");
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
            <span className="shortcut-placeholder">输入快捷键</span>
          ) : (
            tokens.map((token) => <span className="key-chip" key={token}>{token}</span>)
          )}
        </button>
        {onReset && resetLabel && (
          <button className="shortcut-reset" type="button" onClick={handleReset}>
            {resetLabel}
          </button>
        )}
      </div>
      {visibleMessage && <div className={`shortcut-message ${messageTone}`}>{visibleMessage}</div>}
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
  const [llmKeyVisible, setLlmKeyVisible] = useState(false);
  const [asrKeyVisible, setAsrKeyVisible] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveStatusTimerRef = useRef<number | null>(null);
  const [cameraOptions, setCameraOptions] = useState<Array<{ index: number; label: string; builtIn?: boolean; automatic?: boolean }>>([
    { index: -1, label: "自动选择 Mac 摄像头", builtIn: true, automatic: true },
  ]);

  useEffect(() => setLocal(settings), [settings]);
  useEffect(() => setActiveSection(initialSection), [initialSection]);
  useEffect(() => setTemperatureText(String(settings.llm.temperature ?? 0.2)), [settings.llm.temperature]);
  useEffect(() => () => {
    if (saveStatusTimerRef.current) window.clearTimeout(saveStatusTimerRef.current);
  }, []);
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
  const withCurrentLLMProfile = (settingsToSync: AppSettings): AppSettings => {
    const llm = normalizeLLMConfig(settingsToSync.llm);
    return {
      ...settingsToSync,
      llm,
      llmProfiles: normalizeLLMProfiles(settingsToSync.llmProfiles, llm),
    };
  };
  const updateLLM = (patch: Partial<AppSettings["llm"]>) => {
    setLocal(withCurrentLLMProfile({ ...local, llm: { ...local.llm, ...patch } }));
  };
  const updateASR = (patch: Partial<AppSettings["asr"]>) => setLocal({ ...local, asr: { ...local.asr, ...patch } });
  const updateGesture = (patch: Partial<AppSettings["gestureTrigger"]>) =>
    setLocal({ ...local, gestureTrigger: { ...local.gestureTrigger, ...patch } });

  const persist = async (updated: AppSettings) => {
    const normalized = withCurrentLLMProfile(updated);
    setLocal(normalized);
    const saved = await onSave(normalized);
    const next = saved ? withCurrentLLMProfile(saved) : normalized;
    setLocal(next);
    return next;
  };

  const handleSave = () => {
    persist(local).catch(() => {});
  };

  const showSaveStatus = (status: "saved" | "error") => {
    setSaveStatus(status);
    if (saveStatusTimerRef.current) window.clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = window.setTimeout(() => setSaveStatus("idle"), 2400);
  };

  const handleManualSave = async () => {
    if (saveStatusTimerRef.current) window.clearTimeout(saveStatusTimerRef.current);
    setSaveStatus("saving");
    try {
      await persist(local);
      showSaveStatus("saved");
    } catch {
      showSaveStatus("error");
    }
  };

  const saveShortcut = async (shortcut: string, shortcutDisplay: string[], shortcutBackend = inferShortcutBackend(shortcut)): Promise<ShortcutSaveResult> => {
    if (isSameShortcut(shortcut, local.translateShortcut)) {
      return { ok: false, message: "这个快捷键已被另一项使用" };
    }
    const updated = { ...local, shortcut, shortcutDisplay, shortcutBackend };
    try {
      await persist(updated);
      setPermissionHint("");
      return { ok: true, message: "已保存" };
    } catch {
      return { ok: false, message: "保存失败" };
    }
  };

  const saveTranslateShortcut = async (translateShortcut: string, translateShortcutDisplay: string[], translateShortcutBackend = inferShortcutBackend(translateShortcut)): Promise<ShortcutSaveResult> => {
    if (isSameShortcut(translateShortcut, local.shortcut)) {
      return { ok: false, message: "这个快捷键已被另一项使用" };
    }
    const updated = { ...local, translateShortcut, translateShortcutDisplay, translateShortcutBackend };
    try {
      await persist(updated);
      setPermissionHint("");
      return { ok: true, message: "已保存" };
    } catch {
      return { ok: false, message: "保存失败" };
    }
  };

  const saveTargetLanguage = (targetLanguage: string) => {
    persist({ ...local, targetLanguage }).catch(() => {});
  };

  const resetShortcut = async (): Promise<ShortcutSaveResult> => {
    const fallback = {
      ...local,
      shortcut: "Control+Space",
      shortcutDisplay: ["Left Control", "Space"],
      shortcutBackend: "native" as const,
      shortcutDefaultMigrated: true,
    };
    setLocal(fallback);
    setPermissionHint("");
    try {
      if (window.speakon) {
        const updated = await window.speakon.resetShortcut();
        setLocal(updated);
      } else {
        await persist(fallback);
      }
      setPermissionHint("");
      return { ok: true, message: "已恢复" };
    } catch {
      try {
        await persist(fallback);
        setPermissionHint("");
        return { ok: true, message: "已恢复" };
      } catch {
        return { ok: false, message: "恢复失败" };
      }
    }
  };

  const resetTranslateShortcut = async (): Promise<ShortcutSaveResult> => {
    if (isSameShortcut("Command+Space", local.shortcut)) {
      return { ok: false, message: "这个快捷键已被另一项使用" };
    }
    const fallback = {
      ...local,
      translateShortcut: "Command+Space",
      translateShortcutDisplay: ["Left Command", "Space"],
      translateShortcutBackend: "native" as const,
    };
    setLocal(fallback);
    setPermissionHint("");
    try {
      await persist(fallback);
      setPermissionHint("");
      return { ok: true, message: "已恢复" };
    } catch {
      return { ok: false, message: "恢复失败" };
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
    const synced = withCurrentLLMProfile(local);
    const savedProfile = synced.llmProfiles?.[provider];
    const next = savedProfile
      ? normalizeLLMConfig({ ...savedProfile, provider })
      : defaultLLMConfigForProvider(provider, local.llm.temperature ?? 0.2);
    const updated = {
      ...synced,
      llm: next,
      llmProfiles: {
        ...(synced.llmProfiles || {}),
        [provider]: next,
      },
    };
    setTemperatureText(String(next.temperature ?? 0.2));
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
      const savedSettings = await persist(local);
      const data = window.speakon
        ? await window.speakon.testLLM(savedSettings)
        : await fetch(`${API}/api/test-llm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savedSettings),
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
  const selectedTargetLanguage = normalizedTargetLanguage(local.targetLanguage);
  const shortcutStatusText = shortcutStatus.message || "";
  const shortcutPermissionMessage = permissionHint || (/输入监控|辅助功能|macOS 隐私设置/.test(shortcutStatusText) ? shortcutStatusText : "");
  const shortcutNeedsPermission = Boolean(shortcutPermissionMessage);
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

  const detailTitle: Record<SettingsSection, string> = {
    shortcut: "键盘快捷键",
    snap: "响指",
    camera: "手掌识别",
    asr: "语音转文字",
    llm: "智能整理",
  };

  const saveAutoPaste = (autoPaste: boolean) => {
    persist({ ...local, autoPaste }).catch(() => {});
  };

  if (activeSection) {
    return (
      <div className="settings-minimal">
        <header className="page-header centered">
          <button className="icon-only ghost" type="button" onClick={() => setActiveSection(null)} aria-label="返回设置">
            <ChevronLeftIcon />
          </button>
          <h1>{detailTitle[activeSection]}</h1>
          <span className="header-spacer" />
        </header>

        {activeSection === "shortcut" && (
          <section className="settings-detail">
            <div className="shortcut-panel">
              <div className="shortcut-setting-row">
                <div className="shortcut-copy">
                  <strong>语音输入</strong>
                  <span>按下开始和停止语音输入。</span>
                </div>
                <ShortcutRecorder
                  shortcut={local.shortcut}
                  display={local.shortcutDisplay}
                  onRecord={(shortcut, display, backend) => {
                    setPermissionHint("");
                    return saveShortcut(shortcut, display, backend);
                  }}
                  onReset={resetShortcut}
                  onPermissionError={setPermissionHint}
                  resetLabel="恢复"
                />
              </div>

              <div className="shortcut-divider" />

              <div className="shortcut-setting-row">
                <div className="shortcut-copy">
                  <strong>翻译</strong>
                  <span>按下开始和停止翻译。</span>
                </div>
                <ShortcutRecorder
                  shortcut={local.translateShortcut}
                  display={local.translateShortcutDisplay}
                  onRecord={(shortcut, display, backend) => {
                    setPermissionHint("");
                    return saveTranslateShortcut(shortcut, display, backend);
                  }}
                  onReset={resetTranslateShortcut}
                  onPermissionError={setPermissionHint}
                  resetLabel="恢复"
                />
              </div>

              <div className="translation-language-row">
                <span>翻译目标语言</span>
                <div className="language-segment" role="group" aria-label="翻译目标语言">
                  {TRANSLATION_LANGUAGES.map((language) => (
                    <button
                      key={language.value}
                      className={selectedTargetLanguage === language.value ? "active" : ""}
                      type="button"
                      onClick={() => saveTargetLanguage(language.value)}
                    >
                      {language.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="shortcut-footnote">点击快捷键区域后直接按键，最多支持 3 个按键。</p>
            </div>
            {shortcutNeedsPermission && (
              <div className="permission-callout">
                <span>{shortcutPermissionMessage || "需要在 macOS 隐私设置中允许 Speak flow 使用输入监控/辅助功能。"}</span>
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
                <strong>手掌识别</strong>
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
          </section>
        )}

        {activeSection === "asr" && (
          <section className="settings-detail config-detail">
            <div className="connection-line">
              <span><StatusDot active={hasAsrApiKey} />{hasAsrApiKey ? "已连接" : "未配置"}</span>
              <strong>{asrProviderName}</strong>
            </div>
            <div className="form-group">
              <label>服务商</label>
              <select value={local.asr.provider} onChange={(e) => handleASRProviderChange(e.target.value as ASRProvider)}>
                {Object.entries(ASR_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>{preset.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{isAzureAsr ? "Azure OpenAI 地址" : local.asr.provider === "local_whisper_cpp" ? "whisper.cpp 可执行文件" : "接口地址"}</label>
              <input type="text" value={local.asr.baseUrl} onChange={(e) => updateASR({ baseUrl: e.target.value })} onBlur={handleSave} placeholder={isAzureAsr ? "https://YOUR_RESOURCE.openai.azure.com/" : "https://api.openai.com/v1"} />
            </div>
            <div className="form-group">
              <label>{isAzureAsr ? "Azure 部署名" : local.asr.provider === "local_whisper_cpp" ? "模型文件路径" : "模型"}</label>
              <input type="text" value={local.asr.model} onChange={(e) => updateASR({ model: e.target.value })} onBlur={handleSave} placeholder={isAzureAsr ? "whisper" : "whisper-1"} />
            </div>
            {isAzureAsr && (
              <div className="form-group">
                <label>Azure API 版本</label>
                <input type="text" value={local.asr.apiVersion || "2024-02-01"} onChange={(e) => updateASR({ apiVersion: e.target.value })} onBlur={handleSave} placeholder="2024-02-01" />
              </div>
            )}
            <div className="form-group">
              <label>密钥</label>
              <SecretInput
                value={local.asr.apiKey}
                visible={asrKeyVisible}
                onToggle={() => setAsrKeyVisible((visible) => !visible)}
                onChange={(apiKey) => updateASR({ apiKey })}
                onBlur={handleSave}
                placeholder="留空则使用系统语音"
                ariaLabel={asrKeyVisible ? "隐藏 ASR 密钥" : "显示 ASR 密钥"}
              />
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
          <section className="settings-detail config-detail">
            <div className="connection-line">
              <span><StatusDot active={local.llm.apiKey.trim().length > 0} />{local.llm.apiKey.trim() ? "已连接" : "未配置"}</span>
              <strong>{llmProviderName}</strong>
            </div>
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
              <input type="text" value={local.llm.model} onChange={(e) => updateLLM({ model: e.target.value })} onBlur={handleSave} placeholder="DeepSeek-R1 / kimi-k2.5 / MiniMax-M2.7" />
            </div>
            <div className="form-group">
              <label>密钥</label>
              <SecretInput
                value={local.llm.apiKey}
                visible={llmKeyVisible}
                onToggle={() => setLlmKeyVisible((visible) => !visible)}
                onChange={(apiKey) => updateLLM({ apiKey })}
                onBlur={handleSave}
                placeholder="sk-..."
                ariaLabel={llmKeyVisible ? "隐藏智能整理密钥" : "显示智能整理密钥"}
              />
            </div>
            <div className="form-group">
              <label>接口地址</label>
              <input type="text" value={local.llm.baseUrl} onChange={(e) => updateLLM({ baseUrl: e.target.value })} onBlur={handleSave} placeholder="https://api.deepseek.com/anthropic" />
            </div>
            <div className="form-row">
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
              <div className="form-group">
                <label>翻译目标语言</label>
                <input type="text" value={local.targetLanguage} onChange={(e) => update({ targetLanguage: e.target.value })} onBlur={handleSave} placeholder="English / 中文" />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleTestLLM} disabled={testing}>
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button className="btn btn-secondary" onClick={handleManualSave} disabled={saveStatus === "saving"}>
                {saveStatus === "saving" ? "保存中..." : "保存"}
              </button>
              {saveStatus !== "idle" && (
                <span className={`save-feedback ${saveStatus}`}>
                  {saveStatus === "saving" ? "正在保存" : saveStatus === "saved" ? "已保存" : "保存失败"}
                </span>
              )}
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

  return (
    <div className="settings-minimal">
      <header className="page-header centered">
        <button className="icon-only ghost" type="button" onClick={onClose} aria-label="返回">
          <ChevronLeftIcon />
        </button>
        <h1>设置</h1>
        <span className="header-spacer" />
      </header>

      <div className="settings-list">
        <button className="list-row" type="button" onClick={() => setActiveSection("shortcut")}>
          <span>快捷键</span>
          <strong>{shortcutNeedsPermission ? "需要权限" : shortcutSummary}</strong>
        </button>
        <button className="list-row switch-row" type="button" role="switch" aria-checked={local.gestureTrigger.snapEnabled} onClick={() => saveGesture({ snapEnabled: !local.gestureTrigger.snapEnabled })}>
          <span>响指</span>
          <SwitchControl checked={local.gestureTrigger.snapEnabled} />
        </button>
        <button className="list-row switch-row" type="button" role="switch" aria-checked={local.gestureTrigger.openPalmEnabled} onClick={() => saveGesture({ openPalmEnabled: !local.gestureTrigger.openPalmEnabled })}>
          <span>手掌识别</span>
          <SwitchControl checked={local.gestureTrigger.openPalmEnabled} />
        </button>
        <button className="list-row switch-row" type="button" role="switch" aria-checked={local.autoPaste} onClick={() => saveAutoPaste(!local.autoPaste)}>
          <span>直接插入光标</span>
          <SwitchControl checked={local.autoPaste} />
        </button>
        <button className="list-row" type="button" onClick={() => setActiveSection("asr")}>
          <span>语音转文字</span>
          <strong className="status-value"><StatusDot active={hasAsrApiKey} />{hasAsrApiKey ? asrProviderName : "未配置"}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => setActiveSection("llm")}>
          <span>智能整理</span>
          <strong className="status-value"><StatusDot active={local.llm.apiKey.trim().length > 0} />{local.llm.apiKey.trim() ? local.llm.model || llmProviderName : "未配置"}</strong>
        </button>
      </div>
    </div>
  );
}
