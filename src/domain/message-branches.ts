import type { ChatMessage, Conversation, MessageBranch } from "./chat";

function snapshot(conversation: Conversation, messages: ChatMessage[], rootId: string, version: number): MessageBranch {
  return { rootId, version, messages, summary: conversation.summary,
    compressedUpTo: conversation.compressedUpTo, compressedUpToId: conversation.compressedUpToId };
}

export function branchVersions(conversation: Conversation, message: ChatMessage): number[] {
  const rootId = message.branchRootId ?? message.id;
  return [...new Set([message.branchVersion ?? 1, ...(conversation.branches ?? [])
    .filter((branch) => branch.rootId === rootId).map((branch) => branch.version)])].sort((a, b) => a - b);
}

export function archiveBranch(conversation: Conversation, messages: ChatMessage[], target: ChatMessage): {
  conversation: Conversation; rootId: string; version: number;
} {
  const rootId = target.branchRootId ?? target.id;
  const branches = (conversation.branches ?? []).filter((branch) => branch.rootId !== rootId || branch.version !== (target.branchVersion ?? 1));
  branches.push(snapshot(conversation, messages, rootId, target.branchVersion ?? 1));
  const invalidatesSummary = conversation.compressedUpTo === undefined || target.createdAt <= conversation.compressedUpTo;
  return { rootId, version: Math.max(...branchVersions(conversation, target)) + 1,
    conversation: { ...conversation, branches, ...(invalidatesSummary ? {
      summary: undefined, compressedUpTo: undefined, compressedUpToId: undefined, lastCompressedAt: undefined,
    } : {}) } };
}

export function restoreBranch(conversation: Conversation, messages: ChatMessage[], target: ChatMessage, version: number): {
  conversation: Conversation; messages: ChatMessage[];
} {
  const rootId = target.branchRootId ?? target.id;
  const selected = conversation.branches?.find((branch) => branch.rootId === rootId && branch.version === version);
  if (!selected) throw new Error("消息版本不存在");
  const branches = (conversation.branches ?? []).filter((branch) => branch !== selected &&
    (branch.rootId !== rootId || branch.version !== (target.branchVersion ?? 1)));
  branches.push(snapshot(conversation, messages, rootId, target.branchVersion ?? 1));
  return { messages: selected.messages, conversation: { ...conversation, branches,
    summary: selected.summary, compressedUpTo: selected.compressedUpTo, compressedUpToId: selected.compressedUpToId } };
}
