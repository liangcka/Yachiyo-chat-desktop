import { CommandPalette, type PaletteCommand } from "../../components/desktop/CommandPalette";
import { useComputerControlSession } from "../../features/computer-control/use-computer-control-session";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import DragHandle from "../../components/DragHandle";
import { useTheme } from "../../app/use-theme";
import { useEditorWorkspace } from "../../app/use-editor-workspace";
import type { SharedViewProps } from "../layout-types";
import { DesktopChatArea } from "./DesktopChatArea";
import { OpenReviewContext } from "../../components/chat/review-context";
import { DesktopSidebar } from "./sidebar";
import { DesktopTopBar } from "./DesktopTopBar";
import { DesktopRightPane } from "./DesktopRightPane";
import type { DesktopRightTab } from "./sidebar/types";
import type { SettingsTabKey } from "../../components/settings/SettingsModal";
import { WhaleWidget } from "../../features/whale-widget/WhaleWidget";
import { usePluginSettings } from "../../services/plugin-settings";

const EditorView = lazy(() =>
  import("../../components/editor/EditorView").then((m) => ({ default: m.EditorView })),
);

// 设置中心连同 MCP / 模型管理等面板只在打开时加载，不计入首屏主包
const SettingsModal = lazy(() =>
  import("../../components/settings/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);

/* ── 列宽约束与持久化 Key ─────────────────────────────── */

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 260;
/** 视口窄于该宽度时侧栏在显示层默认折叠（不改写用户偏好与持久化宽度），可经标题栏按钮临时展开 */
const NARROW_VIEWPORT = 900;

const RIGHT_PANE_MIN = 320;
const RIGHT_PANE_MAX = 760;
const RIGHT_PANE_DEFAULT = 460;

const STORAGE_SIDEBAR_WIDTH = "yachiyo-sidebar-width";
const STORAGE_RIGHT_PANE_WIDTH = "yachiyo-right-pane-width";
const STORAGE_RIGHT_PANE_OPEN = "yachiyo-right-pane-open";
const STORAGE_RIGHT_PANE_TAB = "yachiyo-right-pane-tab";

/** 中栏视图偏好（chat / editor），与列宽同一套 localStorage 持久化模式 */
const STORAGE_CENTER_VIEW = "yachiyo-center-view";

type CenterView = "chat" | "editor";

function readStoredCenterView(): CenterView {
  try {
    return localStorage.getItem(STORAGE_CENTER_VIEW) === "editor" ? "editor" : "chat";
  } catch {
    return "chat";
  }
}

function writeStoredCenterView(view: CenterView): void {
  try {
    localStorage.setItem(STORAGE_CENTER_VIEW, view);
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
}

function readStoredRightPaneOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_RIGHT_PANE_OPEN) === "true";
  } catch {
    return false;
  }
}

function readStoredRightTab(): DesktopRightTab {
  try {
    const raw = localStorage.getItem(STORAGE_RIGHT_PANE_TAB);
    if (raw === "review" || raw === "editor" || raw === "artifacts" || raw === "workspace") {
      return raw;
    }
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
  return "artifacts";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
  return fallback;
}

function writeStoredWidth(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* 写入失败时静默降级 */
  }
}

/* ── 组件 ────────────────────────────────────────────── */

