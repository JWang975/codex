export type RewriteMode =
  | "raw"
  | "polish"
  | "email"
  | "slack"
  | "translate"
  | "todo"
  | "list";

export type AsrMode = "auto" | "api" | "system";

export type ASRProvider =
  | "openai_whisper"
  | "azure_openai_whisper"
  | "local_whisper_cpp"
  | "groq_whisper"
  | "siliconflow_sensevoice"
  | "custom_whisper";

export type ASRConfig = {
  provider: ASRProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string;
  apiVersion?: string;
};

export type LLMProvider =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "minimax"
  | "qwen"
  | "kimi"
  | "custom";

export type ApiFormat =
  | "openai_chat_completions"
  | "anthropic_messages"
  | "openai_responses";

export type AuthField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

export type LLMConfig = {
  provider: LLMProvider;
  apiFormat: ApiFormat;
  authField: AuthField;
  apiKey: string;
  model: string;
  temperature: number;
  baseUrl: string;
  baseUrlOpenAI?: string;
  baseUrlAnthropic?: string;
  anthropicVersion?: string;
  extraHeaders?: Record<string, string>;
};

export type LLMProfiles = Partial<Record<LLMProvider, LLMConfig>>;

export type AppSettings = {
  shortcut: string;
  shortcutDisplay?: string[];
  shortcutBackend?: "electron" | "native";
  shortcutDefaultMigrated?: boolean;
  translateShortcut: string;
  translateShortcutDisplay?: string[];
  translateShortcutBackend?: "electron" | "native";
  defaultMode: RewriteMode;
  targetLanguage: string;
  autoCopy: boolean;
  autoPaste: boolean;
  asrMode: AsrMode;
  gestureTrigger: GestureTriggerSettings;
  llm: LLMConfig;
  llmProfiles?: LLMProfiles;
  asr: ASRConfig;
};

export type GestureTriggerSettings = {
  enabled: boolean;
  snapEnabled: boolean;
  openPalmEnabled: boolean;
  holdDurationMs: number;
  cooldownMs: number;
  startupGraceMs: number;
  cameraIndex: number;
  cameraLabel?: string;
};

export type AppStatus =
  | "idle"
  | "recording"
  | "listening"
  | "transcribing"
  | "rewriting"
  | "processing"
  | "canceled"
  | "copied"
  | "done"
  | "error";

export type HistoryItem = {
  id: string;
  rawTranscript: string;
  rewrittenText: string;
  mode: RewriteMode;
  createdAt: number;
  durationMs?: number;
  error?: string;
};

export type ProcessResult = {
  requestId?: string;
  transcript: string;
  result: string;
  mode: RewriteMode;
  copied?: boolean;
  pasted?: boolean;
  pasteError?: string;
};

export type LocalAsrStatus = {
  available: boolean;
  executable?: string;
  ffmpeg?: string;
  message: string;
};

export type GestureHelperStatus = {
  status: "disabled" | "starting" | "ready" | "degraded" | "error" | "stopped";
  capabilities: Array<"snap" | "open_palm">;
  message?: string;
  pid?: number;
  cameraIndex?: number;
  cameraName?: string;
  updatedAt?: number;
};

export type ShortcutStatus = {
  status: "disabled" | "starting" | "ready" | "error" | "stopped";
  backend: "electron" | "native";
  shortcut: string;
  message?: string;
  pid?: number;
  updatedAt?: number;
};
