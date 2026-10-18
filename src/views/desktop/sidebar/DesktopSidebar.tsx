import { ProjectSelector } from "../../../components/desktop/ProjectSelector";
import { useState } from "react";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHistoryList } from "./SidebarHistoryList";
import { SidebarNewChat } from "./SidebarNewChat";
import { SidebarRail } from "./SidebarRail";
import { SidebarSearch } from "./SidebarSearch";
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
  const [searchQuery, setSearchQuery] = useState("");

  const { handlePointerEnter, handlePointerLeave, pointerInside } = useScrollbarLinger();

  const {
    collapsedGroups,
    groupedConversations,
    isSearching,
    pinnedIds,
    toggleGroupCollapse,
    togglePinConversation,
    totalMatches,
  } = useConversationGroups(conversations, locale, searchQuery);

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
      {/* 2. 新建对话与项目选择下拉菜单 */}
      <SidebarNewChat
        copy={copy}
        onNewChat={onNewChat}
      />

      <ProjectSelector variant="sidebar" onNewChat={onNewChat} onOpenSettings={() => onSelectRightTab?.("workspace")} />

      {/* 3. 历史会话实时搜索过滤 */}
      <SidebarSearch locale={locale} onChange={setSearchQuery} value={searchQuery} />

      {/* 4. 中部历史对话列表（手风琴置顶与时间折叠、搜索结果展示） */}
      <SidebarHistoryList
        activeConversationId={activeConversationId}
        collapsedGroups={collapsedGroups}
        copy={copy}
        groups={groupedConversations}
        isSearching={isSearching}
        onDeleteConversation={onDeleteConversation}
        onRenameConversation={onRenameConversation}
        onSelectConversation={onSelectConversation}
        onToggleGroupCollapse={toggleGroupCollapse}
        onTogglePinConversation={handleTogglePin}
        pinnedIds={pinnedIds}
        totalCount={conversations.length}
        totalMatches={totalMatches}
      />

      {/* 5. 底部用户个人卡片入口与设置菜单 */}
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
