import { useCallback, useEffect, useRef, useState } from "react";
import DragHandle from "../../components/DragHandle";
import { useTheme } from "../../app/use-theme";
import type { SharedViewProps } from "../layout-types";
import { DesktopChatArea } from "./DesktopChatArea";
import { DesktopRightPane } from "./DesktopRightPane";
import { DesktopSidebar, type DesktopRightTab } from "./DesktopSidebar";
import { SettingsModal, type SettingsTabKey } from "../../components/settings/SettingsModal";

/* ── 列宽约束与持久化 Key ─────────────────────────────── */

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 260;
/** 折叠态 rail 宽度（仅图标列） */
const SIDEBAR_COLLAPSED = 64;

const DETAILS_MIN = 280;
const DETAILS_MAX = 520;
const DETAILS_DEFAULT = 360;

/** 视口窄于该宽度时侧栏在显示层强制折叠为 rail（不改写用户偏好与持久化宽度） */
const NARROW_VIEWPORT = 900;

const STORAGE_SIDEBAR_WIDTH = "yachiyo-sidebar-width";
const STORAGE_DETAILS_WIDTH = "yachiyo-details-width";

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
  const [activeRightTab, setActiveRightTab] = useState<DesktopRightTab>("none");
  /** 用户手动折叠偏好：窄视口的强制折叠只作用于显示层，不写入该状态 */
  const [userSidebarCollapsed, setUserSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>("general");
  const { resolved, setTheme } = useTheme();

  // 列宽状态：初始化从 localStorage 恢复
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clamp(readStoredWidth(STORAGE_SIDEBAR_WIDTH, SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX),
  );
  const [detailsWidth, setDetailsWidth] = useState(() =>
    clamp(readStoredWidth(STORAGE_DETAILS_WIDTH, DETAILS_DEFAULT), DETAILS_MIN, DETAILS_MAX),
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

  // 桌面端全局快捷键支持 (Ctrl/Cmd+N 新建, Ctrl/Cmd+B 开关工作区, Ctrl/Cmd+[ 折叠侧边栏, Ctrl/Cmd+, 打开设置, Esc 关闭侧面板/设置)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;

      if (isModifier && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        void props.onNewChat();
        return;
      }

      if (isModifier && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setActiveRightTab((current) => (current === "workspace" ? "none" : "workspace"));
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
        if (activeRightTab !== "none") {
          e.preventDefault();
          setActiveRightTab("none");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeRightTab, handleOpenSettings, props, settingsOpen]);

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

  const handleDetailsDrag = useCallback((dx: number) => {
    // 右侧面板的分隔条在左侧，拖拽向左 = 面板变宽，所以取反
    setDetailsWidth((w) => clamp(w - dx, DETAILS_MIN, DETAILS_MAX));
  }, []);

  const handleDetailsDragEnd = useCallback(() => {
    setDragging(false);
    setDetailsWidth((w) => {
      writeStoredWidth(STORAGE_DETAILS_WIDTH, w);
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

  const hasRightPane = activeRightTab !== "none";
  const effectiveSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED : sidebarWidth;

  const gridColumns = hasRightPane
    ? `${effectiveSidebarWidth}px minmax(0, 1fr) ${detailsWidth}px`
    : `${effectiveSidebarWidth}px minmax(0, 1fr)`;

  return (
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
          activeRightTab={activeRightTab}
          collapsed={sidebarCollapsed}
          conversations={props.conversations}
          copy={props.copy}
          llmActiveProvider={props.llmActiveProvider}
          llmEntries={props.llmEntries}
          locale={props.controller.locale}
          onClearData={props.onClearData}
          onCompress={handleCompress}
          onDeleteConversation={props.onDelete}
          onLocale={props.onLocale}
          onNewChat={props.onNewChat}
          onOpenSettings={handleOpenSettings}
          onRenameConversation={props.onRename}
          onSelectConversation={props.controller.selectConversation}
          onSelectRightTab={setActiveRightTab}
          onSignOut={props.onSignOut}
          onToggleCollapse={() => setUserSidebarCollapsed((current) => !current)}
          onToggleTheme={handleToggleTheme}
          resolvedTheme={resolved}
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

      {/* 中列：核心对话流与输入区 */}
      <div className="desktop-shell__center">
        <DesktopChatArea
          {...props}
          activeRightTab={activeRightTab}
          onOpenSettings={handleOpenSettings}
          onRenameConversation={props.onRename}
          onSelectRightTab={setActiveRightTab}
          onToggleSidebar={() => setUserSidebarCollapsed((current) => !current)}
          onToggleWorkspace={() =>
            setActiveRightTab((current) => (current === "workspace" ? "none" : "workspace"))
          }
          resolvedTheme={resolved}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>

      {/* 右列：工作区与内联配置面板，列容器同时充当左缘分隔条的定位基准 */}
      {hasRightPane ? (
        <div className="desktop-shell__details">
          {/* 右面板左缘分隔条 */}
          <DragHandle
            onDrag={handleDetailsDrag}
            onDragEnd={handleDetailsDragEnd}
            onDragStart={handleDragStart}
            position="right"
          />
          <DesktopRightPane
            activeTab={activeRightTab}
            onClose={() => setActiveRightTab("none")}
            onCompress={handleCompress}
            onSelectTab={setActiveRightTab}
            onToggleTheme={handleToggleTheme}
            resolvedTheme={resolved}
            shared={props}
          />
        </div>
      ) : null}

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
    </div>
  );
}
