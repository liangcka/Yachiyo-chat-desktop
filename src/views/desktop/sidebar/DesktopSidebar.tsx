import { useMemo, useState } from "react";
import { PROVIDER_METADATA } from "../../../domain/llm";
import { SidebarBrandHeader } from "./SidebarBrandHeader";
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
  llmActiveProvider,
  llmEntries = [],
  locale,
  onDeleteConversation,
  onLocale,
  onNewChat,
  onOpenSettings,
  onRenameConversation,
  onSelectConversation,
  onSelectRightTab,
  onToggleCollapse,
  onTogglePinConversation,
  onToggleTheme,
  resolvedTheme = "dark",
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

  const activeModelDisplay = useMemo(() => {
    if (!llmActiveProvider) return "未选择模型";
    const entry = llmEntries.find((e) => e.provider === llmActiveProvider);
    const meta = PROVIDER_METADATA[llmActiveProvider];
    return entry?.model || meta?.label || llmActiveProvider;
  }, [llmActiveProvider, llmEntries]);

  const handleTogglePin = onTogglePinConversation || togglePinConversation;

  if (collapsed) {
    return (
      <SidebarRail
        activeModelDisplay={activeModelDisplay}
        activeRightTab={activeRightTab}
        copy={copy}
        onNewChat={onNewChat}
        onOpenSettings={onOpenSettings}
        onSelectRightTab={onSelectRightTab}
        onToggleCollapse={onToggleCollapse}
        onToggleTheme={onToggleTheme}
        resolvedTheme={resolvedTheme}
      />
    );
  }

  const toggleTab = (tab: "llm" | "settings") => {
    const nextTab: DesktopRightTab = activeRightTab === tab ? "none" : tab;
    onSelectRightTab(nextTab);
  };

  return (
    <aside
      className={`desktop-sidebar ${!pointerInside ? "desktop-sidebar--quiet-bars" : ""}`}
      aria-label="桌面导航与历史会话"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* 1. 顶部品牌与折叠按钮 */}
      <SidebarBrandHeader onNewChat={onNewChat} onToggleCollapse={onToggleCollapse} />

      {/* 2. 新建对话按钮 */}
      <SidebarNewChat copy={copy} onNewChat={onNewChat} />

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

      {/* 5. 底部模型状态与一体化快捷工具坞 */}
      <SidebarFooter
        activeModelDisplay={activeModelDisplay}
        locale={locale}
        onLocale={onLocale}
        onOpenSettings={onOpenSettings}
        onToggleTab={toggleTab}
        onToggleTheme={onToggleTheme}
        resolvedTheme={resolvedTheme}
      />
    </aside>
  );
}
