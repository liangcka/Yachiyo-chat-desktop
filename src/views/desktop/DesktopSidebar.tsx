import {
  Archive,
  Brain,
  Check,
  Cpu,
  FolderCode,
  Globe,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Conversation, Locale } from "../../domain/chat";
import type { UiCopy } from "../../i18n/messages";

export type DesktopRightTab = "workspace" | "llm" | "skills" | "memory" | "none";

export interface DesktopSidebarProps {
  activeConversationId?: string;
  activeRightTab: DesktopRightTab;
  collapsed?: boolean;
  conversations: Conversation[];
  copy: UiCopy;
  locale: Locale;
  onClearData: () => Promise<void>;
  onCompress: () => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onLocale: (locale: Locale) => Promise<void>;
  onNewChat: () => Promise<void>;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onSelectRightTab: (tab: DesktopRightTab) => void;
  onSignOut: () => Promise<void>;
  onToggleCollapse?: () => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
}

/** 展开态操作行（图标 + 文字） */
interface SidebarRowProps {
  icon: ReactNode;
  label: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}

function SidebarRow({ icon, label, title, active = false, danger = false, onClick }: SidebarRowProps) {
  const classes = [
    "desktop-sidebar__row",
    active ? "desktop-sidebar__row--active" : "",
    danger ? "desktop-sidebar__row--danger" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} title={title} onClick={onClick}>
      <span className="desktop-sidebar__row-icon">{icon}</span>
      <span className="desktop-sidebar__row-label">{label}</span>
    </button>
  );
}

/** 56px rail 折叠态图标按钮 */
interface RailButtonProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  highlight?: boolean;
  onClick: () => void;
}

