import type { LLMConfig } from "./types";
import type { ChatMessage } from "./openai-client";
import { callOpenAIChatCompletions } from "./openai-client";
import { callAnthropicMessages } from "./anthropic-client";

export async function callLLM(params: {
  config: LLMConfig;
  messages: ChatMessage[];
}): Promise<string> {
  const { config, messages } = params;

  if (config.apiFormat === "openai_chat_completions") {
    return callOpenAIChatCompletions({ config, messages });
  }
  if (config.apiFormat === "anthropic_messages") {
    return callAnthropicMessages({ config, messages });
  }
  if (config.apiFormat === "openai_responses") {
    throw new Error("当前版本暂不支持 OpenAI Responses 协议。");
  }
  throw new Error(`暂不支持的接口协议：${config.apiFormat}`);
}
