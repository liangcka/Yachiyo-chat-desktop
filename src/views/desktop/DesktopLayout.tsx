import { useCallback, useEffect, useRef, useState } from "react";
import DragHandle from "../../components/DragHandle";
import { useTheme } from "../../app/use-theme";
import { useEditorWorkspace } from "../../app/use-editor-workspace";
import { EditorView } from "../../components/editor/EditorView";
import { Live2DWaifu } from "../../components/desktop/Live2DWaifu";
import type { SharedViewProps } from "../layout-types";
import { DesktopChatArea } from "./DesktopChatArea";
import { DesktopSidebar } from "./sidebar";
import { DesktopTopBar } from "./DesktopTopBar";
import { SettingsModal, type SettingsTabKey } from "../../components/settings/SettingsModal";

/* ── 列宽约束与持久化 Key ─────────────────────────────── */

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 260;
/** 折叠态 rail 宽度（仅图标列） */
const SIDEBAR_COLLAPSED = 64;

/** 视口窄于该宽度时侧栏在显示层强制折叠为 rail（不改写用户偏好与持久化宽度） */
const NARROW_VIEWPORT = 900;

const STORAGE_SIDEBAR_WIDTH = "yachiyo-sidebar-width";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>("general");
  const { resolved, setTheme } = useTheme();

  // 中栏视图切换（对话 ↔ 编辑器）：editor 一旦挂载即常驻（隐藏不卸载），保留 Monaco 实例与 model
  const [centerView, setCenterView] = useState<CenterView>(readStoredCenterView);
  const [editorMounted, setEditorMounted] = useState(() => readStoredCenterView() === "editor");
  const [reviewActive, setReviewActive] = useState(false);
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

  // 桌面端全局快捷键支持 (Ctrl/Cmd+N 新建, Ctrl/Cmd+1/2 切换视图, Ctrl/Cmd+[ 折叠侧边栏, Ctrl/Cmd+, 打开设置, Esc 关闭设置)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;

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
  }, [handleOpenSettings, props, settingsOpen, switchCenterView]);

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

  /* ── 渲染 ─────────────────────────────────────────── */

  const effectiveSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED : sidebarWidth;
  const gridColumns = `${effectiveSidebarWidth}px minmax(0, 1fr)`;

  return (
    <div className="desktop-shell-root">
      {/* 统一沉浸式桌面顶栏：融合窗口控制、应用品牌与视图控制器 */}
      <DesktopTopBar
        activeView={centerView}
        copy={props.copy}
        onNewChat={props.onNewChat}
        onSwitchView={switchCenterView}
        onToggleSidebar={() => setUserSidebarCollapsed((current) => !current)}
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
            <DesktopChatArea
              {...props}
              onOpenSettings={handleOpenSettings}
            onRenameConversation={props.onRename}
            onToggleSidebar={() => setUserSidebarCollapsed((current) => !current)}
            resolvedTheme={resolved}
            sidebarCollapsed={sidebarCollapsed}
          />
        </div>

        {editorMounted ? (
          <EditorView
            workspace={editorWorkspace}
            copy={props.copy}
            resolvedTheme={resolved}
            hidden={centerView !== "editor"}
            reviewActive={reviewActive}
            onReviewActiveChange={setReviewActive}
          />
        ) : null}
      </div>

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

      {/* shell 级浮层层：全局弹层 / toast 的挂载槽位，默认不拦截交互 */}
      <div className="desktop-shell__overlay" />

      {/* Live2D 看板娘：视口右下角悬浮挂件（自建 #waifu DOM，经 CSS 层叠覆盖置于 IDE 内容之上） */}
      <Live2DWaifu />
    </div>
  </div>
  );
}
