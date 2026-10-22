import {
  Check,
  ChevronRight,
  Globe,
  HelpCircle,
  Moon,
  Power,
  RotateCcw,
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
  const ja = locale === "ja-JP";

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
      showToast?.(
        ja ? "ブラウザで開いています。ウィンドウまたはタブを直接閉じてください" : "当前在浏览器模式，请直接关闭窗口或标签页",
        "info",
      );
    }
  };

  const handleSelectPresetBadge = (badge: PresetUserBadge) => {
    saveLocalUserSettings({ badge });
    setIsBadgePickerOpen(false);
    showToast?.(ja ? `称号を「${badge}」に切り替えました` : `已切换称号为「${badge}」`, "info");
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
    showToast?.(ja ? `称号を「${finalBadge}」に設定しました` : `已设置个性称号为「${finalBadge}」`, "info");
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
      aria-label={ja ? "アカウントと設定メニュー" : "用户账户与设置菜单"}
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
                    title={
                      ja
                        ? `現在の称号：${currentBadge}（クリックで切り替え：Plus / Pro / Go など）`
                        : `当前称号：${currentBadge}（点击切换称号，如 Plus / Pro / Go）`
                    }
                    aria-label={ja ? `称号を切り替え（現在 ${currentBadge}）` : `切换称号，当前为 ${currentBadge}`}
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
              aria-label={ja ? "称号を選択" : "选择称号"}
            >
              <div className="desktop-sidebar__popover-badge-picker-header">
                <span className="desktop-sidebar__popover-badge-picker-title">
                  {ja ? "称号を選択またはカスタマイズ" : "选择或自定义称号"}
                </span>
                <button
                  type="button"
                  className="desktop-sidebar__popover-badge-picker-close"
                  onClick={() => setIsBadgePickerOpen(false)}
                  aria-label={ja ? "称号の選択を閉じる" : "关闭称号选择"}
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
                  placeholder={ja ? "自由入力 (例: VIP, Go)" : "自定义输入 (如 VIP, Go)"}
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
                  title={ja ? "称号を保存" : "保存个性称号"}
                >
                  {ja ? "適用" : "应用"}
                </button>
                {currentBadge !== "Lite" ? (
                  <button
                    type="button"
                    className="desktop-sidebar__popover-badge-reset-btn"
                    onClick={() => handleSelectPresetBadge("Lite")}
                    title={ja ? "既定の Lite に戻す" : "重置为默认 Lite"}
                  >
                    <RotateCcw size={12} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="desktop-sidebar__popover-divider" />

          {/* 3. 菜单项：管理账户、语言、主题、报告问题；设置入口在侧栏底部常驻 */}
          <div className="desktop-sidebar__popover-menu">
            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleOpenAccount}
              aria-label={ja ? "アカウント管理" : "管理账户"}
            >
              <div className="desktop-sidebar__popover-item-left">
                <User size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">{ja ? "アカウント管理" : "管理账户"}</span>
              </div>
              <ChevronRight size={14} className="desktop-sidebar__popover-item-arrow" />
            </button>

            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleToggleLocale}
              title={ja ? "言語を切り替え" : "切换语言"}
              aria-label={ja ? "言語を選択" : "选择语言"}
            >
              <div className="desktop-sidebar__popover-item-left">
                <Globe size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">{ja ? "言語" : "语言"}</span>
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
              aria-label={ja ? "テーマを切り替え" : "切换主题"}
            >
              <div className="desktop-sidebar__popover-item-left">
                {isLight ? (
                  <Sun size={16} className="desktop-sidebar__popover-item-icon" />
                ) : (
                  <Moon size={16} className="desktop-sidebar__popover-item-icon" />
                )}
                <span className="desktop-sidebar__popover-item-label">{ja ? "テーマ" : "主题"}</span>
              </div>
              <div className="desktop-sidebar__popover-item-right">
                <span className="desktop-sidebar__popover-item-value">{isLight ? (ja ? "ライト" : "亮色") : ja ? "ダーク" : "深色"}</span>
                <ChevronRight size={14} className="desktop-sidebar__popover-item-arrow" />
              </div>
            </button>

            <button
              type="button"
              className="desktop-sidebar__popover-item"
              onClick={handleReportIssue}
              aria-label={ja ? "問題を報告" : "报告问题"}
            >
              <div className="desktop-sidebar__popover-item-left">
                <HelpCircle size={16} className="desktop-sidebar__popover-item-icon" />
                <span className="desktop-sidebar__popover-item-label">{ja ? "問題を報告" : "报告问题"}</span>
              </div>
            </button>
          </div>

          {/* 4. 底部：关闭应用（替换原样板退出登录） */}
          <div className="desktop-sidebar__popover-footer">
            <button
              type="button"
              className="desktop-sidebar__popover-logout-btn desktop-sidebar__popover-close-btn"
              onClick={handleCloseAppClick}
              aria-label={copy.closeApp}
              title={copy.closeApp}
              data-action="close-app"
            >
              <Power size={16} className="desktop-sidebar__popover-logout-icon" />
              <span>{copy.closeApp}</span>
            </button>
          </div>
    </div>
  );
}
