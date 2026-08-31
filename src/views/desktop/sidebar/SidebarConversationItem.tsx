import { Check, MessageSquare, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../../../domain/chat";
import type { UiCopy } from "../../../i18n/messages";

interface SidebarConversationItemProps {
  active: boolean;
  conversation: Conversation;
  copy: UiCopy;
  isPinned?: boolean;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onTogglePin?: (id: string) => void;
}

export function SidebarConversationItem({
  active,
  conversation,
  copy,
  isPinned = false,
  onDelete,
  onRename,
  onSelect,
  onTogglePin,
}: SidebarConversationItemProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleStartRename = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setDraftTitle(conversation.title);
    setEditing(true);
  };

  const handleSaveRename = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false);
      return;
    }
    await onRename(conversation.id, trimmed);
    setEditing(false);
  };

  const handleCancelRename = () => {
    setEditing(false);
    setDraftTitle(conversation.title);
  };

  const handleDelete = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (window.confirm(copy.deleteConfirm)) {
      void onDelete(conversation.id);
    }
  };

  return (
    <div
      role="listitem"
      className={`desktop-sidebar__history-item ${
        active ? "desktop-sidebar__history-item--active" : ""
      } ${isPinned ? "desktop-sidebar__history-item--pinned" : ""}`}
    >
      {editing ? (
        <form onSubmit={(e) => void handleSaveRename(e)} className="desktop-sidebar__rename-form">
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                handleCancelRename();
              }
            }}
            className="desktop-sidebar__rename-input"
            aria-label={copy.rename}
          />
          <button type="submit" className="desktop-sidebar__history-action" title={copy.confirm}>
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={handleCancelRename}
            className="desktop-sidebar__history-action"
            title={copy.cancel}
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            className="desktop-sidebar__history-main"
            onClick={() => void onSelect(conversation.id)}
          >
            <MessageSquare size={14} className="desktop-sidebar__history-icon" />
            <span className="desktop-sidebar__history-title" title={conversation.title}>
              {conversation.title || copy.newChat}
            </span>
            {isPinned ? (
              <span className="desktop-sidebar__history-pin-badge" title="已置顶">
                <Pin size={11} />
              </span>
            ) : null}
          </button>
          <div className="desktop-sidebar__history-actions">
            {onTogglePin ? (
              <button
                type="button"
                className={`desktop-sidebar__history-action ${
                  isPinned ? "desktop-sidebar__history-action--pinned" : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(conversation.id);
                }}
                title={isPinned ? "取消置顶" : "置顶会话"}
                aria-label={isPinned ? "取消置顶" : "置顶会话"}
              >
                {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
            ) : null}
            <button
              type="button"
              className="desktop-sidebar__history-action"
              onClick={handleStartRename}
              title={copy.rename}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              className="desktop-sidebar__history-action desktop-sidebar__history-action--danger"
              onClick={handleDelete}
              title={copy.delete}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
