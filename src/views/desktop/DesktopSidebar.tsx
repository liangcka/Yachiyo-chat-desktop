import {
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderCode,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, Locale } from "../../domain/chat";
import { PROVIDER_METADATA, type ProviderId } from "../../domain/llm";
import type { UiCopy } from "../../i18n/messages";
import type { SettingsTabKey } from "../../components/settings/SettingsModal";

export type DesktopRightTab = "workspace" | "llm" | "skills" | "memory" | "settings" | "none";

export interface DesktopSidebarProps {
  activeConversationId?: string;
  activeRightTab: DesktopRightTab;
  collapsed?: boolean;
  conversations: Conversation[];
  copy: UiCopy;
  llmActiveProvider?: ProviderId;
  llmEntries?: readonly { provider: ProviderId; apiKey: string; model: string }[];
  locale: Locale;
  onClearData?: () => Promise<void>;
  onCompress?: () => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onLocale?: (locale: Locale) => Promise<void>;
  onNewChat: () => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onSelectRightTab: (tab: DesktopRightTab) => void;
  onSignOut?: () => Promise<void>;
  onToggleCollapse?: () => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
}

type TimeGroupKey = "today" | "yesterday" | "previous7Days" | "older";

interface ConversationGroup {
  key: TimeGroupKey;
  label: string;
  items: Conversation[];
}

