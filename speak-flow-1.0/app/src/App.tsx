import { useState, useRef, useCallback, useEffect } from "react";
import type { AppSettings, AppStatus, HistoryItem, ProcessResult, RewriteMode } from "./lib/types";
import SettingsPage, { type SettingsSection } from "./pages/SettingsPage";
import { AudioRecorder } from "./lib/recorder";
import { defaultSettings } from "./lib/default-settings";

const API = "http://localhost:19840";
const MODES: Array<{ value: RewriteMode; label: string }> = [
  { value: "raw", label: "原文" },
  { value: "polish", label: "润色" },
  { value: "email", label: "邮件" },
  { value: "slack", label: "飞书" },
  { value: "todo", label: "待办" },
  { value: "translate", label: "翻译" },
  { value: "list", label: "列表" },
];
const HOME_MODES: Array<{ value: RewriteMode; label: string }> = [
  { value: "raw", label: "原文" },
  { value: "polish", label: "润色" },
  { value: "translate", label: "翻译" },
  { value: "todo", label: "待办" },
];
const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  raw: "直接输入转写结果。",
  polish: "整理口语和错别字。",
  translate: "翻译成目标语言。",
  todo: "提取任务清单。",
};

function mergeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const loadedAsrMode = (input as { asrMode?: string } | null | undefined)?.asrMode;
  const loadedLlm = input?.llm;
  const next = {
    ...defaultSettings,
    ...(input || {}),
    llm: { ...defaultSettings.llm, ...(input?.llm || {}) },
    asr: { ...defaultSettings.asr, ...(input?.asr || {}) },
    gestureTrigger: { ...defaultSettings.gestureTrigger, ...(input?.gestureTrigger || {}) },
  };
  if (loadedAsrMode === "browser") {
    next.asrMode = "system";
  }
  if (!next.llm.baseUrl) {
    next.llm.baseUrl =
      loadedLlm?.baseUrlOpenAI ||
      loadedLlm?.baseUrlAnthropic ||
      defaultSettings.llm.baseUrl;
  }
  return next;
}

async function loadSettings(): Promise<AppSettings> {
  if (window.speakon) {
    return mergeSettings(await window.speakon.getSettings());
  }
  const settings = await fetch(`${API}/api/settings`).then((response) => response.json());
  return mergeSettings(settings);
}

