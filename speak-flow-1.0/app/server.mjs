import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 19840;

const defaultSettings = {
  shortcut: "Control+Space",
  shortcutDisplay: ["Left Control", "Space"],
  shortcutBackend: "electron",
  defaultMode: "polish",
  targetLanguage: "English",
  autoCopy: true,
  autoPaste: true,
  asrMode: "api",
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
    apiFormat: "openai_chat_completions",
    authField: "ANTHROPIC_AUTH_TOKEN",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.2,
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlOpenAI: "https://api.deepseek.com/v1",
    baseUrlAnthropic: "https://api.deepseek.com/anthropic",
    anthropicVersion: "2023-06-01",
  },
  asr: {
    provider: "openai_whisper",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "whisper-1",
    language: "zh",
    apiVersion: "2024-02-01",
  },
};

const DATA_DIR = join(__dirname, "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      return mergeSettings(defaultSettings, JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")));
    }
  } catch { /* ignore */ }
  return mergeSettings(defaultSettings, {});
}

function saveSettings(s) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(mergeSettings(settings, s), null, 2));
}

function mergeSettings(base, incoming) {
  const patch = incoming || {};
  return {
    ...base,
    ...patch,
    llm: mergeProtectedConfig(base.llm, patch.llm, ["apiKey", "baseUrl", "baseUrlOpenAI", "baseUrlAnthropic", "model", "anthropicVersion"]),
    asr: mergeProtectedConfig(base.asr, patch.asr, ["apiKey", "baseUrl", "model", "apiVersion"]),
    gestureTrigger: { ...base.gestureTrigger, ...(patch.gestureTrigger || {}) },
  };
}

function mergeProtectedConfig(baseConfig, incomingConfig, protectedKeys) {
  const next = { ...(baseConfig || {}) };
  if (!incomingConfig) return next;
  for (const [key, value] of Object.entries(incomingConfig)) {
    const existing = next[key];
    const keepExisting =
      protectedKeys.includes(key) &&
      typeof value === "string" &&
      value.trim() === "" &&
      typeof existing === "string" &&
      existing.trim() !== "";
    if (!keepExisting) next[key] = value;
  }
  return next;
}

let settings = loadSettings();

// --- Helpers ---
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function copyToClipboard(text) {
  try {
    execSync("pbcopy", { input: text });
    return true;
  } catch {
    return false;
  }
}

function notify(title, body) {
  try {
    const script = `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    execSync(`osascript -e '${script}'`);
  } catch { /* silent */ }
}

// --- LLM Client ---
async function callLLM(config, messages) {
  if (config.apiFormat === "openai_chat_completions") {
    const resp = await fetch(`${config.baseUrlOpenAI.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: config.temperature ?? 0.2 }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`智能整理失败：${resp.status} ${resp.statusText} ${errText}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  }

  if (config.apiFormat === "anthropic_messages") {
    const systemContent = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const anthropicMessages = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));

    const headers = { "Content-Type": "application/json", "anthropic-version": config.anthropicVersion || "2023-06-01" };
    if (config.authField === "ANTHROPIC_API_KEY") {
      headers["x-api-key"] = config.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const resp = await fetch(`${config.baseUrlAnthropic.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.model, system: systemContent, messages: anthropicMessages, max_tokens: 2048, temperature: config.temperature ?? 0.2 }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`智能整理失败：${resp.status} ${resp.statusText} ${errText}`);
    }
    const data = await resp.json();
    return data.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n").trim() || "";
  }

  throw new Error(`暂不支持的接口协议：${config.apiFormat}`);
}

// --- Prompt Builder ---
function buildRewritePrompt(mode, transcript, targetLang = "English") {
  if (mode === "raw") return transcript;
  if (mode === "polish") {
    return `你是一个语音输入文本整理器。用户说的是口语，请把它改写为可直接发送的自然文本。\n\n要求：\n1. 保留原意，不添加新事实。\n2. 删除口癖、重复、停顿词。\n3. 修正明显语法问题。\n4. 输出最终文本即可，不要解释。\n\n原始转写：\n${transcript}`;
  }
  if (mode === "email") {
    return `把下面口语内容改写成一封可以直接发送的专业邮件。\n\n要求：\n1. 保留原意。\n2. 语气专业、清晰、克制。\n3. 不添加原文没有的事实。\n4. 如果缺少收件人或署名，不要编造。\n5. 输出邮件正文即可，不要解释。\n\n原始转写：\n${transcript}`;
  }
  if (mode === "slack") {
    return `把下面口语内容改写成适合 Slack、飞书或企业即时消息发送的短消息。\n\n要求：\n1. 保留原意，不添加新事实。\n2. 语气自然、清晰、可执行。\n3. 删除口癖、重复和停顿。\n4. 如果原文有行动项，用简短条目表达。\n5. 只输出消息正文，不要解释。\n\n原始转写：\n${transcript}`;
  }
  if (mode === "translate") {
    return `把下面内容翻译成 ${targetLang}。\n\n要求：\n1. 自然、准确。\n2. 不改变原意。\n3. 删除明显口癖和重复。\n4. 只输出译文，不要解释。\n\n原始转写：\n${transcript}`;
  }
  if (mode === "todo") {
    return `从下面口语内容中提取待办事项。\n\n要求：\n1. 只提取明确需要执行的事项。\n2. 每条必须包含动作和对象。\n3. 如果 owner 缺失，标记为"待确认"。\n4. 如果截止时间缺失，不要编造。\n5. 明确取消、否定、不做的事项不要进入待办。\n6. 输出 Markdown 列表。\n\n格式：\n- [ ] 动作 + 对象｜Owner：xxx｜截止时间：xxx\n\n原始转写：\n${transcript}`;
  }
  if (mode === "list") {
    return `把下面口语内容整理成结构清晰的 Markdown 列表。\n\n要求：\n1. 保留原意，不添加新事实。\n2. 合并重复表达。\n3. 按主题或顺序拆分成条目。\n4. 只输出列表，不要解释。\n\n原始转写：\n${transcript}`;
  }
  return transcript;
}

