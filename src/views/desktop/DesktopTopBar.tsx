import {
  CodeXml,
  Copy,
  MessageSquare,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Square,
  X,
} from "lucide-react";
import type { FormEvent, MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "../../components/brand/BrandMark";
import { useLocale } from "../../i18n/locale-context";
import type { UiCopy } from "../../i18n/messages";
import { isDesktopApp } from "../../services/app-platform";
import {
  closeDesktopWindow,
  isDesktopWindowMaximized,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "../../services/desktop-bridge";
import {
  getProjectDisplayName,
  useProjectState,
} from "../../services/project-manager";

export interface DesktopTopBarProps {
  activeConversationId?: string;
  activeView: "chat" | "editor";
  conversationTitle?: string;
  copy: UiCopy;
  onNewChat: () => Promise<void>;
  onOpenSearch?: () => void;
  onRenameConversation?: (id: string, title: string) => Promise<void>;
  onSwitchView: (view: "chat" | "editor") => void;
  onToggleSidebar?: () => void;
  onToggleRightPane?: () => void;
  rightPaneOpen?: boolean;
  sidebarCollapsed?: boolean;
}

export function DesktopTopBar({
  activeConversationId,
  activeView,
  conversationTitle,
  copy,
  onNewChat,
  onOpenSearch,
  onRenameConversation,
  onSwitchView,
  onToggleSidebar,
  onToggleRightPane,
  rightPaneOpen = false,
  sidebarCollapsed = false,
}: DesktopTopBarProps) {
  const locale = useLocale();
  const ja = locale === "ja-JP";
  const isDesktop = isDesktopApp();
  const [isMaximized, setIsMaximized] = useState(false);

  // 项目与标题重命名状态
  const { activeProject } = useProjectState();
  const projectDisplayName = getProjectDisplayName(activeProject, locale);
  const currentTitle = conversationTitle || copy.newChat;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const savingTitleRef = useRef(false);
  // Enter 提交后输入框卸载、Esc 取消后都可能再触发一次 blur，关闭后不再保存
  const titleEditOpenRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const handleStartEditTitle = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activeConversationId) return;
    titleEditOpenRef.current = true;
    setEditingTitleDraft(currentTitle);
    setIsEditingTitle(true);
  }, [activeConversationId, currentTitle]);

  const closeTitleEditor = useCallback(() => {
    titleEditOpenRef.current = false;
    setIsEditingTitle(false);
  }, []);

  const handleSaveTitle = useCallback(async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!titleEditOpenRef.current || savingTitleRef.current) return;
    const title = editingTitleDraft.trim();
    if (!activeConversationId || !title || title === currentTitle) {
      closeTitleEditor();
      return;
    }
    savingTitleRef.current = true;
    setIsSavingTitle(true);
    try {
      await onRenameConversation?.(activeConversationId, title);
      closeTitleEditor();
    } catch {
      /* 静默降级 */
    } finally {
      savingTitleRef.current = false;
      setIsSavingTitle(false);
    }
  }, [activeConversationId, closeTitleEditor, currentTitle, editingTitleDraft, onRenameConversation]);

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
      // 避免在按钮、输入框等交互元素上双击触发窗口缩放
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("[role='tab']") ||
        target.closest("a") ||
        target.closest("input") ||
        target.closest("form")
      ) {
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
      aria-label={ja ? "アプリのトップバー" : "应用顶栏"}
    >
      {/* 1. 左侧：品牌字形、侧栏开关与搜索 + 会话标题与当前项目名 */}
      <div className="desktop-topbar__left" data-tauri-drag-region>
        <button
          type="button"
          className="desktop-topbar__brand-btn"
          onClick={() => void onNewChat()}
          title={ja ? "月見八千代 (Tsukimi Yachiyo)" : "月见八千代 (Tsukimi Yachiyo)"}
          aria-label={ja ? "月見八千代" : "月见八千代"}
        >
          <BrandMark className="desktop-topbar__brand-mark" size={18} />
        </button>

        {onToggleSidebar ? (
          <button
            type="button"
            className="desktop-topbar__collapse-btn"
            onClick={onToggleSidebar}
            title={
            sidebarCollapsed
              ? ja ? "サイドバーを展開 (Ctrl+[)" : "展开侧边栏 (Ctrl+[)"
              : ja ? "サイドバーを折りたたむ (Ctrl+[)" : "折叠侧边栏 (Ctrl+[)"
          }
          aria-label={
            sidebarCollapsed
              ? ja ? "サイドバーを展開" : "展开侧边栏"
              : ja ? "サイドバーを折りたたむ" : "折叠侧边栏"
          }
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        ) : null}

        {onOpenSearch ? (
          <button
            type="button"
            className="desktop-topbar__collapse-btn"
            onClick={onOpenSearch}
            title={ja ? "会話・モデル・設定を検索 (Ctrl+K)" : "搜索对话、模型或设置 (Ctrl+K)"}
            aria-label={ja ? "検索" : "搜索"}
          >
            <Search size={15} />
          </button>
        ) : null}

        {/* 会话标题（保留点击重命名）与当前项目名 */}
        {isEditingTitle ? (
          <form onSubmit={(e) => void handleSaveTitle(e)} className="desktop-topbar__rename-form">
            <input
              ref={titleInputRef}
              type="text"
              value={editingTitleDraft}
              onChange={(e) => setEditingTitleDraft(e.target.value)}
              disabled={isSavingTitle}
              onBlur={() => void handleSaveTitle()}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  if (event.key === "Enter") event.preventDefault();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeTitleEditor();
                }
              }}
              className="desktop-topbar__rename-input"
              aria-label={ja ? "現在の会話の名前を変更" : "重命名当前会话"}
            />
          </form>
        ) : (
          <div className="desktop-topbar__title-wrapper">
            <button
              type="button"
              className="desktop-topbar__title-btn"
              title={ja ? `${currentTitle}（クリックで名前を変更）` : `${currentTitle} (点击重命名)`}
              onClick={handleStartEditTitle}
            >
              <span className="desktop-topbar__title">{currentTitle}</span>
            </button>
            <span
              className="desktop-topbar__project-name"
              title={ja ? `現在のプロジェクト：${projectDisplayName}` : `当前项目：${projectDisplayName}`}
            >
              {projectDisplayName}
            </span>
          </div>
        )}
      </div>

      {/* 2. 弹性空白区域：充当窗口拖拽手柄 */}
      <div className="desktop-topbar__spacer" data-tauri-drag-region />

      {/* 3. 右侧小图标视图切换按钮（保留 Ctrl+1 / Ctrl+2） */}
      <button
        type="button"
        className={`desktop-topbar__view-toggle-btn ${activeView === "editor" ? "desktop-topbar__view-toggle-btn--active" : ""}`}
        onClick={() => onSwitchView(activeView === "chat" ? "editor" : "chat")}
        title={
          activeView === "chat"
            ? `${copy.editorTab} (Ctrl+2)`
            : `${copy.editorViewTab} (Ctrl+1)`
        }
        aria-label={activeView === "chat" ? copy.editorTab : copy.editorViewTab}
      >
        {activeView === "chat" ? <CodeXml size={15} /> : <MessageSquare size={15} />}
      </button>

      {/* 右侧面板展开/收起按钮 */}
      {onToggleRightPane ? (
        <button
          type="button"
          className="desktop-topbar__collapse-btn"
          onClick={onToggleRightPane}
          title={
              rightPaneOpen
                ? ja ? "右側の成果パネルを閉じる (Ctrl+B)" : "收起右侧成果面板 (Ctrl+B)"
                : ja ? "右側の成果パネルを開く (Ctrl+B)" : "展开右侧成果面板 (Ctrl+B)"
            }
          aria-label={
              rightPaneOpen
                ? ja ? "成果パネルを閉じる" : "收起成果面板"
                : ja ? "成果パネルを開く" : "展开成果面板"
            }
        >
          {rightPaneOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      ) : null}

      {/* 4. 原生感桌面窗口控制三件套（仅在桌面环境下渲染）。
          透明无边框窗口里 WebView2 的原生 title 气泡贴着窗口右缘会被裁切并留下黑边残影，
          这里改用页面内的 data-tooltip 提示 */}
      {isDesktop ? (
        <div className="desktop-window-controls" role="group" aria-label={ja ? "ウィンドウ操作" : "窗口控制"}>
          <button
            type="button"
            className="desktop-window-control-btn"
            onClick={handleMinimize}
            data-tooltip="最小化"
            aria-label={ja ? "ウィンドウを最小化" : "最小化窗口"}
          >
            <Minus size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="desktop-window-control-btn"
            onClick={(e) => void handleToggleMaximize(e)}
            data-tooltip={isMaximized ? (ja ? "元のサイズに戻す" : "向下还原") : "最大化"}
            aria-label={
              isMaximized
                ? ja ? "ウィンドウを元のサイズに戻す" : "向下还原窗口"
                : ja ? "ウィンドウを最大化" : "最大化窗口"
            }
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
            data-tooltip={ja ? "閉じる" : "关闭"}
            aria-label={ja ? "ウィンドウを閉じる" : "关闭窗口"}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
