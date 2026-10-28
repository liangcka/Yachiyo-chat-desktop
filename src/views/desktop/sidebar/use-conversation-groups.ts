import { useCallback, useMemo, useState } from "react";
import type { Conversation, Locale } from "../../../domain/chat";

const STORAGE_PINNED_CONVERSATIONS = "yachiyo-sidebar-pinned-conversations";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function readStoredPinnedConversations(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PINNED_CONVERSATIONS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === "string"));
      }
    }
  } catch {
    /* 降级 */
  }
  return new Set();
}

function writeStoredPinnedConversations(pinned: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_PINNED_CONVERSATIONS, JSON.stringify(Array.from(pinned)));
  } catch {
    /* 忽略写入异常 */
  }
}

/** 侧栏条目右侧的紧凑相对时间：分钟、小时、天，超过 30 天显示月/日。 */
export function formatRelativeTime(timestamp: number, locale: Locale = "zh-CN", now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const ja = locale === "ja-JP";
  if (elapsed < MINUTE) return ja ? "今" : "刚刚";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}${ja ? "日" : "天"}`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 置顶会话排在最前，其余保持传入顺序（最近更新在前）。 */
export function orderConversations(conversations: Conversation[], pinnedIds: Set<string>): Conversation[] {
  const pinned = conversations.filter((conversation) => pinnedIds.has(conversation.id));
  const rest = conversations.filter((conversation) => !pinnedIds.has(conversation.id));
  return [...pinned, ...rest];
}

export function useConversationGroups(conversations: Conversation[]) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readStoredPinnedConversations());

  const togglePinConversation = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      writeStoredPinnedConversations(next);
      return next;
    });
  }, []);

  const orderedConversations = useMemo(
    () => orderConversations(conversations, pinnedIds),
    [conversations, pinnedIds],
  );

  return { orderedConversations, pinnedIds, togglePinConversation };
}

export interface ConversationGroup {
  /** 项目路径；null 为未绑定项目的对话 */
  workspace: string | null;
  conversations: Conversation[];
}

/**
 * 按任务所属项目分组：组的顺序取组内最靠前的会话（置顶与最近更新在前），未绑定项目的对话放在最后。
 * 没有任何会话绑定项目时返回 undefined，侧栏保持平铺。
 */
export function groupConversationsByProject(conversations: Conversation[]): ConversationGroup[] | undefined {
  if (!conversations.some((conversation) => typeof conversation.workspace === "string")) return undefined;
  const groups = new Map<string, ConversationGroup>();
  const unbound: Conversation[] = [];
  for (const conversation of conversations) {
    if (typeof conversation.workspace !== "string") {
      unbound.push(conversation);
      continue;
    }
    const group = groups.get(conversation.workspace) ?? { workspace: conversation.workspace, conversations: [] };
    group.conversations.push(conversation);
    groups.set(conversation.workspace, group);
  }
  return [...groups.values(), ...(unbound.length > 0 ? [{ workspace: null, conversations: unbound }] : [])];
}
