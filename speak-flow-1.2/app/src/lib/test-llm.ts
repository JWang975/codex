import type { LLMConfig } from "./types";
import { callLLM } from "./llm-client";

export async function testLLM(config: LLMConfig): Promise<string> {
  const result = await callLLM({
    config,
    messages: [
      { role: "system", content: "你是一个 API 连通性测试助手。" },
      { role: "user", content: "请只回复 OK" },
    ],
  });

  if (result.trim().toLowerCase().includes("ok")) {
    return "LLM connected";
  }
  return `LLM responded but not expected: ${result}`;
}
