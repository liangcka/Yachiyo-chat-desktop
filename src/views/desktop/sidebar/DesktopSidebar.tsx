import { SidebarFooter } from "./SidebarFooter";
import { SidebarHistoryList } from "./SidebarHistoryList";
import { SidebarNewChat } from "./SidebarNewChat";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarRail } from "./SidebarRail";
import type { DesktopRightTab, DesktopSidebarProps } from "./types";
import { useConversationGroups } from "./use-conversation-groups";
import { useScrollbarLinger } from "./use-scrollbar-linger";

export function DesktopSidebar({
  activeConversationId,
  activeRightTab,
  collapsed = false,
  conversations,
  copy,
  locale,
  onDeleteConversation,
  onLocale,
  onNewChat,
  onOpenSettings,
  onRenameConversation,
  onSelectConversation,
  onSelectRightTab,
  onSignOut,
  onCloseApp,
  onToggleCollapse,
  onTogglePinConversation,
  onToggleTheme,
  resolvedTheme = "dark",
  showToast,
}: DesktopSidebarProps) {
  const { handlePointerEnter, handlePointerLeave, pointerInside } = useScrollbarLinger();

  const { orderedConversations, pinnedIds, togglePinConversation } = useConversationGroups(conversations);

  const handleTogglePin = onTogglePinConversation || togglePinConversation;

  if (collapsed) {
    return (
      <SidebarRail
        copy={copy}
        locale={locale}
        onCloseApp={onCloseApp}
        onLocale={onLocale}
        onNewChat={onNewChat}
        onOpenSettings={onOpenSettings}
        onOpenWorkspace={() => onSelectRightTab?.("workspace")}
        onSignOut={onSignOut}
        onToggleCollapse={onToggleCollapse}
        onToggleTheme={onToggleTheme}
        resolvedTheme={resolvedTheme}
        showToast={showToast}
      />
    );
  }

  const toggleTab = (tab: "llm" | "settings") => {
    const nextTab: DesktopRightTab = activeRightTab === tab ? "none" : tab;
    onSelectRightTab?.(nextTab);
  };

  return (
    <aside
      className={`desktop-sidebar ${!pointerInside ? "desktop-sidebar--quiet-bars" : ""}`}
      aria-label={locale === "ja-JP" ? "ナビゲーションと会話履歴" : "桌面导航与历史会话"}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <SidebarNewChat
        copy={copy}
        onNewChat={onNewChat}
      />

      {/* 项目与对话共用一个滚动区，项目较多时不会挤压对话列表 */}
      <div className="desktop-sidebar__scroll">
        <SidebarProjects
          locale={locale}
          onNewChat={onNewChat}
          onOpenWorkspace={() => onSelectRightTab?.("workspace")}
        />
        <SidebarHistoryList
          activeConversationId={activeConversationId}
          conversations={orderedConversations}
          copy={copy}
          onDeleteConversation={onDeleteConversation}
          onRenameConversation={onRenameConversation}
          onSelectConversation={onSelectConversation}
          onTogglePinConversation={handleTogglePin}
          pinnedIds={pinnedIds}
        />
      </div>

      <SidebarFooter
        locale={locale}
        onCloseApp={onCloseApp}
        onLocale={onLocale}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
        onToggleTab={toggleTab}
        onToggleTheme={onToggleTheme}
        resolvedTheme={resolvedTheme}
        showToast={showToast}
      />
    </aside>
  );
}
