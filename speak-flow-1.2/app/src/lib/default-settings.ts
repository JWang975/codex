import type { AppSettings } from "./types";

export const defaultSettings: AppSettings = {
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
