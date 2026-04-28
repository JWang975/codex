import type { LLMConfig, RewriteMode } from "./types";
import { buildRewritePrompt } from "./prompts";
import { callLLM } from "./llm-client";

export async function rewriteText(params: {
  transcript: string;
  mode: RewriteMode;
  targetLanguage?: string;
  config: LLMConfig;
}): Promise<string> {
  const { transcript, mode, targetLanguage, config } = params;

  if (mode === "raw") {
    return transcript;
  }

  const userPrompt = buildRewritePrompt({ mode, transcript, targetLanguage });

  return callLLM({
    config,
    messages: [
      {
        role: "system",
        content: "你是一个高精度语音输入文本整理助手。你只输出最终可使用文本，不解释。",
      },
      { role: "user", content: userPrompt },
    ],
  });
}
