import type { LLMConfig } from "./types";
import type { ChatMessage } from "./openai-client";

function buildAnthropicHeaders(config: LLMConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": config.anthropicVersion || "2023-06-01",
    ...(config.extraHeaders ?? {}),
  };
  if (config.authField === "ANTHROPIC_API_KEY") {
    headers["x-api-key"] = config.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function splitSystemMessage(messages: ChatMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const normalMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  return { system: systemMessages, messages: normalMessages };
}

export async function callAnthropicMessages(params: {
  config: LLMConfig;
  messages: ChatMessage[];
}): Promise<string> {
  const { config, messages } = params;

  if (!config.apiKey) {
    throw new Error("缺少智能整理密钥。");
  }
  if (!config.baseUrlAnthropic) {
    throw new Error("缺少 Anthropic 接口地址。");
  }
  if (!config.model) {
    throw new Error("缺少智能整理模型。");
  }

  const endpoint = `${config.baseUrlAnthropic.replace(/\/$/, "")}/messages`;
  const { system, messages: anthropicMessages } = splitSystemMessage(messages);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildAnthropicHeaders(config),
    body: JSON.stringify({
      model: config.model,
      system,
      messages: anthropicMessages,
      max_tokens: 2048,
      temperature: config.temperature ?? 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic Messages request failed: ${response.status} ${response.statusText} ${errorText}`
    );
  }

  const data = await response.json();
  const text = data.content
    ?.filter((item: any) => item.type === "text")
    ?.map((item: any) => item.text)
    ?.join("\n")
    ?.trim();

  if (!text) {
    throw new Error("智能整理没有返回文本。");
  }
  return text;
}