function groupConversationsByDate(
  conversations: Conversation[],
  locale: Locale = "zh-CN",
): ConversationGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - 6 * 86400000;

  const groups: Record<TimeGroupKey, Conversation[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };

  for (const conv of conversations) {
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

  const labels: Record<Locale, Record<TimeGroupKey, string>> = {
    "zh-CN": {
      today: "今天",
      yesterday: "昨天",
      previous7Days: "前 7 天",
      older: "更早",
    },
    "ja-JP": {
      today: "今日",
      yesterday: "昨日",
      previous7Days: "過去7日間",
      older: "それ以前",
    },
  };

  const groupKeys: TimeGroupKey[] = ["today", "yesterday", "previous7Days", "older"];
  return groupKeys
    .map((key) => ({
      key,
      label: labels[locale]?.[key] ?? labels["zh-CN"][key],
      items: groups[key],
    }))
    .filter((g) => g.items.length > 0);
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
  llmActiveProvider,
  llmEntries = [],
  locale,
  onDeleteConversation,
  onNewChat,
  onOpenSettings,
  onRenameConversation,
  onSelectConversation,
  onSelectRightTab,
  onToggleCollapse,
}: DesktopSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 手风琴折叠状态：记录被用户折叠的分组 key
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TimeGroupKey>>(new Set());

  // 滚动条停留逻辑：鼠标离开侧边栏 2 秒后再隐去滚动条
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

  const toggleGroupCollapse = (key: TimeGroupKey) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleRightTab = (tab: DesktopRightTab) => {
    onSelectRightTab(activeRightTab === tab ? "none" : tab);
  };

  const handleOpenGeneralSettings = () => {
    if (onOpenSettings) {
      onOpenSettings("general");
    } else {
      toggleRightTab("settings");
    }
  };

  const handleOpenModelSettings = () => {
    if (onOpenSettings) {
      onOpenSettings("models");
    } else {
      toggleRightTab("llm");
    }
  };

  // 计算当前活跃模型展示名称
  const activeModelDisplay = useMemo(() => {
    if (!llmActiveProvider) return "未选择模型";
    const entry = llmEntries.find((e) => e.provider === llmActiveProvider);
    const meta = PROVIDER_METADATA[llmActiveProvider];
    return entry?.model || meta?.label || llmActiveProvider;
  }, [llmActiveProvider, llmEntries]);

  // 时间分组数据
  const groupedConversations = useMemo(
    () => groupConversationsByDate(conversations, locale),
    [conversations, locale],
  );

  /* ── 56px rail 折叠态（紧凑导航形态） ── */
  if (collapsed) {
    return (
      <aside className="desktop-sidebar desktop-sidebar--rail" aria-label="紧凑导航栏">
        {/* 顶部：展开侧边栏图标 + 新建对话 */}
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

          <RailButton
            icon={<Plus size={18} />}
            label="新建会话 (Ctrl+N)"
            highlight
            onClick={() => void onNewChat()}
          />
        </div>

        {/* 中部：工作区 */}
        <div className="desktop-sidebar__rail-tools">
          <RailButton
            icon={<FolderCode size={17} />}
            label={copy.workspaceEntry}
            active={activeRightTab === "workspace"}
            onClick={() => toggleRightTab("workspace")}
          />
        </div>

        {/* 底部：模型状态与设置 */}
        <div className="desktop-sidebar__rail-bottom">
          <RailButton
            icon={<Cpu size={17} />}
            label={`模型: ${activeModelDisplay}`}
            active={activeRightTab === "llm"}
            onClick={handleOpenModelSettings}
          />
          <RailButton
            icon={<Settings size={17} />}
            label="设置"
            active={activeRightTab === "settings" || activeRightTab === "skills" || activeRightTab === "memory"}
            onClick={handleOpenGeneralSettings}
          />
        </div>
      </aside>
    );
  }

  /* ── 展开态：Wordmark 品牌 → 醒目“+ 新建对话” → 手风琴时间分组历史 → 底部收纳设置 ── */
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
      {/* 1. 品牌行（Wordmark + 折叠按钮） */}
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

      {/* 2. 醒目的“+ 新建对话”大按钮 */}
      <button
        type="button"
        className="desktop-sidebar__new-btn"
        onClick={() => void onNewChat()}
        title="新建对话 (Ctrl+N)"
      >
        <Plus size={16} />
        <span className="desktop-sidebar__new-btn-label">{copy.newChat}</span>
        <kbd className="desktop-sidebar__kbd">^N</kbd>
      </button>

      {/* 3. 中部历史对话列表（手风琴时间折叠，分配最大垂直高度） */}
      <div className="desktop-sidebar__history">
        <div className="desktop-sidebar__history-head">
          <span className="desktop-sidebar__history-title">{copy.history}</span>
          <span className="desktop-sidebar__history-count">{conversations.length}</span>
        </div>

        <div className="desktop-sidebar__history-list" role="list">
          {conversations.length === 0 ? (
            <p className="desktop-sidebar__history-empty">{copy.noHistory}</p>
          ) : (
            groupedConversations.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <div key={group.key} className="desktop-sidebar__group">
                  {/* 手风琴分组头部 */}
                  <button
                    type="button"
                    className="desktop-sidebar__group-header"
                    onClick={() => toggleGroupCollapse(group.key)}
                    title={`${isCollapsed ? "展开" : "折叠"} ${group.label}`}
                  >
                    <span className="desktop-sidebar__group-chevron">
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </span>
                    <span className="desktop-sidebar__group-label">{group.label}</span>
                    <span className="desktop-sidebar__group-badge">{group.items.length}</span>
                  </button>

                  {/* 分组列表项 */}
                  {!isCollapsed ? (
                    <div className="desktop-sidebar__group-items">
                      {group.items.map((conv) => {
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
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. 底部低频/系统操作收纳（仅保留模型状态与设置两大入口） */}
      <div className="desktop-sidebar__foot">
        {/* 个人中心 / 模型状态入口 */}
        <button
          type="button"
          className="desktop-sidebar__foot-btn"
          onClick={handleOpenModelSettings}
          title={`当前模型: ${activeModelDisplay}，点击配置`}
        >
          <div className="desktop-sidebar__status-avatar">
            <User size={15} />
            <span className="desktop-sidebar__status-dot" />
          </div>
          <div className="desktop-sidebar__status-info">
            <span className="desktop-sidebar__status-model">{activeModelDisplay}</span>
            <span className="desktop-sidebar__status-label">模型就绪</span>
          </div>
        </button>

        {/* 综合设置入口 */}
        <button
          type="button"
          className="desktop-sidebar__foot-btn"
          onClick={handleOpenGeneralSettings}
          title="系统设置与偏好"
        >
          <div className="desktop-sidebar__status-avatar">
            <Settings size={15} />
          </div>
          <div className="desktop-sidebar__status-info">
            <span className="desktop-sidebar__status-model">设置</span>
            <span className="desktop-sidebar__status-label">常规 / 模型 / 权限 / 外观</span>
          </div>
        </button>
      </div>
    </aside>
  );
}
