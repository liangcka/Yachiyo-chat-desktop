import { FolderCode, PanelLeftOpen, Plus, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UiCopy } from "../../../i18n/messages";
import type { SettingsTabKey } from "../../../components/settings/SettingsModal";
import type { Locale } from "../../../domain/chat";
import { useLocalUserSettings } from "../../../services/user-settings";
import { SidebarUserPopover } from "./SidebarUserPopover";

interface RailButtonProps {
  active?: boolean;
  danger?: boolean;
  highlight?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

function RailButton({
  active = false,
  danger = false,
  highlight = false,
  icon,
  label,
  onClick,
}: RailButtonProps) {
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

interface SidebarRailProps {
  copy: UiCopy;
  locale?: Locale;
  onCloseApp?: () => Promise<void> | void;
  onLocale?: (locale: Locale) => Promise<void>;
  onNewChat: () => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onSignOut?: () => Promise<void>;
  onToggleCollapse?: () => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
  showToast?: (message: string, tone?: "info" | "error") => void;
}

export function SidebarRail({
  copy,
  locale = "zh-CN",
  onCloseApp,
  onLocale,
  onNewChat,
  onOpenSettings,
  onSignOut,
  onToggleCollapse,
  onToggleTheme,
  resolvedTheme = "dark",
  showToast,
}: SidebarRailProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [userSettings] = useLocalUserSettings();

  const username = userSettings.username || "酒寄彩叶";

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

      {/* 中部：项目快捷 */}
      <div className="desktop-sidebar__rail-tools">
        <RailButton
          icon={<FolderCode size={17} />}
          label={copy.workspaceEntry}
          onClick={() => onOpenSettings?.("project")}
        />
      </div>

      {/* 底部：用户个人头像与向上弹出的菜单 */}
      <div className="desktop-sidebar__rail-bottom">
        <SidebarUserPopover
          isOpen={popoverOpen}
          locale={locale}
          onClose={() => setPopoverOpen(false)}
          onCloseApp={onCloseApp}
          onLocale={onLocale}
          onOpenSettings={onOpenSettings}
          onSignOut={onSignOut}
          onToggleTheme={onToggleTheme}
          resolvedTheme={resolvedTheme}
          showToast={showToast}
          userSettings={userSettings}
        />

        <button
          type="button"
          className={`desktop-sidebar__rail-avatar-btn ${
            popoverOpen ? "desktop-sidebar__rail-avatar-btn--active" : ""
          }`}
          onClick={() => setPopoverOpen((prev) => !prev)}
          title={`当前用户：${username} [${userSettings.badge || "Lite"}]（点击展开菜单）`}
          aria-label="用户账户与设置"
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
        >
          {userSettings.avatar ? (
            <img src={userSettings.avatar} alt={username} className="desktop-sidebar__rail-avatar-img" />
          ) : (
            <div className="desktop-sidebar__rail-avatar-placeholder">
              <User size={16} />
            </div>
          )}
          <span
            className={`desktop-sidebar__rail-avatar-dot desktop-sidebar__rail-avatar-dot--${(userSettings.badge || "Lite").toLowerCase()}`}
            title={`${userSettings.badge || "Lite"} 会员`}
          />
        </button>
      </div>
    </aside>
  );
}
