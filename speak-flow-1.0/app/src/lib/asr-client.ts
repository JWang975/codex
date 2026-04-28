import type { ASRConfig } from "./types";

export async function transcribeAudio(params: {
  audioBlob: Blob;
  config: ASRConfig;
}): Promise<string> {
  const { audioBlob, config } = params;

  if (!config.apiKey) throw new Error("缺少 ASR 密钥。");
  if (!config.baseUrl) throw new Error("缺少 ASR 接口地址。");
  if (!config.model) throw new Error("缺少 ASR 模型或部署名。");

  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const isAzureWhisper = config.provider === "azure_openai_whisper" || baseUrl.includes(".openai.azure.com");
  const endpoint = isAzureWhisper
    ? `${baseUrl}/openai/deployments/${encodeURIComponent(config.model)}/audio/transcriptions?api-version=${encodeURIComponent(config.apiVersion || "2024-02-01")}`
    : `${baseUrl}/audio/transcriptions`;

  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  if (!isAzureWhisper) {
    formData.append("model", config.model);
  }
  if (config.language) {
    formData.append("language", config.language);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: isAzureWhisper ? { "api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ASR request failed: ${response.status} ${response.statusText} ${errorText}`
    );
  }

  const data = await response.json();
  if (!data.text) throw new Error("ASR 没有返回文本。");
  return data.text;
}
