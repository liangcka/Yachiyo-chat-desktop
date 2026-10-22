import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RunActivity } from "../../../app/use-chat-controller";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import type { Conversation } from "../../../domain/chat";
import { useLocale } from "../../../i18n/locale-context";
import type { UiCopy } from "../../../i18n/messages";
import { formatRelativeTime } from "./use-conversation-groups";

interface SidebarConversationItemProps {
  active: boolean;
  conversation: Conversation;
  copy: UiCopy;
  isPinned?: boolean;
  /** 该会话正在运行（含后台运行）时的状态 */
  activity?: RunActivity;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onTogglePin?: (id: string) => void;
  onArchive?: (id: string, archived: boolean) => Promise<void>;
}

const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 156;

export function SidebarConversationItem({
  active,
  conversation,
  copy,
  isPinned = false,
  activity,
  onDelete,
  onRename,
  onSelect,
  onTogglePin,
  onArchive,
}: SidebarConversationItemProps) {
  const locale = useLocale();
  const ja = locale === "ja-JP";
  const archived = conversation.archivedAt !== undefined;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameSettledRef = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuPosition !== undefined;

  const closeMenu = useCallback(() => setMenuPosition(undefined), []);
  const cancelDelete = useCallback(() => setConfirmingDelete(false), []);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // 菜单挂在 body 上以免被侧栏滚动容器裁切；滚动或缩放时位置失效，直接收起
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (menuRef.current?.contains(target) || moreRef.current?.contains(target))) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [closeMenu, menuOpen]);

  const toggleMenu = (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (menuOpen) {
      closeMenu();
      return;
    }
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const openUpward = window.innerHeight - rect.bottom < MENU_ESTIMATED_HEIGHT + 8;
    setMenuPosition({
      left: Math.max(8, rect.right - MENU_WIDTH),
      ...(openUpward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      width: MENU_WIDTH,
    });
  };

  // 右键在光标处打开同一份操作菜单，代替 WebView 自带的刷新/检查菜单
  const openContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const left = Math.min(Math.max(8, event.clientX), window.innerWidth - MENU_WIDTH - 8);
    const openUpward = window.innerHeight - event.clientY < MENU_ESTIMATED_HEIGHT + 8;
    setMenuPosition({
      left,
      ...(openUpward ? { bottom: window.innerHeight - event.clientY } : { top: event.clientY }),
      width: MENU_WIDTH,
    });
  };

  const runMenuAction = (action: () => void) => {
    closeMenu();
    action();
  };

  const handleSaveRename = async (e?: FormEvent | React.SyntheticEvent) => {
    if (e) e.preventDefault();
    // Enter 提交后输入框卸载、Esc 取消后都可能再触发一次 blur，只认第一次收尾
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    const currentVal = inputRef.current ? inputRef.current.value : draftTitle;
    const trimmed = currentVal.trim();
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false);
      return;
    }
    // 已无确认按钮可重试，保存失败也直接退出编辑态，标题回落为原值
    try {
      await onRename(conversation.id, trimmed);
    } finally {
      setEditing(false);
    }
  };

  const handleCancelRename = () => {
    renameSettledRef.current = true;
    setEditing(false);
    setDraftTitle(conversation.title);
  };

  const activityLabel =
    activity === "approval"
      ? ja ? "承認待ち" : "等待确认"
      : ja ? "実行中" : "运行中";

  return (
    <div
      role="listitem"
      className={`desktop-sidebar__history-item ${
        active ? "desktop-sidebar__history-item--active" : ""
      } ${isPinned ? "desktop-sidebar__history-item--pinned" : ""} ${
        menuOpen ? "desktop-sidebar__history-item--menu-open" : ""
      }`}
      onContextMenu={editing ? undefined : openContextMenu}
    >
      {editing ? (
        <form onSubmit={(e) => void handleSaveRename(e)} className="desktop-sidebar__rename-form">
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => void handleSaveRename()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Escape") {
                handleCancelRename();
              } else if (e.key === "Enter") {
                e.preventDefault();
                void handleSaveRename(e);
              }
            }}
            className="desktop-sidebar__rename-input"
            aria-label={copy.rename}
          />
        </form>
      ) : (
        <>
          <button
            type="button"
            className="desktop-sidebar__history-main"
            onClick={() => void onSelect(conversation.id)}
          >
            <span className="desktop-sidebar__history-title" title={conversation.title}>
              {conversation.title || copy.newChat}
            </span>
            {isPinned ? (
              <span className="desktop-sidebar__history-pin-badge" title={ja ? "ピン留め済み" : "已置顶"}>
                <Pin size={11} />
              </span>
            ) : null}
            {activity !== undefined ? (
              <span
                className={`desktop-sidebar__history-activity desktop-sidebar__history-activity--${activity}`}
                role="status"
                aria-label={activityLabel}
                title={activityLabel}
              />
            ) : null}
            <span className="desktop-sidebar__history-time">
              {formatRelativeTime(conversation.updatedAt || conversation.createdAt, locale)}
            </span>
          </button>
          <div className="desktop-sidebar__history-actions">
            <button
              ref={moreRef}
              type="button"
              className="desktop-sidebar__history-action"
              onClick={toggleMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={ja ? "会話の操作" : "对话操作"}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </>
      )}

      {menuOpen
        ? createPortal(
            <div
              ref={menuRef}
              className="desktop-sidebar__item-menu"
              role="menu"
              aria-label={ja ? "会話の操作" : "对话操作"}
              style={menuPosition}
            >
              {onTogglePin && !archived ? (
                <button
                  type="button"
                  role="menuitem"
                  className="desktop-sidebar__item-menu-option"
                  onClick={() => runMenuAction(() => onTogglePin(conversation.id))}
                >
                  {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                  <span>{isPinned ? (ja ? "ピン留めを外す" : "取消置顶") : ja ? "ピン留め" : "置顶会话"}</span>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="desktop-sidebar__item-menu-option"
                onClick={() =>
                  runMenuAction(() => {
                    renameSettledRef.current = false;
                    setDraftTitle(conversation.title);
                    setEditing(true);
                  })
                }
              >
                <Pencil size={14} />
                <span>{copy.rename}</span>
              </button>
              {onArchive ? (
                <button
                  type="button"
                  role="menuitem"
                  className="desktop-sidebar__item-menu-option"
                  onClick={() => runMenuAction(() => void onArchive(conversation.id, !archived))}
                >
                  {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  <span>{archived ? (ja ? "アーカイブから戻す" : "取消归档") : ja ? "アーカイブ" : "归档"}</span>
                </button>
              ) : null}
              <div className="desktop-sidebar__item-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="desktop-sidebar__item-menu-option desktop-sidebar__item-menu-option--danger"
                onClick={() => runMenuAction(() => setConfirmingDelete(true))}
              >
                <Trash2 size={14} />
                <span>{copy.delete}</span>
              </button>
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={confirmingDelete}
        title={copy.deleteConfirm}
        message={
          activity !== undefined
            ? ja
              ? `「${conversation.title}」は実行中です。削除すると実行も停止します。この操作は元に戻せません。`
              : `「${conversation.title}」正在运行，删除会同时停止运行，且无法恢复。`
            : ja
              ? `「${conversation.title}」とそのメッセージは完全に削除され、元に戻せません。`
              : `「${conversation.title}」及其全部消息将被永久删除，无法恢复。`
        }
        confirmLabel={copy.delete}
        cancelLabel={copy.cancel}
        danger
        onCancel={cancelDelete}
        onConfirm={() => {
          setConfirmingDelete(false);
          void onDelete(conversation.id);
        }}
      />
    </div>
  );
}