function RailButton({ icon, label, active = false, danger = false, highlight = false, onClick }: RailButtonProps) {
  const classes = [
    "desktop-sidebar__rail-btn",
    active ? "desktop-sidebar__rail-btn--active" : "",
    danger ? "desktop-sidebar__rail-btn--danger" : "",
    highlight ? "desktop-sidebar__rail-btn--highlight" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

const SCROLLBAR_LINGER_MS = 2000;

export function DesktopSidebar({
  activeConversationId,
  activeRightTab,
  collapsed = false,
  conversations,
  copy,
  locale,
  onClearData,
  onCompress,
  onDeleteConversation,
  onLocale,
  onNewChat,
  onRenameConversation,
  onSelectConversation,
  onSelectRightTab,
  onSignOut,
  onToggleCollapse,
  onToggleTheme,
  resolvedTheme = "dark",
}: DesktopSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 滚动条停留逻辑：鼠标离开侧边栏 2 秒后再隐去滚动条，与 deepseek-harness 一致
  const [pointerInside, setPointerInside] = useState(false);
  const lingerTimer = useRef<number | undefined>(undefined);

  const armLinger = () => {
    if (lingerTimer.current !== undefined) return;
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined;
      setPointerInside(false);
    }, SCROLLBAR_LINGER_MS);
  };

  const cancelLinger = () => {
    if (lingerTimer.current !== undefined) {
      window.clearTimeout(lingerTimer.current);
      lingerTimer.current = undefined;
    }
  };

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
    }
  }, [editingId]);

  const startRename = (conv: Conversation, e: ReactMouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleSaveRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId || !editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    await onRenameConversation(editingId, editingTitle.trim());
    setEditingId(null);
  };

  const handleCancelRename = () => {
    setEditingId(null);
  };

  const toggleRightTab = (tab: DesktopRightTab) => {
    onSelectRightTab(activeRightTab === tab ? "none" : tab);
  };

  const localeSwapTitle = locale === "zh-CN" ? "切换为日本語" : "切换为中文";

  /* ── 56px rail 折叠态（严格对齐 deepseek-harness 侧栏收起形态） ── */
  if (collapsed) {
    return (
      <aside className="desktop-sidebar desktop-sidebar--rail" aria-label="紧凑导航栏">
        {/* 顶部：展开侧边栏图标 */}
        <div className="desktop-sidebar__rail-top">
          <button
            type="button"
            className="desktop-sidebar__rail-toggle"
            title="展开侧边栏 (Ctrl+[)"
            aria-label="展开侧边栏"
            onClick={onToggleCollapse}
          >
            <PanelLeftOpen size={18} />
          </button>

          {/* 新建对话 (36x36 按钮) */}
          <RailButton
            icon={<Plus size={18} />}
            label="新建会话 (Ctrl+N)"
            highlight
            onClick={() => void onNewChat()}
          />
        </div>

        {/* 中部：工作区与功能入口 */}
        <div className="desktop-sidebar__rail-tools">
          <RailButton
            icon={<FolderCode size={17} />}
            label={copy.workspaceEntry}
            active={activeRightTab === "workspace"}
            onClick={() => toggleRightTab("workspace")}
          />
          <RailButton
            icon={<Cpu size={17} />}
            label={copy.llmSettingsEntry}
            active={activeRightTab === "llm"}
            onClick={() => toggleRightTab("llm")}
          />
          <RailButton
            icon={<Sparkles size={17} />}
            label={copy.skillsEntry}
            active={activeRightTab === "skills"}
            onClick={() => toggleRightTab("skills")}
          />
          <RailButton
            icon={<Brain size={17} />}
            label={copy.userMemoryEntry}
            active={activeRightTab === "memory"}
            onClick={() => toggleRightTab("memory")}
          />
        </div>

        {/* 底部：主题、语言、压缩与登出 */}
        <div className="desktop-sidebar__rail-bottom">
          {onToggleTheme ? (
            <RailButton
              icon={resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              label={resolvedTheme === "dark" ? copy.themeLight : copy.themeDark}
              onClick={onToggleTheme}
            />
          ) : null}
          <RailButton
            icon={<Archive size={16} />}
            label={copy.compressContext}
            onClick={onCompress}
          />
          <RailButton
            icon={<Globe size={16} />}
            label={localeSwapTitle}
            onClick={() => void onLocale(locale === "zh-CN" ? "ja-JP" : "zh-CN")}
          />
          <RailButton
            icon={<LogOut size={16} />}
            label={copy.signOut}
            danger
            onClick={() => void onSignOut()}
          />
        </div>
      </aside>
    );
  }

  /* ── 展开态：Wordmark 品牌 → 38px New Session → 会话列表 → 底部设置 ── */
  return (
    <aside
      className={`desktop-sidebar ${!pointerInside ? "desktop-sidebar--quiet-bars" : ""}`}
      aria-label="桌面导航与历史会话"
      onPointerEnter={() => {
        cancelLinger();
        setPointerInside(true);
      }}
      onPointerLeave={() => {
        armLinger();
      }}
    >
      {/* 品牌行（Wordmark + 折叠按钮） */}
      <div className="desktop-sidebar__brand-row">
        <button
          type="button"
          className="desktop-sidebar__brand-btn"
          onClick={() => void onNewChat()}
          title="月见八千代 (Tsukimi Yachiyo)"
        >
          <span className="desktop-sidebar__brand-title">月见八千代</span>
        </button>
        {onToggleCollapse ? (
          <button
            type="button"
            className="desktop-sidebar__ghost-btn"
            onClick={onToggleCollapse}
            title="折叠侧边栏 (Ctrl+[)"
            aria-label="折叠侧边栏"
          >
            <PanelLeftClose size={16} />
          </button>
        ) : null}
      </div>

      {/* 新建会话按钮（38px 高度，12px 圆角，deepseek-harness 经典样式） */}
      <button
        type="button"
        className="desktop-sidebar__new-btn"
        onClick={() => void onNewChat()}
        title="新建会话 (Ctrl+N)"
      >
        <Plus size={16} />
        <span className="desktop-sidebar__new-btn-label">{copy.newChat}</span>
        <kbd className="desktop-sidebar__kbd">^N</kbd>
      </button>

      {/* 会话历史列表 */}
      <div className="desktop-sidebar__history">
        <div className="desktop-sidebar__history-head">
          <span className="desktop-sidebar__history-title">{copy.history}</span>
          <span className="desktop-sidebar__history-count">{conversations.length}</span>
        </div>

        <div className="desktop-sidebar__history-list" role="list">
          {conversations.length === 0 ? (
            <p className="desktop-sidebar__history-empty">{copy.noHistory}</p>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              const isEditing = editingId === conv.id;
              return (
                <div
                  key={conv.id}
                  role="listitem"
                  className={`desktop-sidebar__history-item ${
                    isActive ? "desktop-sidebar__history-item--active" : ""
                  }`}
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => void handleSaveRename(e)}
                      className="desktop-sidebar__rename-form"
                    >
                      <input
                        ref={inputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => setEditingId(null)}
                        className="desktop-sidebar__rename-input"
                      />
                      <button
                        type="submit"
                        className="desktop-sidebar__history-action"
                        title={copy.confirm}
                      >
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
                        onClick={() => void onSelectConversation(conv.id)}
                      >
                        <MessageSquare size={14} className="desktop-sidebar__history-icon" />
                        <span className="desktop-sidebar__history-title" title={conv.title}>
                          {conv.title || copy.newChat}
                        </span>
                      </button>
                      <div className="desktop-sidebar__history-actions">
                        <button
                          type="button"
                          className="desktop-sidebar__history-action"
                          onClick={(e) => startRename(conv, e)}
                          title={copy.rename}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="desktop-sidebar__history-action desktop-sidebar__history-action--danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(copy.deleteConfirm)) {
                              void onDeleteConversation(conv.id);
                            }
                          }}
                          title={copy.delete}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部操作区域 */}
      <div className="desktop-sidebar__foot">
        <div className="desktop-sidebar__foot-group">
          <SidebarRow
            icon={<FolderCode size={16} />}
            label={copy.workspaceEntry}
            title={copy.workspaceEntry}
            active={activeRightTab === "workspace"}
            onClick={() => toggleRightTab("workspace")}
          />
          <SidebarRow
            icon={<Cpu size={16} />}
            label={copy.llmSettingsEntry}
            title={copy.llmSettingsEntry}
            active={activeRightTab === "llm"}
            onClick={() => toggleRightTab("llm")}
          />
          <SidebarRow
            icon={<Sparkles size={16} />}
            label={copy.skillsEntry}
            title={copy.skillsEntry}
            active={activeRightTab === "skills"}
            onClick={() => toggleRightTab("skills")}
          />
          <SidebarRow
            icon={<Brain size={16} />}
            label={copy.userMemoryEntry}
            title={copy.userMemoryEntry}
            active={activeRightTab === "memory"}
            onClick={() => toggleRightTab("memory")}
          />
        </div>

        <div className="desktop-sidebar__foot-sep" />

        <div className="desktop-sidebar__foot-group">
          {onToggleTheme ? (
            <SidebarRow
              icon={resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              label={
                locale === "ja-JP"
                  ? (resolvedTheme === "dark" ? "ライトモードに切替" : "ダークモードに切替")
                  : (resolvedTheme === "dark" ? "切换为浅色主题" : "切换为深色主题")
              }
              title={copy.themeLabel}
              onClick={onToggleTheme}
            />
          ) : null}
          <SidebarRow
            icon={<Globe size={16} />}
            label={locale === "zh-CN" ? "日本語" : "中文"}
            title={localeSwapTitle}
            onClick={() => void onLocale(locale === "zh-CN" ? "ja-JP" : "zh-CN")}
          />
          <SidebarRow
            icon={<Archive size={16} />}
            label={copy.compressContext}
            title={copy.compressContext}
            onClick={onCompress}
          />
          {showClearConfirm ? (
            <div className="desktop-sidebar__confirm">
              <span>清空本地数据？</span>
              <button
                type="button"
                className="desktop-sidebar__confirm-btn desktop-sidebar__confirm-btn--danger"
                onClick={() => {
                  setShowClearConfirm(false);
                  void onClearData();
                }}
              >
                {copy.confirm}
              </button>
              <button
                type="button"
                className="desktop-sidebar__confirm-btn"
                onClick={() => setShowClearConfirm(false)}
              >
                {copy.cancel}
              </button>
            </div>
          ) : (
            <SidebarRow
              icon={<Trash2 size={15} />}
              label={copy.clearData}
              title={copy.clearData}
              onClick={() => setShowClearConfirm(true)}
            />
          )}
          <SidebarRow
            icon={<LogOut size={15} />}
            label={copy.signOut}
            title={copy.signOut}
            danger
            onClick={() => void onSignOut()}
          />
        </div>
      </div>
    </aside>
  );
}
