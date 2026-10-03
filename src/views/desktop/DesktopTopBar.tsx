import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import type { UiCopy } from "../../i18n/messages";
import { isDesktopApp } from "../../services/app-platform";
import {
  closeDesktopWindow,
  isDesktopWindowMaximized,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "../../services/desktop-bridge";

export interface DesktopTopBarProps {
  activeView: "chat" | "editor";
  copy: UiCopy;
  onNewChat: () => Promise<void>;
  onSwitchView: (view: "chat" | "editor") => void;
  onToggleSidebar?: () => void;
  onToggleRightPane?: () => void;
  rightPaneOpen?: boolean;
  sidebarCollapsed?: boolean;
}

export function DesktopTopBar({
  activeView,
  copy,
  onNewChat,
  onSwitchView,
  onToggleSidebar,
  onToggleRightPane,
  rightPaneOpen = false,
  sidebarCollapsed = false,
}: DesktopTopBarProps) {
  const isDesktop = isDesktopApp();
  const [isMaximized, setIsMaximized] = useState(false);

  // 初始化与监听桌面窗口最大化/还原状态
  useEffect(() => {
    if (!isDesktop) return;

    let unlisten: (() => void) | undefined;
    let isMounted = true;

    void isDesktopWindowMaximized().then((max) => {
      if (isMounted) setIsMaximized(max);
    });

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const unlistenFn = await win.onResized(async () => {
          if (!isMounted) return;
          const max = await win.isMaximized();
          setIsMaximized(max);
        });
        if (isMounted) {
          unlisten = unlistenFn;
        } else {
          unlistenFn();
        }
      } catch {
        /* 非 Tauri 环境静默降级 */
      }
    })();

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [isDesktop]);

  const handleMinimize = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    await minimizeDesktopWindow();
  }, []);

  const handleToggleMaximize = useCallback(async (e?: MouseEvent) => {
    e?.stopPropagation();
    await toggleMaximizeDesktopWindow();
    const nextMax = await isDesktopWindowMaximized();
    setIsMaximized(nextMax);
  }, []);

  const handleClose = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    await closeDesktopWindow();
  }, []);

  // 双击顶栏空白拖拽区触发表单最大化/还原
  const handleDoubleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!isDesktop) return;
      // 避免在按钮等交互元素上双击触发窗口缩放
      const target = e.target as HTMLElement;
      if (target.closest("button") || target.closest("[role='tab']") || target.closest("a")) {
        return;
      }
      void handleToggleMaximize();
    },
    [isDesktop, handleToggleMaximize],
  );

  return (
    <header
      className="desktop-topbar"
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      aria-label="应用顶栏"
    >
      {/* 1. 左侧：应用品牌徽章与侧栏折叠开关 */}
      <div className="desktop-topbar__left" data-tauri-drag-region>
        <button
          type="button"
          className="desktop-topbar__brand-btn"
          onClick={() => void onNewChat()}
          title="月见八千代 (Tsukimi Yachiyo)"
          aria-label="月见八千代"
        >
          <span className="desktop-topbar__brand-icon-wrap" aria-hidden="true">
            <Sparkles size={13} className="desktop-topbar__brand-icon" />
          </span>
          <span className="desktop-topbar__brand-title">月见八千代</span>
          <span className="desktop-topbar__brand-pill" aria-hidden="true">
            IDE
          </span>
        </button>

        {onToggleSidebar ? (
          <button
            type="button"
            className="desktop-topbar__collapse-btn"
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? "展开侧边栏 (Ctrl+[)" : "折叠侧边栏 (Ctrl+[)"}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        ) : null}
      </div>

      {/* 2. 居中：视图切换胶囊控制器 */}
      <div className="desktop-topbar__center" data-tauri-drag-region>
        <div className="center-view-switcher" role="tablist" aria-label="中栏视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "chat"}
            className={`center-view-switcher__btn ${activeView === "chat" ? "center-view-switcher__btn--active" : ""}`}
            onClick={() => onSwitchView("chat")}
          >
            {copy.editorViewTab}
            <kbd>Ctrl+1</kbd>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "editor"}
            className={`center-view-switcher__btn ${activeView === "editor" ? "center-view-switcher__btn--active" : ""}`}
            onClick={() => onSwitchView("editor")}
          >
            {copy.editorTab}
            <kbd>Ctrl+2</kbd>
          </button>
        </div>
      </div>

      {/* 3. 弹性空白区域：充当窗口拖拽手柄 */}
      <div className="desktop-topbar__spacer" data-tauri-drag-region />

      {/* 右侧面板展开/收起按钮 */}
      {onToggleRightPane ? (
        <button
          type="button"
          className="desktop-topbar__collapse-btn"
          onClick={onToggleRightPane}
          title={rightPaneOpen ? "收起右侧成果面板 (Ctrl+B)" : "展开右侧成果面板 (Ctrl+B)"}
          aria-label={rightPaneOpen ? "收起成果面板" : "展开成果面板"}
        >
          {rightPaneOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      ) : null}

      {/* 4. 右侧：原生感桌面窗口控制三件套（仅在桌面环境下渲染） */}
      {isDesktop ? (
        <div className="desktop-window-controls" role="group" aria-label="窗口控制">
          <button
            type="button"
            className="desktop-window-control-btn"
            onClick={handleMinimize}
            title="最小化"
            aria-label="最小化窗口"
          >
            <Minus size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="desktop-window-control-btn"
            onClick={(e) => void handleToggleMaximize(e)}
            title={isMaximized ? "向下还原" : "最大化"}
            aria-label={isMaximized ? "向下还原窗口" : "最大化窗口"}
          >
            {isMaximized ? (
              <Copy size={11} strokeWidth={2} className="desktop-window-control-icon--restore" />
            ) : (
              <Square size={12} strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            className="desktop-window-control-btn desktop-window-control-btn--close"
            onClick={handleClose}
            title="关闭"
            aria-label="关闭窗口"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
