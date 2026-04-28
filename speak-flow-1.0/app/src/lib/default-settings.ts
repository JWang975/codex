import type { AppSettings } from "./types";

export const defaultSettings: AppSettings = {
  shortcut: "Fn",
  shortcutDisplay: ["Fn"],
  shortcutBackend: "native",
  shortcutDefaultMigrated: true,
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
    apiFormat: "openai_chat_completions",
    authField: "ANTHROPIC_AUTH_TOKEN",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.2,
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlOpenAI: "https://api.deepseek.com/v1",
    baseUrlAnthropic: "https://api.deepseek.com/anthropic",
    anthropicVersion: "2023-06-01",
  },

  asr: {
    provider: "openai_whisper",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "whisper-1",
    language: "zh",
    apiVersion: "2024-02-01",
  },
};
