import {
  Check,
  ChevronRight,
  Globe,
  HelpCircle,
  Moon,
  Power,
  RotateCcw,
  Settings,
  Sun,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../domain/chat";
import type { SettingsTabKey } from "../../../components/settings/SettingsModal";
import {
  PRESET_USER_BADGES,
  saveLocalUserSettings,
  type LocalUserSettings,
  type PresetUserBadge,
} from "../../../services/user-settings";
import { exitDesktopApp, openExternalUrl } from "../../../services/desktop-bridge";
import { copyFor } from "../../../i18n/messages";

export interface SidebarUserPopoverProps {
  isOpen: boolean;
  locale?: Locale;
  onClose: () => void;
  onCloseApp?: () => Promise<void> | void;
  onLocale?: (locale: Locale) => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onSignOut?: () => Promise<void>;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
  showToast?: (message: string, tone?: "info" | "error") => void;
  userSettings: LocalUserSettings;
}

export function SidebarUserPopover({
  isOpen,
  locale = "zh-CN",
  onClose,
  onCloseApp,
  onLocale,
  onOpenSettings,
  onSignOut,
  onToggleTheme,
  resolvedTheme = "dark",
  showToast,
  userSettings,
}: SidebarUserPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const badgePickerRef = useRef<HTMLDivElement | null>(null);
  const customBadgeInputRef = useRef<HTMLInputElement | null>(null);

  const copy = copyFor(locale);

  // 称号选择器浮层
  const [isBadgePickerOpen, setIsBadgePickerOpen] = useState<boolean>(false);
  const [customBadgeDraft, setCustomBadgeDraft] = useState<string>("");

  // 监听外部点击与 Esc 关闭
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        isBadgePickerOpen &&
        badgePickerRef.current &&
        !badgePickerRef.current.contains(target)
      ) {
        setIsBadgePickerOpen(false);
        return;
      }
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose();
        setIsBadgePickerOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isBadgePickerOpen) {
          setIsBadgePickerOpen(false);
          return;
        }
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isBadgePickerOpen, onClose]);

  if (!isOpen) return null;

  const currentBadge = userSettings.badge || "Lite";

  const handleOpenAccount = () => {
    onClose();
    onOpenSettings?.("user");
  };

  const handleToggleLocale = () => {
    if (onLocale) {
      const next = locale === "zh-CN" ? "ja-JP" : "zh-CN";
      void onLocale(next);
    }
  };

  const handleOpenGeneralSettings = () => {
    onClose();
    onOpenSettings?.("general");
  };

  const handleReportIssue = () => {
    onClose();
    void openExternalUrl("https://github.com/liangcka/Yachiyo-chat-desktop");
  };

  const handleCloseAppClick = async () => {
    onClose();
    if (onCloseApp) {
      await onCloseApp();
      return;
    }
    if (onSignOut) {
      await onSignOut();
      return;
    }
    const closed = await exitDesktopApp();
    if (!closed) {
      showToast?.("当前在浏览器模式，请直接关闭窗口或标签页", "info");
    }
  };

  const handleSelectPresetBadge = (badge: PresetUserBadge) => {
    saveLocalUserSettings({ badge });
    setIsBadgePickerOpen(false);
    showToast?.(`已切换称号为「${badge}」`, "info");
  };

  const handleSaveCustomBadge = () => {
    const trimmed = customBadgeDraft.trim();
    if (!trimmed) {
      handleSelectPresetBadge("Lite");
      return;
    }
    const finalBadge = trimmed.slice(0, 10);
    saveLocalUserSettings({ badge: finalBadge });
    setIsBadgePickerOpen(false);
    setCustomBadgeDraft("");
    showToast?.(`已设置个性称号为「${finalBadge}」`, "info");
  };

  const username = userSettings.username || "酒寄彩叶";
  const isLight = resolvedTheme === "light";

  const getBadgeStyleClass = (badge: string) => {
    const lower = badge.toLowerCase();
    if (lower === "plus") return "desktop-sidebar__popover-badge--plus";
    if (lower === "pro") return "desktop-sidebar__popover-badge--pro";
    if (lower === "go") return "desktop-sidebar__popover-badge--go";
    if (lower === "lite") return "desktop-sidebar__popover-badge--lite";
    return "desktop-sidebar__popover-badge--custom";
  };

  return (
    <div
      ref={popoverRef}
      className="desktop-sidebar__user-popover"
      role="dialog"
      aria-label="用户账户与设置菜单"
    >
      {/* 1. 顶部用户卡片 */}
      <div className="desktop-sidebar__popover-header">
            <div className="desktop-sidebar__popover-user-main">
              <div className="desktop-sidebar__popover-avatar">
                {userSettings.avatar ? (
                  <img src={userSettings.avatar} alt={username} />
                ) : (
                  <div className="desktop-sidebar__popover-avatar-placeholder">
                    <User size={22} />
                  </div>
                )}
              </div>
              <div className="desktop-sidebar__popover-user-meta">
                <div className="desktop-sidebar__popover-user-row">
                  <span className="desktop-sidebar__popover-username" title={username}>
                    {username}
                  </span>

                  {/* 可点击切换的称号徽章 */}
                  <button
                    type="button"
                    className={`desktop-sidebar__popover-badge desktop-sidebar__popover-badge--interactive ${getBadgeStyleClass(currentBadge)}`}
                    onClick={() => setIsBadgePickerOpen((prev) => !prev)}
                    title={`当前称号：${currentBadge}（点击切换称号，如 Plus / Pro / Go）`}
                    aria-label={`切换称号，当前为 ${currentBadge}`}
                    aria-haspopup="true"
                    aria-expanded={isBadgePickerOpen}
                  >
                    <span>{currentBadge}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 称号选择浮层（点击 Lite/称号时展开） */}
          {isBadgePickerOpen ? (
            <div
              ref={badgePickerRef}
              className="desktop-sidebar__popover-badge-picker"
              role="region"
              aria-label="选择称号"
            >
              <div className="desktop-sidebar__popover-badge-picker-header">
                <span className="desktop-sidebar__popover-badge-picker-title">选择或自定义称号</span>
                <button
                  type="button"
                  className="desktop-sidebar__popover-badge-picker-close"
                  onClick={() => setIsBadgePickerOpen(false)}
                  aria-label="关闭称号选择"
                >
                  <X size={13} />
                </button>
              </div>

              {/* 预设快捷标签按钮：Lite / Plus / Pro / Go */}
              <div className="desktop-sidebar__popover-badge-tags">
                {PRESET_USER_BADGES.map((badge) => {
                  const isSelected = currentBadge.toLowerCase() === badge.toLowerCase();
                  return (
                    <button
                      key={badge}
                      type="button"
                      className={`desktop-sidebar__popover-badge-tag desktop-sidebar__popover-badge-tag--${badge.toLowerCase()} ${
                        isSelected ? "desktop-sidebar__popover-badge-tag--active" : ""
                      }`}
                      onClick={() => handleSelectPresetBadge(badge)}
                    >
                      {badge}
                      {isSelected ? <Check size={11} style={{ marginLeft: 3 }} /> : null}
                    </button>
                  );
                })}
              </div>

              {/* 自定义输入框 */}
              <div className="desktop-sidebar__popover-badge-custom-row">
                <input
                  ref={customBadgeInputRef}
                  type="text"
                  className="desktop-sidebar__popover-badge-input"
                  placeholder="自定义输入 (如 VIP, Go)"
                  maxLength={10}
                  value={customBadgeDraft}
                  onChange={(e) => setCustomBadgeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveCustomBadge();
                    }
                  }}
                />
                <button
                  type="button"
                  className="desktop-sidebar__popover-badge-save-btn"
                  onClick={handleSaveCustomBadge}
                  title="保存个性称号"
                >
                  应用
                </button>
                {currentBadge !== "Lite" ? (
                  <button
                    type="button"
                    className="desktop-sidebar__popover-badge-reset-btn"
                    onClick={() => handleSelectPresetBadge("Lite")}
                    title="重置为默认 Lite"
                  >
                    <RotateCcw size={12} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="desktop-sidebar__popover-divider" />

          {/* 3. 菜单项：管理账户、语言、主题、设置、报告问题 */}
          <div className="desktop-sidebar__popover-menu">
            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleOpenAccount}
              aria-label="管理账户"
            >
              <div className="desktop-sidebar__popover-item-left">
                <User size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">管理账户</span>
              </div>
              <ChevronRight size={14} className="desktop-sidebar__popover-item-arrow" />
            </button>

            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleToggleLocale}
              title="切换语言"
              aria-label="选择语言"
            >
              <div className="desktop-sidebar__popover-item-left">
                <Globe size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">语言</span>
              </div>
              <div className="desktop-sidebar__popover-item-right">
                <span className="desktop-sidebar__popover-item-value">
                  {locale === "ja-JP" ? "日本語" : "简体中文"}
                </span>
                <ChevronRight size={14} className="desktop-sidebar__popover-item-arrow" />
              </div>
            </button>

            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={onToggleTheme}
              aria-label="切换主题"
            >
              <div className="desktop-sidebar__popover-item-left">
                {isLight ? (
                  <Sun size={16} className="desktop-sidebar__popover-item-icon" />
                ) : (
                  <Moon size={16} className="desktop-sidebar__popover-item-icon" />
                )}
                <span className="desktop-sidebar__popover-item-label">主题</span>
              </div>
              <div className="desktop-sidebar__popover-item-right">
                <span className="desktop-sidebar__popover-item-value">{isLight ? "亮色" : "深色"}</span>
                <ChevronRight size={14} className="desktop-sidebar__popover-item-arrow" />
              </div>
            </button>

            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleOpenGeneralSettings}
              title="系统设置与偏好"
              aria-label="设置"
            >
              <div className="desktop-sidebar__popover-item-left">
                <Settings size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">设置</span>
              </div>
            </button>

            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleReportIssue}
              aria-label="报告问题"
            >
              <div className="desktop-sidebar__popover-item-left">
                <HelpCircle size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">报告问题</span>
              </div>
            </button>
          </div>

          {/* 4. 底部：关闭应用（替换原样板退出登录） */}
          <div className="desktop-sidebar__popover-footer">
            <button
              type="button"
              className="desktop-sidebar__popover-logout-btn desktop-sidebar__popover-close-btn"
              onClick={handleCloseAppClick}
              aria-label={copy.closeApp || "关闭应用"}
              title={copy.closeApp || "关闭应用"}
              data-action="close-app"
            >
              <Power size={16} className="desktop-sidebar__popover-logout-icon" />
              <span>{copy.closeApp || "关闭应用"}</span>
            </button>
          </div>
    </div>
  );
}
