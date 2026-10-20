import type { Conversation } from "../../../domain/chat";
import { useLocale } from "../../../i18n/locale-context";
import type { UiCopy } from "../../../i18n/messages";
import { SidebarConversationItem } from "./SidebarConversationItem";

interface SidebarHistoryListProps {
  activeConversationId?: string;
  conversations: Conversation[];
  copy: UiCopy;
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
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  onTogglePinConversation,
  pinnedIds,
}: SidebarHistoryListProps) {
  const ja = useLocale() === "ja-JP";
  return (
    <section className="desktop-sidebar__section desktop-sidebar__section--history" aria-label={ja ? "会話" : "对话"}>
      <div className="desktop-sidebar__section-header">
        <span className="desktop-sidebar__section-label">{ja ? "会話" : "对话"}</span>
      </div>
      <div className="desktop-sidebar__history-list" role="list">
        {conversations.length === 0 ? (
          <p className="desktop-sidebar__empty-text">{copy.noHistory}</p>
        ) : (
          conversations.map((conversation) => (
            <SidebarConversationItem
              key={conversation.id}
              active={conversation.id === activeConversationId}
              conversation={conversation}
              copy={copy}
              isPinned={pinnedIds?.has(conversation.id) ?? false}
              onDelete={onDeleteConversation}
              onRename={onRenameConversation}
              onSelect={onSelectConversation}
              onTogglePin={onTogglePinConversation}
            />
          ))
        )}
      </div>
    </section>
  );
}