export function DesktopLayout(props: SharedViewProps) {
  /** 用户手动折叠偏好：窄视口的强制折叠只作用于显示层，不写入该状态 */
  const [userSidebarCollapsed, setUserSidebarCollapsed] = useState(false);
  /** 折叠后侧栏不留任何入口，窄视口下需要能临时展开 */
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>("general");
  const { resolved, glass, setTheme, setGlass } = useTheme();

  // 中栏视图切换（对话 ↔ 编辑器）：editor 一旦挂载即常驻（隐藏不卸载），保留 Monaco 实例与 model
  const [centerView, setCenterView] = useState<CenterView>(readStoredCenterView);
  const [editorMounted, setEditorMounted] = useState(() => readStoredCenterView() === "editor");
  const editorWorkspace = useEditorWorkspace();

  const switchCenterView = useCallback((view: CenterView) => {
    setCenterView(view);
    if (view === "editor") setEditorMounted(true);
    writeStoredCenterView(view);
  }, []);

  // 列宽状态：初始化从 localStorage 恢复
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clamp(readStoredWidth(STORAGE_SIDEBAR_WIDTH, SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX),
  );

  // 右侧成果面板状态
  const [rightPaneOpen, setRightPaneOpen] = useState(readStoredRightPaneOpen);
  const [rightPaneWidth, setRightPaneWidth] = useState(() =>
    clamp(readStoredWidth(STORAGE_RIGHT_PANE_WIDTH, RIGHT_PANE_DEFAULT), RIGHT_PANE_MIN, RIGHT_PANE_MAX),
  );
  const [rightPaneTab, setRightPaneTab] = useState<DesktopRightTab>(readStoredRightTab);

  const toggleRightPane = useCallback(() => {
    setRightPaneOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_RIGHT_PANE_OPEN, String(next));
      } catch {
        /* 隐私模式下 localStorage 不可用 */
      }
      return next;
    });
  }, []);

  const handleSelectRightTab = useCallback((tab: DesktopRightTab) => {
    setRightPaneTab(tab);
    try {
      localStorage.setItem(STORAGE_RIGHT_PANE_TAB, tab);
    } catch {
      /* 隐私模式下 localStorage 不可用 */
    }
  }, []);

  const handleOpenRightReview = useCallback(() => {
    setRightPaneOpen(true);
    handleSelectRightTab("review");
  }, [handleSelectRightTab]);

  // 拖拽态标志：拖拽期间禁用 grid 过渡动画防止抖动
  const [dragging, setDragging] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  // 窄视口自适应：视口 < 900px 时强制 rail 折叠；恢复宽视口时还原用户折叠偏好
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const handleResize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const narrowViewport = viewportWidth < NARROW_VIEWPORT;
  const sidebarCollapsed = narrowViewport ? !narrowSidebarOpen : userSidebarCollapsed;

  const toggleSidebar = useCallback(() => {
    if (narrowViewport) setNarrowSidebarOpen((open) => !open);
    else setUserSidebarCollapsed((current) => !current);
  }, [narrowViewport]);

  const handleOpenSettings = useCallback((tab: SettingsTabKey = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // 桌面端全局快捷键支持 (Ctrl/Cmd+N 新建, Ctrl/Cmd+1/2 切换视图, Ctrl/Cmd+B 切换成果面板, Ctrl/Cmd+[ 折叠侧边栏, Ctrl/Cmd+, 打开设置, Esc 关闭设置)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!e.repeat) setPaletteOpen((open) => !open);
        return;
      }

      if (isModifier && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        if (e.repeat) return;
        void props.onNewChat();
        return;
      }

      // 中栏视图切换：Ctrl+1 对话 / Ctrl+2 编辑器
      if (isModifier && (e.code === "Digit1" || e.key === "1")) {
        e.preventDefault();
        switchCenterView("chat");
        return;
      }

      if (isModifier && (e.code === "Digit2" || e.key === "2")) {
        e.preventDefault();
        switchCenterView("editor");
        return;
      }

      // 成果面板快捷切换：Ctrl+B
      if (isModifier && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleRightPane();
        return;
      }

      if (
        isModifier &&
        (e.key === "[" || e.key === "BracketLeft" || e.code === "BracketLeft")
      ) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (isModifier && (e.key === "," || e.key === "，")) {
        e.preventDefault();
        handleOpenSettings("general");
        return;
      }

      if (e.key === "Escape") {
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleOpenSettings, props, settingsOpen, switchCenterView, toggleRightPane, toggleSidebar]);

  /* ── 拖拽回调 ─────────────────────────────────────── */

  const handleDragStart = useCallback(() => {
    setDragging(true);
  }, []);

  const handleSidebarDrag = useCallback((dx: number) => {
    setSidebarWidth((w) => clamp(w + dx, SIDEBAR_MIN, SIDEBAR_MAX));
  }, []);

  const handleSidebarDragEnd = useCallback(() => {
    setDragging(false);
    setSidebarWidth((w) => {
      writeStoredWidth(STORAGE_SIDEBAR_WIDTH, w);
      return w;
    });
  }, []);

  const handleRightPaneDrag = useCallback((dx: number) => {
    setRightPaneWidth((w) => clamp(w - dx, RIGHT_PANE_MIN, RIGHT_PANE_MAX));
  }, []);

  const handleRightPaneDragEnd = useCallback(() => {
    setDragging(false);
    setRightPaneWidth((w) => {
      writeStoredWidth(STORAGE_RIGHT_PANE_WIDTH, w);
      return w;
    });
  }, []);


  const handleToggleTheme = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const handleToggleGlass = useCallback(() => {
    setGlass(!glass);
  }, [glass, setGlass]);

  const handleCompress = useCallback(async () => {
    if (props.controller.messages.length <= 1 && !props.controller.activeConversation?.summary) {
      props.showToast(props.copy.noNeedToCompress, "info");
      return;
    }
    const success = await props.controller.compressConversation(true);
    if (success) {
      props.showToast(props.copy.compressSuccess, "info");
      await props.refreshHistory();
    } else if (props.controller.errorCode) {
      props.showToast(props.copy.compressFailed, "error");
    }
  }, [props]);

  const paletteJa = props.controller.locale === "ja-JP";
  const paletteCommands: PaletteCommand[] = [
    ...props.conversations.map((conversation) => ({ id: `chat-${conversation.id}`, label: conversation.title, group: paletteJa ? "会話" : "对话", run: () => { void props.controller.selectConversation(conversation.id); switchCenterView("chat"); } })),
    ...props.llmEntries.filter((entry) => entry.disabled !== true).map((entry) => ({ id: `model-${entry.provider}`, label: entry.model || entry.provider, group: paletteJa ? "モデル" : "模型", run: () => { void props.onLlmActivate(entry.provider); } })),
    ...(paletteJa
      ? ([ ["general", "一般"], ["models", "モデル"], ["browser", "ウェブ検索"], ["custom", "スキル"], ["shortcuts", "ショートカット"] ] as const)
      : ([ ["general", "常规"], ["models", "模型"], ["browser", "联网搜索"], ["custom", "技能"], ["shortcuts", "快捷键"] ] as const)
    ).map(([tab, label]) => ({ id: `settings-${tab}`, label, group: paletteJa ? "設定" : "设置", run: () => handleOpenSettings(tab) })),
  ];

  // AI 控制电脑期间由系统级全屏遮罩提示，按 Esc 取消控制
  useComputerControlSession(props.controller);
  const pluginSettings = usePluginSettings();

  /* ── 渲染 ─────────────────────────────────────────── */

  const effectiveSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;
  const effectiveRightPaneWidth = Math.min(rightPaneWidth, Math.max(280, viewportWidth - effectiveSidebarWidth - 320));
  const gridColumns = rightPaneOpen
    ? `${effectiveSidebarWidth}px minmax(0, 1fr) ${effectiveRightPaneWidth}px`
    : `${effectiveSidebarWidth}px minmax(0, 1fr)`;

  return (
    <div className="desktop-shell-root">
      {/* 统一沉浸式桌面顶栏：融合窗口控制、应用品牌与视图控制器 */}
      <DesktopTopBar
        activeConversationId={props.controller.activeConversation?.id}
        activeView={centerView}
        conversationTitle={props.controller.activeConversation?.title}
        copy={props.copy}
        onNewChat={props.onNewChat}
        onOpenSearch={() => setPaletteOpen(true)}
        onRenameConversation={props.onRename}
        onSwitchView={switchCenterView}
        onToggleSidebar={toggleSidebar}
        onToggleRightPane={toggleRightPane}
        rightPaneOpen={rightPaneOpen}
        sidebarCollapsed={sidebarCollapsed}
      />

      <div
        ref={layoutRef}
        className="desktop-shell"
        style={{ gridTemplateColumns: gridColumns }}
        {...(sidebarCollapsed ? { "data-sidebar-collapsed": "" } : {})}
        {...(dragging ? { "data-dragging": "" } : {})}
      >
        {/* 左列：导航与历史侧栏，列容器同时充当右缘分隔条的定位基准；折叠时列宽为 0，不渲染任何内容 */}
        <div className="desktop-shell__sidebar">
          {sidebarCollapsed ? null : (
            <>
              <DesktopSidebar
                activeConversationId={props.controller.activeConversation?.id}
                conversations={props.conversations}
                copy={props.copy}
                locale={props.controller.locale}
                onClearData={props.onClearData}
                onCompress={handleCompress}
                onArchiveConversation={props.onArchive}
                onDeleteConversation={props.onDelete}
                onLocale={props.onLocale}
                onNewChat={props.onNewChat}
                onOpenSettings={handleOpenSettings}
                onRenameConversation={props.onRename}
                onSelectConversation={props.controller.selectConversation}
                onSelectRightTab={(tab) => { handleSelectRightTab(tab); setRightPaneOpen(tab !== "none"); }}
                onSignOut={props.onSignOut}
                onToggleTheme={handleToggleTheme}
                resolvedTheme={resolved}
                runningConversations={props.controller.runningConversations}
                showToast={props.showToast}
              />
              {/* 侧栏右缘分隔条 */}
              <DragHandle
                onDrag={handleSidebarDrag}
                onDragEnd={handleSidebarDragEnd}
                onDragStart={handleDragStart}
                position="left"
              />
            </>
          )}
        </div>

        {/* 中列：对话/编辑器双视图 */}
        <div className="desktop-shell__center" data-center-view={centerView}>
          <div className="desktop-shell__chat">
            <OpenReviewContext.Provider value={handleOpenRightReview}>
              <DesktopChatArea
                {...props}
                onOpenSettings={handleOpenSettings}
                onRenameConversation={props.onRename}
                onToggleRightPane={toggleRightPane}
                rightPaneOpen={rightPaneOpen}
                resolvedTheme={resolved}
              />
            </OpenReviewContext.Provider>
          </div>

          {editorMounted ? (
            <Suspense fallback={<div className="desktop-shell__center-loading" />}>
              <EditorView
                workspace={editorWorkspace}
                copy={props.copy}
                resolvedTheme={resolved}
                hidden={centerView !== "editor"}
                onOpenReview={handleOpenRightReview}
              />
            </Suspense>
          ) : null}
        </div>

        {/* 右列：成果审阅与工件预览面板（Codex 风格差异审阅、工件画廊、工作区终端） */}
        {rightPaneOpen ? (
          <div className="desktop-shell__details">
            <DragHandle
              disabled={false}
              onDrag={handleRightPaneDrag}
              onDragEnd={handleRightPaneDragEnd}
              onDragStart={handleDragStart}
              position="right"
            />
            <DesktopRightPane
              activeTab={rightPaneTab}
              editorWorkspace={editorWorkspace}
              onClose={() => {
                setRightPaneOpen(false);
                try {
                  localStorage.setItem(STORAGE_RIGHT_PANE_OPEN, "false");
                } catch {
                  /* 隐私模式下 localStorage 不可用 */
                }
              }}
              onCheckpointRestored={() => { editorWorkspace.resetTabs(); }}
              onOpenFile={(path) => {
                void editorWorkspace.openFile(path);
                switchCenterView("editor");
              }}
              onOpenReview={() => handleSelectRightTab("review")}
              onOpenSettings={handleOpenSettings}
              onSelectTab={handleSelectRightTab}
              resolvedTheme={resolved}
              shared={props}
            />
          </div>
        ) : null}
      </div>

      {paletteOpen ? <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} /> : null}
      {/* 现代化双栏设置中心 Modal */}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsModal
            open
            initialTab={settingsTab}
            onClose={() => setSettingsOpen(false)}
            onCompress={handleCompress}
            onToggleTheme={handleToggleTheme}
            darkGlass={glass}
            onToggleDarkGlass={handleToggleGlass}
            resolvedTheme={resolved}
            shared={props}
          />
        </Suspense>
      ) : null}

      {pluginSettings.whaleWidget.enabled ? (
        <WhaleWidget
          entries={props.llmEntries}
          activeProvider={props.llmActiveProvider}
          phase={props.controller.phase}
          messages={props.controller.messages}
          conversationTitle={props.controller.activeConversation?.title}
          pendingPermissionId={props.controller.pendingPermission?.requestId}
        />
      ) : null}

      {/* shell 级浮层层：全局弹层 / toast 的挂载槽位，默认不拦截交互 */}
      <div className="desktop-shell__overlay" />

    </div>
  );
}
