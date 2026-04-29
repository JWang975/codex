import type { ASRConfig, LLMConfig, LLMProfiles, ApiFormat, AuthField, ASRProvider, LLMProvider } from "./types";

const MINIMAX_DEFAULT_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic";
const MINIMAX_DEFAULT_OPENAI_BASE_URL = "https://api.minimax.io/v1";
const MINIMAX_LEGACY_ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic";
const MINIMAX_LEGACY_OPENAI_BASE_URL = "https://api.minimax.chat/v1";

export interface ASRPreset {
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultApiVersion?: string;
}

export interface LLMPreset {
  label: string;
  defaultApiFormat: ApiFormat;
  defaultAuthField: AuthField;
  defaultModel: string;
  defaultBaseUrl: string;
  defaultBaseUrlOpenAI: string;
  defaultBaseUrlAnthropic: string;
  defaultAnthropicVersion?: string;
}

export const ASR_PRESETS: Record<ASRProvider, ASRPreset> = {
  openai_whisper: {
    label: "OpenAI Whisper",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "whisper-1",
  },
  azure_openai_whisper: {
    label: "Azure OpenAI Whisper",
    defaultBaseUrl: "https://YOUR_RESOURCE.openai.azure.com/",
    defaultModel: "whisper",
    defaultApiVersion: "2024-02-01",
  },
  local_whisper_cpp: {
    label: "本地 whisper.cpp",
    defaultBaseUrl: "",
    defaultModel: "",
  },
  groq_whisper: {
    label: "Groq Whisper",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3",
  },
  siliconflow_sensevoice: {
    label: "SiliconFlow SenseVoice",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "FunAudioLLM/SenseVoiceSmall",
  },
  custom_whisper: {
    label: "自定义 Whisper 兼容",
    defaultBaseUrl: "",
    defaultModel: "",
  },
};

export const LLM_PRESETS: Record<LLMProvider, LLMPreset> = {
  openai: {
    label: "OpenAI",
    defaultApiFormat: "openai_chat_completions",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultBaseUrlOpenAI: "https://api.openai.com/v1",
    defaultBaseUrlAnthropic: "",
  },
  anthropic: {
    label: "Anthropic",
    defaultApiFormat: "anthropic_messages",
    defaultAuthField: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-sonnet-latest",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultBaseUrlOpenAI: "",
    defaultBaseUrlAnthropic: "https://api.anthropic.com/v1",
    defaultAnthropicVersion: "2023-06-01",
  },
  deepseek: {
    label: "DeepSeek",
    defaultApiFormat: "anthropic_messages",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "DeepSeek-R1",
    defaultBaseUrl: "https://api.deepseek.com/anthropic",
    defaultBaseUrlOpenAI: "https://api.deepseek.com/v1",
    defaultBaseUrlAnthropic: "https://api.deepseek.com/anthropic",
    defaultAnthropicVersion: "2023-06-01",
  },
  minimax: {
    label: "MiniMax",
    defaultApiFormat: "anthropic_messages",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "MiniMax-M2.7",
    defaultBaseUrl: MINIMAX_DEFAULT_ANTHROPIC_BASE_URL,
    defaultBaseUrlOpenAI: MINIMAX_DEFAULT_OPENAI_BASE_URL,
    defaultBaseUrlAnthropic: MINIMAX_DEFAULT_ANTHROPIC_BASE_URL,
    defaultAnthropicVersion: "2023-06-01",
  },
  qwen: {
    label: "Qwen / DashScope",
    defaultApiFormat: "openai_chat_completions",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "qwen-plus",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultBaseUrlOpenAI: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultBaseUrlAnthropic: "",
  },
  kimi: {
    label: "Kimi",
    defaultApiFormat: "anthropic_messages",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "kimi-k2.5",
    defaultBaseUrl: "https://api.moonshot.cn/anthropic",
    defaultBaseUrlOpenAI: "https://api.moonshot.cn/v1",
    defaultBaseUrlAnthropic: "https://api.moonshot.cn/anthropic",
    defaultAnthropicVersion: "2023-06-01",
  },
  custom: {
    label: "自定义",
    defaultApiFormat: "openai_chat_completions",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "",
    defaultBaseUrl: "",
    defaultBaseUrlOpenAI: "",
    defaultBaseUrlAnthropic: "",
  },
};

