import { CommandPalette, type PaletteCommand } from "../../components/desktop/CommandPalette";
import { ComputerControlOverlay } from "../../components/desktop/ComputerControlOverlay";
import { formatComputerControlAction, isComputerControlTool } from "../../services/mcp-manager";
import {
  showControlOverlay,
  hideControlOverlay,
  onEmergencyStopControl,
} from "../../services/desktop-bridge";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SettingsModal, type SettingsTabKey } from "../../components/settings/SettingsModal";

const EditorView = lazy(() =>
  import("../../components/editor/EditorView").then((m) => ({ default: m.EditorView })),
);

/* ── 列宽约束与持久化 Key ─────────────────────────────── */

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 260;
/** 折叠态 rail 宽度（仅图标列） */
const SIDEBAR_COLLAPSED = 64;

/** 视口窄于该宽度时侧栏在显示层强制折叠为 rail（不改写用户偏好与持久化宽度） */
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>("general");
  const { resolved, setTheme } = useTheme();

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
  const sidebarCollapsed = narrowViewport || userSidebarCollapsed;

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
        setUserSidebarCollapsed((current) => !current);
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
  }, [handleOpenSettings, props, settingsOpen, switchCenterView, toggleRightPane]);

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

  const paletteCommands: PaletteCommand[] = [
    ...props.conversations.map((conversation) => ({ id: `chat-${conversation.id}`, label: conversation.title, group: "对话", run: () => { void props.controller.selectConversation(conversation.id); switchCenterView("chat"); } })),
    ...props.llmEntries.map((entry) => ({ id: `model-${entry.provider}`, label: entry.model || entry.provider, group: "模型", run: () => { void props.onLlmActivate(entry.provider); } })),
    ...([ ["general", "常规"], ["models", "模型"], ["browser", "联网搜索"], ["custom", "技能"], ["shortcuts", "快捷键"] ] as const).map(([tab, label]) => ({ id: `settings-${tab}`, label, group: "设置", run: () => handleOpenSettings(tab) })),
  ];

  // 监测 AI 是否正在控制电脑（执行 Windows MCP / 系统控制工具）
  const activeControlStep = useMemo(() => {
    if (props.controller.pendingPermission) return null;
    const isStreaming = props.controller.streaming !== undefined || props.controller.phase === "streaming";
    if (!isStreaming) return null;
    const msgs = props.controller.messages;
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.toolSteps || lastMsg.toolSteps.length === 0) {
      return null;
    }
    const currentStep = lastMsg.toolSteps.find((s) => s.result === undefined);
    if (!currentStep) return null;
    if (isComputerControlTool(currentStep.name)) {
      let argsObj: Record<string, unknown> | undefined;
      try {
        argsObj = JSON.parse(currentStep.argumentsJson);
      } catch {
        /* ignore parse error */
      }
      return {
        name: currentStep.name,
        args: argsObj,
      };
    }
    return null;
  }, [props.controller.streaming, props.controller.phase, props.controller.messages, props.controller.pendingPermission]);

  // 监听来自系统级全屏 Overlay 或全局广播的紧急接管停止事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onEmergencyStopControl(() => {
      void props.controller.stop();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [props.controller]);

  // 当检测到当前步骤正在控制电脑时，触发系统级全屏置顶发光覆盖窗口 (类似 Codex 全屏接管)
  useEffect(() => {
    if (activeControlStep) {
      const detail = formatComputerControlAction(
        activeControlStep.name,
        activeControlStep.args,
      );
      void showControlOverlay(activeControlStep.name, detail);
    } else {
      void hideControlOverlay();
    }
    return () => {
      void hideControlOverlay();
    };
  }, [activeControlStep]);

  /* ── 渲染 ─────────────────────────────────────────── */

  const effectiveSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED : sidebarWidth;
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
        onRenameConversation={props.onRename}
        onSwitchView={switchCenterView}
        onToggleSidebar={() => setUserSidebarCollapsed((current) => !current)}
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
        {/* 左列：导航与历史侧栏，列容器同时充当右缘分隔条的定位基准 */}
        <div className="desktop-shell__sidebar">
          <DesktopSidebar
            activeConversationId={props.controller.activeConversation?.id}
            collapsed={sidebarCollapsed}
            hideBrandHeader={true}
            conversations={props.conversations}
            copy={props.copy}
            locale={props.controller.locale}
            onClearData={props.onClearData}
            onCompress={handleCompress}
            onDeleteConversation={props.onDelete}
            onLocale={props.onLocale}
            onNewChat={props.onNewChat}
            onOpenSettings={handleOpenSettings}
            onRenameConversation={props.onRename}
            onSelectConversation={props.controller.selectConversation}
            onSelectRightTab={(tab) => { handleSelectRightTab(tab); setRightPaneOpen(tab !== "none"); }}
            onSignOut={props.onSignOut}
            onToggleCollapse={() => setUserSidebarCollapsed((current) => !current)}
            onToggleTheme={handleToggleTheme}
            resolvedTheme={resolved}
            showToast={props.showToast}
          />
          {/* 侧栏右缘分隔条（折叠态禁用拖拽） */}
          <DragHandle
            disabled={sidebarCollapsed}
            onDrag={handleSidebarDrag}
            onDragEnd={handleSidebarDragEnd}
            onDragStart={handleDragStart}
            position="left"
          />
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
      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
        onCompress={handleCompress}
        onToggleTheme={handleToggleTheme}
        resolvedTheme={resolved}
        shared={props}
      />

      {/* AI 控制电脑时的全局发光边框与控制状态悬浮弹窗 (类似 Codex) */}
      <ComputerControlOverlay
        active={activeControlStep !== null}
        toolName={activeControlStep?.name}
        toolArgs={activeControlStep?.args}
        softwareName="月见八千代"
        onStop={() => void props.controller.stop()}
      />

      {/* shell 级浮层层：全局弹层 / toast 的挂载槽位，默认不拦截交互 */}
      <div className="desktop-shell__overlay" />

    </div>
  );
}
