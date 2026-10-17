import { expect, it } from "vitest";
import { contextCharacters, shouldCompressContext } from "./context-budget";
import type { ChatMessage } from "./chat";

it("按未压缩内容触发容量压缩，已摘要消息不重复计费", () => {
  const messages: ChatMessage[] = [1, 2, 3, 4].map((createdAt) => ({ id: String(createdAt), conversationId: "c", role: "user", text: "文".repeat(5000), status: "complete", createdAt }));
  expect(shouldCompressContext(messages)).toBe(true);
  expect(shouldCompressContext(messages, 3)).toBe(false);
  expect(contextCharacters(messages, 3, "摘要")).toBe(5002);
});
