import { useLocale } from "../../../i18n/locale-context";
import type { UiCopy } from "../../../i18n/messages";
import { SidebarGroupSection } from "./SidebarGroupSection";
import type { ConversationGroup, TimeGroupKey } from "./types";

interface SidebarHistoryListProps {
  activeConversationId?: string;
  collapsedGroups: Set<TimeGroupKey>;
  copy: UiCopy;
  groups: ConversationGroup[];
  isSearching: boolean;
  onDeleteConversation: (id: string) => Promise<void>;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onToggleGroupCollapse: (key: TimeGroupKey) => void;
  onTogglePinConversation?: (id: string) => void;
  pinnedIds?: Set<string>;
  totalCount: number;
  totalMatches: number;
}

export function SidebarHistoryList({
  activeConversationId,
  collapsedGroups,
  copy,
  groups,
  isSearching,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  onToggleGroupCollapse,
  onTogglePinConversation,
  pinnedIds,
  totalCount,
  totalMatches,
}: SidebarHistoryListProps) {
  const ja = useLocale() === "ja-JP";
  return (
    <div className="desktop-sidebar__history">
      {isSearching ? (
        <div className="desktop-sidebar__search-status">
          <span className="desktop-sidebar__search-status-label">{ja ? "検索結果" : "搜索结果"}</span>
          <span className="desktop-sidebar__search-status-count">{`${totalMatches} / ${totalCount}`}</span>
        </div>
      ) : null}

      <div className="desktop-sidebar__history-list" role="list">
        {totalCount === 0 ? (
          <div className="desktop-sidebar__history-empty">
            <p className="desktop-sidebar__empty-text">{copy.noHistory}</p>
          </div>
        ) : totalMatches === 0 && isSearching ? (
          <div className="desktop-sidebar__history-empty">
            <p className="desktop-sidebar__empty-text">{ja ? "一致する会話はありません" : "未找到匹配的会话"}</p>
          </div>
        ) : (
          groups.map((group) => (
            <SidebarGroupSection
              key={group.key}
              activeConversationId={activeConversationId}
              copy={copy}
              group={group}
              isCollapsed={collapsedGroups.has(group.key)}
              onDeleteConversation={onDeleteConversation}
              onRenameConversation={onRenameConversation}
              onSelectConversation={onSelectConversation}
              onToggleCollapse={() => onToggleGroupCollapse(group.key)}
              onTogglePinConversation={onTogglePinConversation}
              pinnedIds={pinnedIds}
            />
          ))
        )}
      </div>
    </div>
  );
}
