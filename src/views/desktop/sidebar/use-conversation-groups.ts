import { useCallback, useMemo, useState } from "react";
import type { Conversation, Locale } from "../../../domain/chat";
import type { ConversationGroup, TimeGroupKey } from "./types";

const STORAGE_COLLAPSED_GROUPS = "yachiyo-sidebar-collapsed-groups";
const STORAGE_PINNED_CONVERSATIONS = "yachiyo-sidebar-pinned-conversations";

const LABELS: Record<Locale, Record<TimeGroupKey, string>> = {
  "zh-CN": {
    pinned: "置顶会话",
    today: "今天",
    yesterday: "昨天",
    previous7Days: "前 7 天",
    older: "更早",
  },
  "ja-JP": {
    pinned: "ピン留め",
    today: "今日",
    yesterday: "昨日",
    previous7Days: "過去7日間",
    older: "それ以前",
  },
};

const GROUP_KEYS: TimeGroupKey[] = ["pinned", "today", "yesterday", "previous7Days", "older"];

function readStoredCollapsedGroups(): Set<TimeGroupKey> {
  try {
    const raw = localStorage.getItem(STORAGE_COLLAPSED_GROUPS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((k): k is TimeGroupKey => GROUP_KEYS.includes(k)));
      }
    }
  } catch {
    /* localStorage 不可用时静默降级 */
  }
  return new Set();
}

function writeStoredCollapsedGroups(groups: Set<TimeGroupKey>): void {
  try {
    localStorage.setItem(STORAGE_COLLAPSED_GROUPS, JSON.stringify(Array.from(groups)));
  } catch {
    /* 忽略写入异常 */
  }
}

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

export function groupConversationsByDate(
  conversations: Conversation[],
  locale: Locale = "zh-CN",
  pinnedIds?: Set<string>,
): ConversationGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - 6 * 86400000;

  const groups: Record<TimeGroupKey, Conversation[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };

  for (const conv of conversations) {
    if (pinnedIds?.has(conv.id)) {
      groups.pinned.push(conv);
      continue;
    }

    const timestamp = conv.updatedAt || conv.createdAt || 0;
    if (timestamp >= todayStart) {
      groups.today.push(conv);
    } else if (timestamp >= yesterdayStart) {
      groups.yesterday.push(conv);
    } else if (timestamp >= sevenDaysAgoStart) {
      groups.previous7Days.push(conv);
    } else {
      groups.older.push(conv);
    }
  }

  return GROUP_KEYS.map((key) => ({
    key,
    label: LABELS[locale]?.[key] ?? LABELS["zh-CN"][key],
    items: groups[key],
  })).filter((g) => g.items.length > 0);
}

export function useConversationGroups(
  conversations: Conversation[],
  locale: Locale,
  searchQuery = "",
) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TimeGroupKey>>(() =>
    readStoredCollapsedGroups(),
  );

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    readStoredPinnedConversations(),
  );

  const toggleGroupCollapse = useCallback((key: TimeGroupKey) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeStoredCollapsedGroups(next);
      return next;
    });
  }, []);

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

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((c) => (c.title || "").toLowerCase().includes(query));
  }, [conversations, searchQuery]);

  const groupedConversations = useMemo(
    () => groupConversationsByDate(filteredConversations, locale, pinnedIds),
    [filteredConversations, locale, pinnedIds],
  );

  const totalMatches = filteredConversations.length;
  const isSearching = searchQuery.trim().length > 0;

  return {
    collapsedGroups,
    groupedConversations,
    isSearching,
    pinnedIds,
    toggleGroupCollapse,
    togglePinConversation,
    totalMatches,
  };
}
