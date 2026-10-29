import type { Locale } from "../../domain/chat";

export interface TextAttachment { name: string; content: string }
/** 视频只以本地路径随消息发出：模型可用工具处理该文件，消息里的路径行渲染为播放器 */
export interface VideoAttachment { kind: "video"; name: string; path: string }
export type ComposerAttachment = TextAttachment | VideoAttachment;
export const ATTACHMENT_CHARACTER_LIMIT = 16_000;
export const COMPOSER_CHARACTER_LIMIT = 20_000;

export async function readTextAttachment(file: File, locale: Locale = "zh-CN"): Promise<TextAttachment> {
  const ja = locale === "ja-JP";
  if (file.size > ATTACHMENT_CHARACTER_LIMIT * 4) throw new Error(ja ? "ファイルが大きすぎます。@ でワークスペースのファイルを引用してください" : "文件过大，请使用 @ 引用工作区文件");
  const content = await file.text();
  if ([...content].length > ATTACHMENT_CHARACTER_LIMIT) throw new Error(ja ? "ファイルが 16000 文字を超えています。分割して追加するか @ で引用してください" : "文件超过 16000 字，请拆分后添加或使用 @ 引用");
  if ([...content].some((character) => { const code = character.charCodeAt(0); return code < 9 || (code > 13 && code < 32) || code === 0xfffd; })) throw new Error(ja ? "テキストまたはコードファイルを追加してください。画像は直接貼り付けるかドラッグしてください" : "请添加文本或代码文件；图片请直接粘贴或拖入");
  return { name: file.name, content };
}

const NEXT_ATTACHMENT = "(?=\\n\\n【(?:附件|视频) |$)";
const ATTACHMENT_BLOCK = new RegExp(
  `【附件 ([^】\\n]+)】\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\`${NEXT_ATTACHMENT}|【视频 ([^】\\n]+)】\\n([^\\n]+)${NEXT_ATTACHMENT}`,
  "uy",
);

function parseAttachmentTail(tail: string): ComposerAttachment[] | undefined {
  const attachments: ComposerAttachment[] = [];
  ATTACHMENT_BLOCK.lastIndex = 0;
  while (ATTACHMENT_BLOCK.lastIndex < tail.length) {
    const match = ATTACHMENT_BLOCK.exec(tail);
    if (match === null) return undefined;
    attachments.push(match[1] !== undefined
      ? { name: match[1], content: match[2] }
      : { kind: "video", name: match[3], path: match[4] });
    if (tail.startsWith("\n\n", ATTACHMENT_BLOCK.lastIndex)) ATTACHMENT_BLOCK.lastIndex += 2;
  }
  return attachments;
}

/**
 * appendAttachments 的逆过程：附件总是成串拼在消息末尾，取最早一处能把剩余部分完整解析为附件的位置切开，
 * 正文里偶然出现的同形文字不会被误拆
 */
export function splitMessageAttachments(text: string): { text: string; attachments: ComposerAttachment[] } {
  for (const match of text.matchAll(/(?:^|\n\n)【(?:附件|视频) /gu)) {
    const start = match.index + (match[0].startsWith("\n") ? 2 : 0);
    const attachments = parseAttachmentTail(text.slice(start));
    if (attachments !== undefined) return { text: text.slice(0, start).trimEnd(), attachments };
  }
  return { text, attachments: [] };
}

export function appendAttachments(text: string, attachments: ComposerAttachment[]): string {
  return [text, ...attachments.map((file) => "kind" in file
    ? `【视频 ${file.name}】\n${file.path}`
    : `【附件 ${file.name}】\n\`\`\`\n${file.content}\n\`\`\``)].filter(Boolean).join("\n\n");
}
