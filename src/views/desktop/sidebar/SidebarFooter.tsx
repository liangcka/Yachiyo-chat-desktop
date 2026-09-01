import { Globe, Moon, Settings, Sun } from "lucide-react";
import type { Locale } from "../../../domain/chat";
import type { SettingsTabKey } from "../../../components/settings/SettingsModal";

interface SidebarFooterProps {
  locale?: Locale;
  onLocale?: (locale: Locale) => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onToggleTab?: (tab: "llm" | "settings") => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
}

export function SidebarFooter({
  locale = "zh-CN",
  onLocale,
  onOpenSettings,
  onToggleTab,
  onToggleTheme,
  resolvedTheme = "dark",
}: SidebarFooterProps) {
  const handleOpenGeneralSettings = () => {
    if (onOpenSettings) {
      onOpenSettings("general");
    } else if (onToggleTab) {
      onToggleTab("settings");
    }
  };

  const handleToggleLocale = () => {
    if (onLocale) {
      const nextLocale = locale === "zh-CN" ? "ja-JP" : "zh-CN";
      void onLocale(nextLocale);
    }
  };

  return (
    <div className="desktop-sidebar__footer-root">
      {/* 底部快捷工具坞 (主题、语言、设置) */}
      <div className="desktop-sidebar__footer-actions">
        {onToggleTheme ? (
          <button
            type="button"
            className="desktop-sidebar__footer-action"
            onClick={onToggleTheme}
            title={resolvedTheme === "dark" ? "切换至浅色主题" : "切换至深色主题"}
            aria-label="切换主题"
          >
            {resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        ) : null}

        {onLocale ? (
          <button
            type="button"
            className="desktop-sidebar__footer-action desktop-sidebar__footer-action--lang"
            onClick={handleToggleLocale}
            title={locale === "zh-CN" ? "切换为日本語" : "切换为中文"}
            aria-label="切换语言"
          >
            <Globe size={15} />
            <span className="desktop-sidebar__footer-lang-text">{locale === "ja-JP" ? "JA" : "ZH"}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="desktop-sidebar__footer-action"
          onClick={handleOpenGeneralSettings}
          title="系统设置与偏好"
          aria-label="设置"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
