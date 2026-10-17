import { describe, expect, it } from "vitest";
import { archiveBranch, branchVersions, restoreBranch } from "./message-branches";
import type { ChatMessage, Conversation } from "./chat";

const conversation: Conversation = { id: "c", title: "对话", locale: "zh-CN", createdAt: 1, updatedAt: 1, summary: "旧摘要", compressedUpTo: 2 };
const messages: ChatMessage[] = [
  { id: "u", conversationId: "c", role: "user", text: "原问题", status: "complete", createdAt: 1 },
  { id: "a", conversationId: "c", role: "assistant", text: "原回答", status: "complete", createdAt: 2 },
];

describe("消息分支", () => {
  it("保留完整旧版本和摘要，恢复后仍可切回新版本", () => {
    const fork = archiveBranch(conversation, messages, messages[0]!);
    const edited: ChatMessage = { ...messages[0]!, id: "u2", text: "新问题", branchRootId: fork.rootId, branchVersion: fork.version };
    expect(fork.conversation.summary).toBeUndefined();
    expect(branchVersions(fork.conversation, edited)).toEqual([1, 2]);
    const restored = restoreBranch(fork.conversation, [edited], edited, 1);
    expect(restored.messages).toEqual(messages);
    expect(restored.conversation.summary).toBe("旧摘要");
    const next = restoreBranch(restored.conversation, restored.messages, messages[0]!, 2);
    expect(next.messages[0]?.text).toBe("新问题");
  });
  it("不同分支组互不覆盖，无效版本拒绝恢复", () => {
    const fork = archiveBranch(conversation, messages, messages[1]!);
    expect(branchVersions(fork.conversation, messages[0]!)).toEqual([1]);
    expect(() => restoreBranch(fork.conversation, messages, messages[0]!, 9)).toThrow();
  });
  it("修改压缩边界之后的消息保留仍然有效的摘要", () => {
    const recent: ChatMessage = { ...messages[0]!, id: "recent", createdAt: 3 };
    const fork = archiveBranch(conversation, [...messages, recent], recent);
    expect(fork.conversation.summary).toBe("旧摘要");
    expect(fork.conversation.compressedUpTo).toBe(2);
  });
});
