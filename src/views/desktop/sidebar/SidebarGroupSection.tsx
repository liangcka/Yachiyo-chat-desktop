import { ChevronDown, Pin } from "lucide-react";
import type { Conversation } from "../../../domain/chat";
import type { UiCopy } from "../../../i18n/messages";
import { SidebarConversationItem } from "./SidebarConversationItem";
import type { ConversationGroup } from "./types";

interface SidebarGroupSectionProps {
  activeConversationId?: string;
  copy: UiCopy;
  group: ConversationGroup;
  isCollapsed: boolean;
  onDeleteConversation: (id: string) => Promise<void>;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onToggleCollapse: () => void;
  onTogglePinConversation?: (id: string) => void;
  pinnedIds?: Set<string>;
}

export function SidebarGroupSection({
  activeConversationId,
  copy,
  group,
  isCollapsed,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  onToggleCollapse,
  onTogglePinConversation,
  pinnedIds,
}: SidebarGroupSectionProps) {
  const isPinnedGroup = group.key === "pinned";

  return (
    <div className={`desktop-sidebar__group ${isPinnedGroup ? "desktop-sidebar__group--pinned" : ""}`}>
      <button
        type="button"
        className="desktop-sidebar__group-header"
        onClick={onToggleCollapse}
        title={`${isCollapsed ? "展开" : "折叠"} ${group.label}`}
      >
        <span
          className={`desktop-sidebar__group-chevron ${
            isCollapsed ? "desktop-sidebar__group-chevron--collapsed" : ""
          }`}
        >
          <ChevronDown size={13} />
        </span>
        {isPinnedGroup ? <Pin size={12} className="desktop-sidebar__group-pin-icon" /> : null}
        <span className="desktop-sidebar__group-label">{group.label}</span>
      </button>

      {!isCollapsed ? (
        <div className="desktop-sidebar__group-items">
          {group.items.map((conv: Conversation) => (
            <SidebarConversationItem
              key={conv.id}
              active={conv.id === activeConversationId}
              conversation={conv}
              copy={copy}
              isPinned={pinnedIds?.has(conv.id) ?? isPinnedGroup}
              onDelete={onDeleteConversation}
              onRename={onRenameConversation}
              onSelect={onSelectConversation}
              onTogglePin={onTogglePinConversation}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
