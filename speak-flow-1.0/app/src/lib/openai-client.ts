import type { LLMConfig } from "./types";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function callOpenAIChatCompletions(params: {
  config: LLMConfig;
  messages: ChatMessage[];
}): Promise<string> {
  const { config, messages } = params;

  if (!config.apiKey) {
    throw new Error("缺少智能整理密钥。");
  }
  if (!config.baseUrlOpenAI) {
    throw new Error("缺少 OpenAI 兼容接口地址。");
  }
  if (!config.model) {
    throw new Error("缺少智能整理模型。");
  }

  const endpoint = `${config.baseUrlOpenAI.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      ...(config.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature ?? 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenAI Chat Completions request failed: ${response.status} ${response.statusText} ${errorText}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("智能整理没有返回文本。");
  }
  return content.trim();
}