function cleanBaseUrl(baseUrl?: string) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function pickLLMBaseUrl(config: Partial<LLMConfig>) {
  const explicitBaseUrl = cleanBaseUrl(config.baseUrl);
  if (explicitBaseUrl) return explicitBaseUrl;
  if (config.apiFormat === "anthropic_messages") {
    return cleanBaseUrl(config.baseUrlAnthropic || config.baseUrlOpenAI);
  }
  if (config.apiFormat === "openai_chat_completions") {
    return cleanBaseUrl(config.baseUrlOpenAI || config.baseUrlAnthropic);
  }
  return cleanBaseUrl(config.baseUrlAnthropic || config.baseUrlOpenAI);
}

function migrateLegacyProviderBaseUrl(config: Partial<LLMConfig>, baseUrl: string) {
  if (
    config.provider === "minimax" &&
    baseUrl === MINIMAX_LEGACY_ANTHROPIC_BASE_URL &&
    cleanBaseUrl(config.baseUrlOpenAI) === MINIMAX_LEGACY_OPENAI_BASE_URL
  ) {
    return MINIMAX_DEFAULT_ANTHROPIC_BASE_URL;
  }
  return baseUrl;
}

export function inferLLMApiFormat(baseUrl?: string): ApiFormat {
  const normalized = cleanBaseUrl(baseUrl).toLowerCase();
  if (normalized.includes("anthropic.com") || normalized.includes("/anthropic")) {
    return "anthropic_messages";
  }
  return "openai_chat_completions";
}

export function normalizeLLMConfig(config: LLMConfig): LLMConfig {
  const baseUrl = migrateLegacyProviderBaseUrl(config, pickLLMBaseUrl(config));
  const apiFormat = inferLLMApiFormat(baseUrl);
  return {
    ...config,
    baseUrl,
    apiFormat,
    baseUrlOpenAI: apiFormat === "openai_chat_completions" ? baseUrl : config.baseUrlOpenAI,
    baseUrlAnthropic: apiFormat === "anthropic_messages" ? baseUrl : config.baseUrlAnthropic,
    anthropicVersion: config.anthropicVersion || "2023-06-01",
  };
}

export function defaultLLMConfigForProvider(provider: LLMProvider, temperature = 0.2): LLMConfig {
  const preset = LLM_PRESETS[provider];
  return normalizeLLMConfig({
    provider,
    apiFormat: preset?.defaultApiFormat || "openai_chat_completions",
    authField: preset?.defaultAuthField || "ANTHROPIC_AUTH_TOKEN",
    apiKey: "",
    model: preset?.defaultModel || "",
    temperature,
    baseUrl: preset?.defaultBaseUrl || "",
    baseUrlOpenAI: preset?.defaultBaseUrlOpenAI || "",
    baseUrlAnthropic: preset?.defaultBaseUrlAnthropic || "",
    anthropicVersion: preset?.defaultAnthropicVersion || "2023-06-01",
  });
}

export function normalizeLLMProfiles(profiles: LLMProfiles | undefined, activeConfig: LLMConfig): LLMProfiles {
  const normalized: LLMProfiles = {};
  for (const [provider, profile] of Object.entries(profiles || {}) as Array<[LLMProvider, LLMConfig | undefined]>) {
    if (profile) normalized[provider] = normalizeLLMConfig({ ...profile, provider });
  }
  const active = normalizeLLMConfig(activeConfig);
  normalized[active.provider] = active;
  return normalized;
}

export function applyLLMPreset(provider: LLMProvider, config: LLMConfig): LLMConfig {
  const preset = LLM_PRESETS[provider];
  if (!preset) return config;
  return normalizeLLMConfig({
    ...config,
    provider: config.provider,
    apiFormat: (preset.defaultApiFormat as LLMConfig["apiFormat"]) ?? config.apiFormat,
    authField: (preset.defaultAuthField as LLMConfig["authField"]) ?? config.authField,
    model: preset.defaultModel ?? config.model,
    baseUrl: preset.defaultBaseUrl ?? config.baseUrl,
    baseUrlOpenAI: preset.defaultBaseUrlOpenAI ?? config.baseUrlOpenAI,
    baseUrlAnthropic: preset.defaultBaseUrlAnthropic ?? config.baseUrlAnthropic,
    anthropicVersion: preset.defaultAnthropicVersion ?? config.anthropicVersion,
  });
}

export function applyASRPreset(provider: ASRProvider, config: ASRConfig): ASRConfig {
  const preset = ASR_PRESETS[provider];
  if (!preset) return config;
  return {
    ...config,
    provider: config.provider,
    baseUrl: preset.defaultBaseUrl ?? config.baseUrl,
    model: preset.defaultModel ?? config.model,
    apiVersion: preset.defaultApiVersion ?? config.apiVersion,
  };
}
