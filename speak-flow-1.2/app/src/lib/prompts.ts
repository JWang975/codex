import type { RewriteMode } from "./types";

export function buildRewritePrompt(params: {
  mode: RewriteMode;
  transcript: string;
  targetLanguage?: string;
}): string {
  const { mode, transcript, targetLanguage = "English" } = params;

  if (mode === "raw") {
    return transcript;
  }

  if (mode === "polish") {
    return `你是一个语音输入文本整理器。用户说的是口语，请把它改写为可直接发送的自然文本。

要求：
1. 保留原意，不添加新事实。
2. 删除口癖、重复、停顿词。
3. 修正明显语法问题。
4. 输出最终文本即可，不要解释。

原始转写：
${transcript}`;
  }

  if (mode === "email") {
    return `把下面口语内容改写成一封可以直接发送的专业邮件。

要求：
1. 保留原意。
2. 语气专业、清晰、克制。
3. 不添加原文没有的事实。
4. 如果缺少收件人或署名，不要编造。
5. 输出邮件正文即可，不要解释。

原始转写：
${transcript}`;
  }

  if (mode === "slack") {
    return `把下面口语内容改写成适合 Slack、飞书或企业即时消息发送的短消息。

要求：
1. 保留原意，不添加新事实。
2. 语气自然、清晰、可执行。
3. 删除口癖、重复和停顿。
4. 如果原文有行动项，用简短条目表达。
5. 只输出消息正文，不要解释。

原始转写：
${transcript}`;
  }

  if (mode === "translate") {
    return `把下面内容翻译成 ${targetLanguage}。

要求：
1. 自然、准确。
2. 不改变原意。
3. 删除明显口癖和重复。
4. 只输出译文，不要解释。

原始转写：
${transcript}`;
  }

  if (mode === "todo") {
    return `从下面口语内容中提取待办事项。

要求：
1. 只提取明确需要执行的事项。
2. 每条必须包含动作和对象。
3. 如果 owner 缺失，标记为"待确认"。
4. 如果截止时间缺失，不要编造。
5. 明确取消、否定、不做的事项不要进入待办。
6. 输出 Markdown 列表。

格式：
- [ ] 动作 + 对象 | Owner：xxx | 截止时间：xxx

原始转写：
${transcript}`;
  }

  if (mode === "list") {
    return `把下面口语内容整理成结构清晰的 Markdown 列表。

要求：
1. 保留原意，不添加新事实。
2. 合并重复表达。
3. 按主题或顺序拆分成条目。
4. 只输出列表，不要解释。

原始转写：
${transcript}`;
  }

  return transcript;
}