// --- ASR ---
async function transcribeAudio(audioBuffer, config) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const isAzureWhisper = config.provider === "azure_openai_whisper" || baseUrl.includes(".openai.azure.com");
  const endpoint = isAzureWhisper
    ? `${baseUrl}/openai/deployments/${encodeURIComponent(config.model)}/audio/transcriptions?api-version=${encodeURIComponent(config.apiVersion || "2024-02-01")}`
    : `${baseUrl}/audio/transcriptions`;
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/webm" });
  formData.append("file", blob, "recording.webm");
  if (!isAzureWhisper) formData.append("model", config.model);
  if (config.language) formData.append("language", config.language);

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: isAzureWhisper ? { "api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`转写失败：${resp.status} ${resp.statusText} ${errText}`);
  }
  const data = await resp.json();
  return data.text;
}

// --- Router ---
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // GET /api/settings
    if (url.pathname === "/api/settings" && req.method === "GET") {
      return json(res, settings);
    }

    // POST /api/settings
    if (url.pathname === "/api/settings" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString());
      settings = mergeSettings(settings, body);
      saveSettings(settings);
      return json(res, { ok: true });
    }

    // POST /api/process - audio blob → ASR → LLM → clipboard
    if (url.pathname === "/api/process" && req.method === "POST") {
      const currentSettings = settings;
      const audioBuffer = await readBody(req);
      if (audioBuffer.length < 100) {
        return json(res, { error: "录音时间太短，请稍微说久一点。" }, 400);
      }

      const transcript = await transcribeAudio(audioBuffer, currentSettings.asr);
      if (currentSettings.defaultMode === "raw") {
        copyToClipboard(transcript);
        return json(res, { transcript, result: transcript, mode: "raw" });
      }

      const prompt = buildRewritePrompt(currentSettings.defaultMode, transcript, currentSettings.targetLanguage);
      const result = await callLLM(currentSettings.llm, [
        { role: "system", content: "你是一个高精度语音输入文本整理助手。你只输出最终可使用文本，不解释。" },
        { role: "user", content: prompt },
      ]);

      if (currentSettings.autoCopy) {
        copyToClipboard(result);
      }
      notify("Speak flow", "文字已复制");

      return json(res, { transcript, result, mode: currentSettings.defaultMode });
    }

    // POST /api/rewrite - text only, skip ASR
    if (url.pathname === "/api/rewrite" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString());
      const { transcript, mode, targetLanguage } = body;
      if (!transcript || !transcript.trim()) {
        return json(res, { error: "No transcript provided" }, 400);
      }
      const rewriteMode = mode || settings.defaultMode;
      const prompt = buildRewritePrompt(rewriteMode, transcript, targetLanguage || settings.targetLanguage);
      const result = await callLLM(settings.llm, [
        { role: "system", content: "你是一个高精度语音输入文本整理助手。你只输出最终可使用文本，不解释。" },
        { role: "user", content: prompt },
      ]);
      if (settings.autoCopy) {
        copyToClipboard(result);
      }
      notify("Speak flow", "文字已复制");
      return json(res, { transcript, result, mode: rewriteMode });
    }

    // POST /api/test-llm
    if (url.pathname === "/api/test-llm" && req.method === "POST") {
      const result = await callLLM(settings.llm, [
        { role: "system", content: "你是一个 API 连通性测试助手。" },
        { role: "user", content: "请只回复 OK" },
      ]);
      return json(res, { ok: result.trim().toLowerCase().includes("ok"), text: result });
    }

    // POST /api/copy
    if (url.pathname === "/api/copy" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString());
      const ok = copyToClipboard(body.text);
      return json(res, { ok });
    }

    // Serve static files
    const distPath = join(__dirname, "dist");
    let filePath = join(distPath, url.pathname === "/" ? "index.html" : url.pathname);

    if (existsSync(filePath) && !filePath.startsWith(distPath + "/../")) {
      // path ok
    } else {
      filePath = join(distPath, "index.html");
    }

    if (existsSync(filePath)) {
      const ext = filePath.split(".").pop();
      const mimeTypes = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml" };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      res.end(readFileSync(filePath));
      return;
    }

    return json(res, { error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, { error: msg }, 500);
  }
}

// --- Start ---
const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Speak flow server at http://localhost:${PORT}`);
});
