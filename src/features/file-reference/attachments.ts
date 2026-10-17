export interface TextAttachment { name: string; content: string }
export const ATTACHMENT_CHARACTER_LIMIT = 16_000;
export const COMPOSER_CHARACTER_LIMIT = 20_000;

export async function readTextAttachment(file: File): Promise<TextAttachment> {
  if (file.size > ATTACHMENT_CHARACTER_LIMIT * 4) throw new Error("文件过大，请使用 @ 引用工作区文件");
  const content = await file.text();
  if ([...content].length > ATTACHMENT_CHARACTER_LIMIT) throw new Error("文件超过 16000 字，请拆分后添加或使用 @ 引用");
  if ([...content].some((character) => { const code = character.charCodeAt(0); return code < 9 || (code > 13 && code < 32) || code === 0xfffd; })) throw new Error("请添加文本或代码文件；图片请直接粘贴或拖入");
  return { name: file.name, content };
}

export function appendAttachments(text: string, attachments: TextAttachment[]): string {
  return [text, ...attachments.map((file) => `【附件 ${file.name}】\n\`\`\`\n${file.content}\n\`\`\``)].filter(Boolean).join("\n\n");
}
