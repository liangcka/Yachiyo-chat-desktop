import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { RunActivity } from "../../../app/use-chat-controller";
import type { Conversation } from "../../../domain/chat";
import { useLocale } from "../../../i18n/locale-context";
import type { UiCopy } from "../../../i18n/messages";
import { getProjectDisplayName } from "../../../services/project-manager";
import { SidebarConversationItem } from "./SidebarConversationItem";
import { groupConversationsByProject } from "./use-conversation-groups";

interface SidebarHistoryListProps {
  activeConversationId?: string;
  conversations: Conversation[];
  copy: UiCopy;
  runningConversations?: ReadonlyMap<string, RunActivity>;
  onArchiveConversation?: (id: string, archived: boolean) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onTogglePinConversation?: (id: string) => void;
  pinnedIds?: Set<string>;
}

export function SidebarHistoryList({
  activeConversationId,
  conversations,
  copy,
  runningConversations,
  onArchiveConversation,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  onTogglePinConversation,
  pinnedIds,
}: SidebarHistoryListProps) {
  const ja = useLocale() === "ja-JP";
  const [archiveOpen, setArchiveOpen] = useState(false);
  const current = conversations.filter((conversation) => conversation.archivedAt === undefined);
  const groups = groupConversationsByProject(current);
  const archived = conversations
    .filter((conversation) => conversation.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  const renderItem = (conversation: Conversation) => (
    <SidebarConversationItem
      key={conversation.id}
      active={conversation.id === activeConversationId}
      activity={runningConversations?.get(conversation.id)}
      conversation={conversation}
      copy={copy}
      isPinned={pinnedIds?.has(conversation.id) ?? false}
      onArchive={onArchiveConversation}
      onDelete={onDeleteConversation}
      onRename={onRenameConversation}
      onSelect={onSelectConversation}
      onTogglePin={onTogglePinConversation}
    />
  );

  return (
    <>
      <section className="desktop-sidebar__section desktop-sidebar__section--history" aria-label={ja ? "会話" : "对话"}>
        <div className="desktop-sidebar__section-header">
          <span className="desktop-sidebar__section-label">{ja ? "会話" : "对话"}</span>
        </div>
        <div className="desktop-sidebar__history-list" role="list">
          {current.length === 0 ? (
            <p className="desktop-sidebar__empty-text">{copy.noHistory}</p>
          ) : groups === undefined ? (
            current.map(renderItem)
          ) : (
            groups.map((group) => {
              const running = group.conversations.filter((conversation) => runningConversations?.has(conversation.id)).length;
              const name = group.workspace === null ? (ja ? "プロジェクトなし" : "未绑定项目") : getProjectDisplayName(group.workspace, ja ? "ja-JP" : "zh-CN");
              return (
                <div key={group.workspace ?? "\u0000unbound"} className="desktop-sidebar__project-group" role="group" aria-label={name}>
                  <div className="desktop-sidebar__project-group-header" title={group.workspace ?? undefined}>
                    <span className="desktop-sidebar__project-group-name">{name}</span>
                    {running > 0 ? (
                      <span className="desktop-sidebar__project-group-running">{ja ? `${running} 件実行中` : `${running} 个运行中`}</span>
                    ) : null}
                  </div>
                  {group.conversations.map(renderItem)}
                </div>
              );
            })
          )}
        </div>
      </section>

      {archived.length > 0 ? (
        <section
          className="desktop-sidebar__section desktop-sidebar__section--archive"
          aria-label={ja ? "アーカイブ" : "已归档"}
        >
          <button
            type="button"
            className="desktop-sidebar__archive-toggle"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen((open) => !open)}
          >
            <ChevronRight
              size={12}
              className={`desktop-sidebar__archive-chevron ${archiveOpen ? "desktop-sidebar__archive-chevron--open" : ""}`}
            />
            <span>{ja ? "アーカイブ" : "已归档"}</span>
            <span className="desktop-sidebar__archive-count">{archived.length}</span>
          </button>
          {archiveOpen ? (
            <div className="desktop-sidebar__history-list desktop-sidebar__history-list--archived" role="list">
              {archived.map(renderItem)}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
