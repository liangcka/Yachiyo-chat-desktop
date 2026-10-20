import { Settings, User } from "lucide-react";
import { useState } from "react";
import type { Locale } from "../../../domain/chat";
import type { SettingsTabKey } from "../../../components/settings/SettingsModal";
import { useLocalUserSettings } from "../../../services/user-settings";
import { SidebarUserPopover } from "./SidebarUserPopover";

export interface SidebarFooterProps {
  locale?: Locale;
  onCloseApp?: () => Promise<void> | void;
  onLocale?: (locale: Locale) => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onSignOut?: () => Promise<void>;
  onToggleTab?: (tab: "llm" | "settings") => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
  showToast?: (message: string, tone?: "info" | "error") => void;
}

export function SidebarFooter({
  locale = "zh-CN",
  onCloseApp,
  onLocale,
  onOpenSettings,
  onSignOut,
  onToggleTheme,
  resolvedTheme = "dark",
  showToast,
}: SidebarFooterProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [userSettings] = useLocalUserSettings();

  const username = userSettings.username || "酒寄彩叶";
  const currentBadge = userSettings.badge || "Lite";

  return (
    <div className="desktop-sidebar__footer-root">
      {/* 向上展开的用户资料与设置浮层菜单 */}
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

      {/* 底部单行：设置入口在左，头像打开用户菜单 */}
      <div
        className={`desktop-sidebar__user-bar ${popoverOpen ? "desktop-sidebar__user-bar--active" : ""}`}
      >
        {onOpenSettings ? (
          <button
            type="button"
            className="desktop-sidebar__settings-btn"
            onClick={() => onOpenSettings("general")}
            aria-label={locale === "ja-JP" ? "設定を開く" : "打开设置"}
            title={`${locale === "ja-JP" ? "設定" : "设置"} (Ctrl+,)`}
          >
            <Settings size={15} aria-hidden="true" />
            <span>{locale === "ja-JP" ? "設定" : "设置"}</span>
          </button>
        ) : <span className="desktop-sidebar__user-bar-spacer" />}
        <button
          type="button"
          className="desktop-sidebar__user-bar-main"
          onClick={() => setPopoverOpen((prev) => !prev)}
          aria-label={locale === "ja-JP" ? "プロフィールとメニュー" : "用户资料与菜单"}
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
          title={
            locale === "ja-JP"
              ? `ユーザー：${username} [${currentBadge}]（クリックでメニューを開く）`
              : `当前用户：${username} [${currentBadge}]（点击展开菜单）`
          }
        >
          <div className="desktop-sidebar__user-bar-avatar">
            {userSettings.avatar ? (
              <img src={userSettings.avatar} alt={username} />
            ) : (
              <div className="desktop-sidebar__user-bar-avatar-placeholder">
                <User size={14} />
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}
