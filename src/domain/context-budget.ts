import type { ChatMessage } from "./chat";

/** 请求层的文本容量上限；压缩与用量提示采用同一边界。 */
export const REQUEST_CHARACTER_BUDGET = 24_000;

export function contextCharacters(messages: readonly ChatMessage[], compressedUpTo?: number, summary = ""): number {
  return summary.length + messages.filter((message) => compressedUpTo === undefined || message.createdAt > compressedUpTo)
    .reduce((total, message) => total + message.text.length + (message.imageId ? 2200 : 0), 0);
}

export function shouldCompressContext(messages: readonly ChatMessage[], compressedUpTo?: number, summary = ""): boolean {
  return contextCharacters(messages, compressedUpTo, summary) >= REQUEST_CHARACTER_BUDGET * 0.75;
}