async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (window.speakon) {
    return mergeSettings(await window.speakon.saveSettings(settings));
  }
  await fetch(`${API}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return settings;
}

async function copyText(text: string) {
  if (window.speakon) {
    await window.speakon.copyText(text);
    return;
  }
  await fetch(`${API}/api/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function statusCopy(status: AppStatus) {
  const labels: Record<AppStatus, string> = {
    idle: "空闲",
    recording: "正在录音",
    listening: "正在聆听",
    transcribing: "正在转写",
    rewriting: "正在整理",
    processing: "正在插入",
    canceled: "已取消",
    copied: "已复制",
    done: "已插入",
    error: "出错",
  };
  return labels[status] || status;
}

function hasAsrApiKey(settings: AppSettings) {
  return settings.asr.provider === "local_whisper_cpp" || settings.asr.apiKey.trim().length > 0;
}

function cleanErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function isCancelError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /abort|aborted|cancel|canceled|cancelled/i.test(message);
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function shortcutLabel(settings: AppSettings) {
  const tokens = settings.shortcutDisplay?.length
    ? settings.shortcutDisplay
    : String(settings.shortcut || "Control+Space").split("+");
  return tokens.join(" + ");
}

function primaryShortcutToken(settings: AppSettings) {
  const tokens = settings.shortcutDisplay?.length
    ? settings.shortcutDisplay
    : String(settings.shortcut || "Control+Space").split("+");
  return tokens.length === 1 ? tokens[0] : tokens.join(" + ");
}

function cameraLabel(settings: AppSettings) {
  if (settings.gestureTrigger.cameraIndex === -1) return "自动选择 Mac 摄像头";
  return settings.gestureTrigger.cameraLabel || "已选择外接摄像头";
}

function outputModeLabel(mode: RewriteMode) {
  return HOME_MODES.find((item) => item.value === mode)?.label ||
    MODES.find((item) => item.value === mode)?.label ||
    mode;
}

function outputSummary(settings: AppSettings) {
  if (settings.defaultMode === "todo") return "当前：待办整理";
  return `当前：${outputModeLabel(settings.defaultMode)}输入`;
}

function asrStatusSummary(settings: AppSettings) {
  if (settings.asr.provider === "local_whisper_cpp") return "本地可用";
  if (!settings.asr.apiKey.trim()) return "未配置，使用系统语音";
  if (settings.asr.provider === "azure_openai_whisper") return "Azure 已连接";
  return "已连接";
}

function llmStatusSummary(settings: AppSettings) {
  if (!settings.llm.apiKey.trim()) return "未配置，原文模式可用";
  if (settings.llm.provider === "deepseek") return "DeepSeek 已连接";
  return "已连接";
}

function snapStatusSummary(settings: AppSettings) {
  return settings.gestureTrigger.snapEnabled ? "已开启" : "已关闭";
}

function palmCameraSummary(settings: AppSettings) {
  return settings.gestureTrigger.openPalmEnabled ? cameraLabel(settings) : "未开启";
}

function shortErrorMessage(message: string) {
  if (/麦克风|microphone/i.test(message)) return "需要开启麦克风权限";
  if (/摄像头|camera/i.test(message)) return "需要检查摄像头权限";
  if (/输入监控|辅助功能|paste|osascript|System Events/i.test(message)) return "需要开启辅助功能权限";
  if (/ASR|转写|Whisper|API Key|401|403/i.test(message)) return "转写服务不可用";
  if (/智能整理|LLM|DeepSeek|model|messages/i.test(message)) return "智能整理服务不可用";
  return message.length > 34 ? `${message.slice(0, 34)}...` : message;
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function HistoryPanel({
  history,
  onCopy,
  onClear,
}: {
  history: HistoryItem[];
  onCopy: (text: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="history-panel">
      <div className="panel-heading">
        <div>
          <div className="section-title inline">历史记录</div>
          <p className="muted">最近 {history.length} 条语音输入</p>
        </div>
        <button className="icon-btn text-btn" onClick={onClear} disabled={history.length === 0}>
          清空
        </button>
      </div>

      {history.length === 0 ? (
        <div className="empty-state">还没有语音输入记录。</div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <article className="history-item" key={item.id}>
              <div className="history-meta">
                <span>{item.mode}</span>
                <span>{formatTime(item.createdAt)}</span>
              </div>
              <div className="history-text">{item.rewrittenText}</div>
              <details>
                <summary>原始转写</summary>
                <p>{item.rawTranscript}</p>
              </details>
              <button className="btn btn-secondary" onClick={() => onCopy(item.rewrittenText)}>
                复制
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function CurrentSettingsPanel({
  settings,
  onModeChange,
  onOpenSettings,
  onClose,
}: {
  settings: AppSettings;
  onModeChange: (mode: RewriteMode) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onClose: () => void;
}) {
  const currentMode = HOME_MODES.some((item) => item.value === settings.defaultMode)
    ? settings.defaultMode
    : "raw";

  return (
    <main className="page current-page">
      <header className="page-header">
        <button className="ghost-link" type="button" onClick={onClose}>返回</button>
        <h1>当前设置</h1>
        <button className="done-link" type="button" onClick={onClose}>完成</button>
      </header>

      <section className="output-panel">
        <div className="section-caption">输出方式</div>
        <div className="output-modes" role="group" aria-label="输出方式">
          {HOME_MODES.map((mode) => (
            <button
              key={mode.value}
              className={currentMode === mode.value ? "active" : ""}
              type="button"
              onClick={() => onModeChange(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p>{OUTPUT_DESCRIPTIONS[currentMode] || "按当前模式处理语音输入。"}</p>
      </section>

      <section className="settings-list compact-list" aria-label="当前状态">
        <button className="list-row" type="button" onClick={() => onOpenSettings("shortcut")}>
          <span>快捷键</span>
          <strong>{shortcutLabel(settings)}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => onOpenSettings("snap")}>
          <span>响指</span>
          <strong>{snapStatusSummary(settings)}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => onOpenSettings("camera")}>
          <span>摄像头与手掌</span>
          <strong>{palmCameraSummary(settings)}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => onOpenSettings("asr")}>
          <span>转写服务</span>
          <strong>{asrStatusSummary(settings)}</strong>
        </button>
        <button className="list-row" type="button" onClick={() => onOpenSettings("llm")}>
          <span>智能整理</span>
          <strong>{llmStatusSummary(settings)}</strong>
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [status, setStatusState] = useState<AppStatus>("idle");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "current" | "settings" | "history">("home");
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const speechRef = useRef<any | null>(null);
  const nativeSpeechActiveRef = useRef(false);
  const statusRef = useRef<AppStatus>("idle");
  const settingsRef = useRef<AppSettings>(defaultSettings);
  const settingsLoadedRef = useRef(false);
  const currentJobIdRef = useRef<string | null>(null);
  const canceledJobIdsRef = useRef<Set<string>>(new Set());
  const recordingStartRef = useRef<number>(0);

  const setStatus = useCallback((nextStatus: AppStatus) => {
    statusRef.current = nextStatus;
    setStatusState(nextStatus);
    window.speakon?.setStatus(nextStatus);
  }, []);

  const updateSettings = useCallback((nextSettings: AppSettings) => {
    const merged = mergeSettings(nextSettings);
    settingsRef.current = merged;
    setSettings(merged);
  }, []);

  useEffect(() => {
    loadSettings()
      .then((loadedSettings) => {
        updateSettings(loadedSettings);
        settingsLoadedRef.current = true;
      })
      .catch(() => {
        settingsLoadedRef.current = true;
      });

    if (window.speakon) {
      window.speakon.getHistory().then(setHistory).catch(() => {});
      const removeHistory = window.speakon.onHistoryChanged(setHistory);
      const removeSettings = window.speakon.onSettingsChanged(updateSettings);
      const removeView = window.speakon.onSetView((nextView) => {
        if (nextView === "settings" || nextView === "history" || nextView === "home" || nextView === "current") {
          if (nextView !== "settings") setSettingsSection(null);
          setView(nextView);
        }
      });
      return () => {
        removeHistory();
        removeSettings();
        removeView();
      };
    }
  }, [updateSettings]);

  const handleSaveSettings = useCallback(
    async (nextSettings: AppSettings) => {
      const merged = mergeSettings(nextSettings);
      updateSettings(merged);
      try {
        const saved = await saveSettings(merged);
        updateSettings(saved);
        return saved;
      } catch (err) {
        setError(cleanErrorMessage(err));
        throw err;
      }
    },
    [updateSettings],
  );

  const handleProcessResult = useCallback(
    (data: ProcessResult) => {
      if (data.requestId && data.requestId !== currentJobIdRef.current) return;
      if (data.requestId) canceledJobIdsRef.current.delete(data.requestId);
      currentJobIdRef.current = null;
      setLastTranscript(data.transcript);
      setLastResult(data.result);
      if (!data.pasted && data.pasteError) {
        setNotice("已复制，可手动粘贴");
      }
      setStatus(data.pasted ? "done" : "copied");
      setView("home");
    },
    [setStatus],
  );

  const processAudioBlob = useCallback(
    async (blob: Blob, durationMs: number, requestId: string) => {
      setStatus("transcribing");
      const current = settingsRef.current;
      if (window.speakon) {
        const audio = await blob.arrayBuffer();
        const data = await window.speakon.processAudio({
          requestId,
          audio,
          mode: current.defaultMode,
          targetLanguage: current.targetLanguage,
          durationMs,
        });
        if (canceledJobIdsRef.current.has(requestId) || currentJobIdRef.current !== requestId) return;
        handleProcessResult(data);
        return;
      }

      const resp = await fetch(`${API}/api/process`, {
        method: "POST",
        body: blob,
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      if (canceledJobIdsRef.current.has(requestId) || currentJobIdRef.current !== requestId) return;
      handleProcessResult({
        requestId,
        transcript: data.transcript,
        result: data.result,
        mode: data.mode || current.defaultMode,
      });
    },
    [handleProcessResult, setStatus],
  );

  const rewriteTranscript = useCallback(
    async (transcript: string, requestId = currentJobIdRef.current || createRequestId()) => {
      const current = settingsRef.current;
      setLastTranscript(transcript);
      setStatus(current.defaultMode === "raw" ? "processing" : "rewriting");

      if (window.speakon) {
        const data = await window.speakon.rewriteText({
          requestId,
          transcript,
          mode: current.defaultMode,
          targetLanguage: current.targetLanguage,
        });
        if (canceledJobIdsRef.current.has(requestId) || currentJobIdRef.current !== requestId) return;
        handleProcessResult(data);
        return;
      }

      const resp = await fetch(`${API}/api/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          mode: current.defaultMode,
          targetLanguage: current.targetLanguage,
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      if (canceledJobIdsRef.current.has(requestId) || currentJobIdRef.current !== requestId) return;
      handleProcessResult({
        requestId,
        transcript,
        result: data.result,
        mode: data.mode || current.defaultMode,
      });
    },
    [handleProcessResult, setStatus],
  );

  const startApiRecording = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const requestId = createRequestId();
      const recorder = new AudioRecorder();
      await recorder.start();
      currentJobIdRef.current = requestId;
      canceledJobIdsRef.current.delete(requestId);
      recorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      setStatus("recording");
      setView("home");
    } catch {
      setError("麦克风不可用。请在 macOS 隐私设置中允许 Speak flow 使用麦克风。");
      setStatus("error");
    }
  }, [setStatus]);

  const stopApiRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    const requestId = currentJobIdRef.current || createRequestId();

    try {
      const durationMs = Date.now() - recordingStartRef.current;
      const blob = await recorder.stop();
      if (canceledJobIdsRef.current.has(requestId)) return;
      await processAudioBlob(blob, durationMs, requestId);
    } catch (err) {
      if (canceledJobIdsRef.current.has(requestId) || isCancelError(err)) return;
      setError(cleanErrorMessage(err));
      setStatus("error");
    }
  }, [processAudioBlob, setStatus]);

  const startBrowserSpeech = useCallback(() => {
    setError(null);
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setError("当前运行环境不支持系统语音识别。请在设置中配置 ASR 接口。");
      setStatus("error");
      return;
    }

    const langMap: Record<string, string> = { zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
    const lang = langMap[settingsRef.current.asr.language || "zh"] || settingsRef.current.asr.language || "zh-CN";
    const rec = new SpeechRecognitionAPI();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = lang;

    rec.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      if (!transcript.trim()) return;
      speechRef.current = null;
      const requestId = currentJobIdRef.current || createRequestId();
      rewriteTranscript(transcript, requestId).catch((err) => {
        if (canceledJobIdsRef.current.has(requestId) || isCancelError(err)) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    };

    rec.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") {
        setStatus("idle");
        return;
      }
      setError(`语音识别出错：${event.error}`);
      setStatus("error");
    };

    rec.onend = () => {
      if (rec === speechRef.current) {
        speechRef.current = null;
        setStatus("idle");
      }
    };

    try {
      rec.start();
      speechRef.current = rec;
      setStatus("listening");
      setView("home");
    } catch (err) {
      setError(cleanErrorMessage(err));
      setStatus("error");
    }
  }, [rewriteTranscript, setStatus]);

  const stopBrowserSpeech = useCallback(() => {
    if (speechRef.current) {
      speechRef.current.stop();
    }
  }, []);

  const startSystemSpeech = useCallback(async () => {
    setError(null);
    setNotice(null);
    const requestId = createRequestId();
    currentJobIdRef.current = requestId;
    canceledJobIdsRef.current.delete(requestId);
    recordingStartRef.current = Date.now();
    setStatus("listening");
    setView("home");

    if (window.speakon?.startSystemSpeech) {
      try {
        nativeSpeechActiveRef.current = true;
        await window.speakon.startSystemSpeech({ language: settingsRef.current.asr.language || "zh" });
        return;
      } catch (err) {
        nativeSpeechActiveRef.current = false;
        setError(cleanErrorMessage(err));
        setStatus("error");
        return;
      }
    }

    startBrowserSpeech();
  }, [setStatus, startBrowserSpeech]);

  const stopSystemSpeech = useCallback(async () => {
    if (nativeSpeechActiveRef.current && window.speakon?.stopSystemSpeech) {
      const requestId = currentJobIdRef.current || createRequestId();
      try {
        nativeSpeechActiveRef.current = false;
        setStatus("transcribing");
        const { transcript } = await window.speakon.stopSystemSpeech();
        if (canceledJobIdsRef.current.has(requestId)) return;
        if (!transcript.trim()) {
          setStatus("idle");
          setError("没有识别到语音。可以稍微说久一点，或切换到 ASR 接口。");
          return;
        }
        await rewriteTranscript(transcript, requestId);
        return;
      } catch (err) {
        nativeSpeechActiveRef.current = false;
        if (canceledJobIdsRef.current.has(requestId) || isCancelError(err)) return;
        setError(cleanErrorMessage(err));
        setStatus("error");
        return;
      }
    }

    stopBrowserSpeech();
  }, [rewriteTranscript, setStatus, stopBrowserSpeech]);

  const startRecording = useCallback(() => {
    if (!settingsLoadedRef.current) return;
    window.speakon?.preparePasteTarget?.().catch(() => {});
    if (hasAsrApiKey(settingsRef.current)) {
      startApiRecording();
    } else {
      startSystemSpeech();
    }
  }, [startApiRecording, startSystemSpeech]);

  const stopRecording = useCallback(() => {
    if (statusRef.current === "recording") {
      stopApiRecording();
    } else {
      stopSystemSpeech();
    }
  }, [stopApiRecording, stopSystemSpeech]);

  const cancelRecording = useCallback(() => {
    const requestId = currentJobIdRef.current;
    if (requestId) {
      canceledJobIdsRef.current.add(requestId);
      window.speakon?.cancelJob(requestId).catch(() => {});
    }

    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    if (speechRef.current) {
      speechRef.current.abort();
      speechRef.current = null;
    }
    if (nativeSpeechActiveRef.current && window.speakon?.stopSystemSpeech) {
      nativeSpeechActiveRef.current = false;
      window.speakon.stopSystemSpeech({ silent: true }).catch(() => {});
    }

    currentJobIdRef.current = null;
    setLastTranscript(null);
    setLastResult(null);
    setError(null);
    setNotice("转写已取消");
    setStatus("canceled");
    window.setTimeout(() => {
      if (statusRef.current === "canceled") setStatus("idle");
    }, 900);
  }, [setStatus]);

  const toggleRecording = useCallback(() => {
    const currentStatus = statusRef.current;
    if (currentStatus === "recording" || currentStatus === "listening") {
      stopRecording();
    } else if (!["processing", "transcribing", "rewriting"].includes(currentStatus)) {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.code === "Space") {
        event.preventDefault();
        toggleRecording();
      }
    };
    window.addEventListener("keydown", handler);

    if (window.speakon) {
      const removeToggle = window.speakon.onToggleRecording(toggleRecording);
      const removeStart = window.speakon.onStartRecording(startRecording);
      const removeStop = window.speakon.onStopRecording(stopRecording);
      const removeCancel = window.speakon.onCancelRecording(cancelRecording);
      return () => {
        window.removeEventListener("keydown", handler);
        removeToggle();
        removeStart();
        removeStop();
        removeCancel();
      };
    }

    return () => window.removeEventListener("keydown", handler);
  }, [cancelRecording, startRecording, stopRecording, toggleRecording]);

  const isActive = status === "recording" || status === "listening";
  const isProcessing = status === "processing" || status === "transcribing" || status === "rewriting";
  const openSettings = useCallback((section?: SettingsSection) => {
    setSettingsSection(section || null);
    setView("settings");
  }, []);

  useEffect(() => {
    if (!isActive) {
      setElapsedMs(0);
      return;
    }

    const tick = () => setElapsedMs(Date.now() - recordingStartRef.current);
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [isActive]);

  return (
    <div className="app-shell">
      {view === "home" && (
        <main className="home-page">
          <header className="home-header">
            <h1>Speak flow</h1>
            <span className={`state-badge ${status}`}>{status === "idle" ? "就绪" : statusCopy(status)}</span>
          </header>

          <section className="home-hero">
            <h2>
              按 {primaryShortcutToken(settings)}，
              <br />
              说话就输入
            </h2>
            <p>{settings.gestureTrigger.snapEnabled ? "也可用响指触发。" : "也可点击按钮触发。"}</p>
          </section>

          <button
            className={`primary-record-button ${isActive ? "active" : ""}`}
            type="button"
            onClick={isActive ? stopRecording : startRecording}
            disabled={isProcessing}
          >
            {isActive ? "停止语音输入" : isProcessing ? statusCopy(status) : "开始语音输入"}
          </button>

          <button className="current-summary-row" type="button" onClick={() => setView("current")}>
            <span>{outputSummary(settings)}</span>
            <span aria-hidden="true">›</span>
          </button>

          {isActive && (
            <div className="recording-indicator recording-live">
              <div className="rec-icon" />
              <div className="recording-copy">
                <strong>{status === "listening" ? "正在聆听" : "正在录音"}</strong>
                <span>再次触发或点击停止后开始转写。</span>
              </div>
              <div className="recording-meter" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <time>{formatElapsed(elapsedMs)}</time>
              <button className="mini-action danger" type="button" onClick={cancelRecording}>取消</button>
            </div>
          )}

          {isProcessing && (
            <div className="recording-indicator busy">
              <div className="rec-icon" />
              <span>{statusCopy(status)}...</span>
              <button className="mini-action" type="button" onClick={cancelRecording}>取消</button>
            </div>
          )}

          {notice && <div className="toast-box">{notice}</div>}

          {error && (
            <details className="error-box compact-error">
              <summary>{shortErrorMessage(error)}</summary>
              <p>{error}</p>
            </details>
          )}

          {lastResult && (
            <details className="last-result-inline">
              <summary>最后一次输入</summary>
              <div className="result-header">
                <span>已写入或复制</span>
                <button className="icon-btn text-btn" type="button" onClick={() => copyText(lastResult)}>复制</button>
              </div>
              <div className="text">{lastResult}</div>
            </details>
          )}
        </main>
      )}

      {view === "current" && (
        <CurrentSettingsPanel
          settings={settings}
          onModeChange={(mode) => handleSaveSettings({ ...settings, defaultMode: mode })}
          onOpenSettings={openSettings}
          onClose={() => setView("home")}
        />
      )}

      {view === "settings" && (
        <main className="page">
          <SettingsPage
            settings={settings}
            initialSection={settingsSection}
            onSave={handleSaveSettings}
            onClose={() => {
              setSettingsSection(null);
              setView("home");
            }}
          />
        </main>
      )}

      {view === "history" && (
        <main className="page">
          <header className="page-header">
            <button className="ghost-link" type="button" onClick={() => setView("home")}>返回</button>
            <h1>历史</h1>
            <button className="done-link" type="button" onClick={() => setView("home")}>完成</button>
          </header>
          <HistoryPanel
            history={history}
            onCopy={(text) => copyText(text)}
            onClear={() => {
              if (window.speakon) {
                window.speakon.clearHistory().then(setHistory).catch(() => {});
              }
            }}
          />
        </main>
      )}
    </div>
  );
}
