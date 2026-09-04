import { FolderCode, Moon, PanelLeftOpen, Plus, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { UiCopy } from "../../../i18n/messages";
import type { SettingsTabKey } from "../../../components/settings/SettingsModal";

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
  onNewChat: () => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onToggleCollapse?: () => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
}

export function SidebarRail({
  copy,
  onNewChat,
  onOpenSettings,
  onToggleCollapse,
  onToggleTheme,
  resolvedTheme = "dark",
}: SidebarRailProps) {
  const handleOpenGeneralSettings = () => {
    onOpenSettings?.("general");
  };

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

      {/* 底部：主题切换与设置 */}
      <div className="desktop-sidebar__rail-bottom">
        {onToggleTheme ? (
          <RailButton
            icon={resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            label={resolvedTheme === "dark" ? "浅色主题" : "深色主题"}
            onClick={onToggleTheme}
          />
        ) : null}
        <RailButton
          icon={<Settings size={17} />}
          label="设置"
          onClick={handleOpenGeneralSettings}
        />
      </div>
    </aside>
  );
}
