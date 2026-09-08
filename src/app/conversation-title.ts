import type { ChatMessage, Locale } from "../domain/chat";
import type { StreamChatMessage } from "../services/chat-client";

const DEFAULT_TITLES = new Set(["新的对话", "新しい会話"]);

export function isDefaultTitle(title: string): boolean {
  return DEFAULT_TITLES.has(title.trim());
}

export function defaultTitleForLocale(locale: Locale): string {
  return locale === "ja-JP" ? "新しい会話" : "新的对话";
}

const ZH_PREFIX_REGEX = /^(?:(?:你好|您好|请问(?:一下)?|请教一下|想问(?:一下)?|八千代(?:酱)?)[，,：:\s]*)+/u;
const JA_PREFIX_REGEX = /^(?:(?:こんにちは|初めまして|質問です(?:が)?|教えてください|八千代(?:ちゃん)?)[、,\s]*)+/u;
const TRAILING_PUNCTUATION_REGEX = /[？?！!。.,，;；…~～\s]+$/u;
const MAXIMUM_TITLE_LENGTH = 20;

/**
 * 根据会话消息列表提炼简短贴切的对话标题（启发式保底）
 */
export function generateConversationTitle(
  messages: readonly ChatMessage[],
  locale: Locale = "zh-CN",
): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) {
    return defaultTitleForLocale(locale);
  }

  const rawText = firstUserMessage.text.trim();
  const hadCodeBlock = /```[\s\S]*?```/.test(rawText);
  // 剥离 Markdown 代码块与 HTML 标签，聚焦自然语言主题
  const text = rawText
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();

  // 若剥离后无纯文本，按图片或纯代码做兜底
  if (!text) {
    if (firstUserMessage.imageId) {
      return locale === "ja-JP" ? "画像分析" : "图片分析";
    }
    if (hadCodeBlock) {
      return locale === "ja-JP" ? "コード分析" : "代码分析";
    }
    return defaultTitleForLocale(locale);
  }

  // 取首个有效行
  let line = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? "";

  // 剥离行首 Markdown 语法标记（标题、引用、无序/有序列表）与反引号
  line = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/`/g, "")
    .trim();

  // 剥离礼貌问候与前缀（若剥离后内容充足）
  const prefixRegex = locale === "ja-JP" ? JA_PREFIX_REGEX : ZH_PREFIX_REGEX;
  const stripped = line.replace(prefixRegex, "").trim();
  if (Array.from(stripped).length >= 2) {
    line = stripped;
  }

  // 剥离句末标点符号
  line = line.replace(TRAILING_PUNCTUATION_REGEX, "").trim();

  if (!line) {
    return defaultTitleForLocale(locale);
  }

  // 智能字符截断（支持 Unicode 码点）
  const codePoints = Array.from(line);
  if (codePoints.length > MAXIMUM_TITLE_LENGTH) {
    return codePoints.slice(0, MAXIMUM_TITLE_LENGTH - 1).join("") + "…";
  }

  return line;
}

const AI_TITLE_PREFIX_REGEX =
  /^(?:(?:好的[，,。]?\s*)*(?:为你|为您)?(?:生成|提炼|总结|建议)?(?:的)?(?:对话)?(?:标题|主题|Topic|Title)(?:为|是)?[：:\s]*)+/i;
const SURROUNDING_QUOTES_REGEX = /^["'“”‘’《》「」『』【】（）()[\]]+|["'“”‘’《》「」『』【】（）()[\]]+$/gu;

/**
 * 清洗大模型输出的对话标题，剥离书名号、标点符号、前缀并校验有效性
 */
export function cleanAiGeneratedTitle(
  rawText: string,
  locale: Locale = "zh-CN",
): string | undefined {
  if (!rawText) return undefined;

  // 1. 若输出中包含明确的书名号或成对引号，优先提取其中的核心标题文本
  const quotedMatch = rawText.match(/[《“"「『]([^》”"」』\r\n]{2,30})[》”"」』]/);
  let text = quotedMatch?.[1] ? quotedMatch[1] : rawText;

  // 2. 去除 Markdown 格式标记（标题、粗体、斜体、反引号等），取首行有效文本
  text = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .split(/\r?\n/)[0] ?? "";

  text = text.trim();

  // 3. 去除常见礼貌回复前缀（如“好的，为你生成的标题是：”、“Title:”等）
  text = text.replace(AI_TITLE_PREFIX_REGEX, "").trim();

  // 4. 去除包裹在外层的引号、书名号、括号
  text = text.replace(SURROUNDING_QUOTES_REGEX, "").trim();

  // 5. 去除末尾的标点符号
  text = text.replace(TRAILING_PUNCTUATION_REGEX, "").trim();

  // 6. 长度与有效性检查
  const codePoints = Array.from(text);
  if (codePoints.length < 2) {
    return undefined;
  }

  // 拒绝默认无意义标题
  if (isDefaultTitle(text) || text === defaultTitleForLocale(locale)) {
    return undefined;
  }

  // 若模型意外输出了长段落（>30字），视为未遵循精炼标题指令，丢弃
  if (codePoints.length > 30) {
    return undefined;
  }

  if (codePoints.length > MAXIMUM_TITLE_LENGTH) {
    return codePoints.slice(0, MAXIMUM_TITLE_LENGTH - 1).join("") + "…";
  }

  return text;
}

/**
 * 提取会话前几轮对话的核心内容并构造向大模型请求标题的消息列表
 */
export function buildTitleRequestMessages(
  messages: readonly ChatMessage[],
  locale: Locale = "zh-CN",
): StreamChatMessage[] {
  // 提取前几条消息（最多前4条），兼顾问题与助手的初步回答
  const relevantMessages = messages.slice(0, 4);
  const conversationSummary = relevantMessages
    .map((m) => {
      const roleName = m.role === "user" ? (locale === "ja-JP" ? "ユーザー" : "用户") : "八千代";
      let content = m.text.trim();
      if (!content && m.imageId) {
        content = locale === "ja-JP" ? "[画像]" : "[图片]";
      }
      return `${roleName}: ${content.slice(0, 150)}`;
    })
    .join("\n");

  const prompt =
    locale === "ja-JP"
      ? `以下の会話内容に基づいて、簡潔で的確な会話タイトルを1つだけ生成してください（4〜10文字程度、質問文をそのまま繰り返さず、話題の対象やテーマを要約してください。記号や説明は不要）：\n\n${conversationSummary}`
      : `请根据以下对话内容，提炼一个简短精炼的对话标题（4~10个字，概括讨论的核心事物或主题，不要直接照抄用户的提问原话，不要标点符号、书名号或任何多余说明）：\n\n${conversationSummary}`;

  return [
    {
      role: "user",
      text: prompt,
    },
  ];
}
