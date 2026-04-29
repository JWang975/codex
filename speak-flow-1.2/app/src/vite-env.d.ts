/// <reference types="vite/client" />

import type { AppSettings, AppStatus, GestureHelperStatus, HistoryItem, LocalAsrStatus, ProcessResult, RewriteMode, ShortcutStatus } from "./lib/types";

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
};

type SpeechRecognitionEventLike = Event & {
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    speakon?: {
      isElectron: boolean;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      getHistory: () => Promise<HistoryItem[]>;
      clearHistory: () => Promise<HistoryItem[]>;
      processAudio: (payload: {
        requestId?: string;
        audio: ArrayBuffer;
        mode: RewriteMode;
        targetLanguage?: string;
        durationMs?: number;
      }) => Promise<ProcessResult>;
      rewriteText: (payload: {
        requestId?: string;
        transcript: string;
        mode: RewriteMode;
        targetLanguage?: string;
      }) => Promise<ProcessResult>;
      cancelJob: (requestId: string) => Promise<{ ok: boolean }>;
      getLocalAsrStatus: () => Promise<LocalAsrStatus>;
      startSystemSpeech: (payload: { language?: string }) => Promise<{ ok: boolean }>;
      stopSystemSpeech: (payload?: { silent?: boolean }) => Promise<{ transcript: string }>;
      getGestureStatus: () => Promise<GestureHelperStatus>;
      restartGestureHelper: () => Promise<GestureHelperStatus>;
      listCameras: () => Promise<Array<{ index: number; label: string; builtIn?: boolean; automatic?: boolean }>>;
      getShortcutStatus: () => Promise<ShortcutStatus>;
      refreshShortcut: () => Promise<ShortcutStatus>;
      captureShortcut: () => Promise<{
        ok?: true;
        shortcut: string;
        shortcutDisplay: string[];
        shortcutBackend: "electron" | "native";
      } | {
        ok: false;
        error: string;
        needsPermission?: boolean;
      }>;
      resetShortcut: () => Promise<AppSettings>;
      openPermissions: (kind?: "accessibility" | "input-monitoring" | "microphone" | "camera") => Promise<{ ok: boolean }>;
      preparePasteTarget: () => Promise<{ ok: boolean; bundleId?: string; name?: string; ignored?: boolean }>;
      testLLM: (settings?: AppSettings) => Promise<{ ok: boolean; text: string; resolvedEndpoint?: string }>;
      copyText: (text: string) => Promise<{ ok: boolean }>;
      setStatus: (status: AppStatus) => void;
      showPanel: (view: string) => void;
      onToggleRecording: (callback: (payload?: { mode?: RewriteMode }) => void) => () => void;
      onStartRecording: (callback: () => void) => () => void;
      onStopRecording: (callback: () => void) => () => void;
      onCancelRecording: (callback: () => void) => () => void;
      onSetView: (callback: (view: string) => void) => () => void;
      onHistoryChanged: (callback: (items: HistoryItem[]) => void) => () => void;
      onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
      onGestureChanged: (callback: (status: GestureHelperStatus) => void) => () => void;
      onShortcutChanged: (callback: (status: ShortcutStatus) => void) => () => void;
      removeAllListeners: () => void;
    };
  }
}
