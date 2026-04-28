import type { ASRConfig, LLMConfig, ApiFormat, AuthField, ASRProvider, LLMProvider } from "./types";

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
    defaultApiFormat: "openai_chat_completions",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultBaseUrlOpenAI: "https://api.deepseek.com/v1",
    defaultBaseUrlAnthropic: "https://api.deepseek.com/anthropic",
    defaultAnthropicVersion: "2023-06-01",
  },
  minimax: {
    label: "MiniMax",
    defaultApiFormat: "openai_chat_completions",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "MiniMax-M1",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    defaultBaseUrlOpenAI: "https://api.minimax.chat/v1",
    defaultBaseUrlAnthropic: "",
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
    defaultApiFormat: "openai_chat_completions",
    defaultAuthField: "ANTHROPIC_AUTH_TOKEN",
    defaultModel: "moonshot-v1-8k",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultBaseUrlOpenAI: "https://api.moonshot.cn/v1",
    defaultBaseUrlAnthropic: "",
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

export function applyLLMPreset(provider: LLMProvider, config: LLMConfig): LLMConfig {
  const preset = LLM_PRESETS[provider];
  if (!preset) return config;
  return {
    ...config,
    provider: config.provider,
    apiFormat: (preset.defaultApiFormat as LLMConfig["apiFormat"]) ?? config.apiFormat,
    authField: (preset.defaultAuthField as LLMConfig["authField"]) ?? config.authField,
    model: preset.defaultModel ?? config.model,
    baseUrl: preset.defaultBaseUrl ?? config.baseUrl,
    baseUrlOpenAI: preset.defaultBaseUrlOpenAI ?? config.baseUrlOpenAI,
    baseUrlAnthropic: preset.defaultBaseUrlAnthropic ?? config.baseUrlAnthropic,
    anthropicVersion: preset.defaultAnthropicVersion ?? config.anthropicVersion,
  };
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
