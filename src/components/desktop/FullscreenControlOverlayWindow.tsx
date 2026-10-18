import { MonitorDot, Square } from "lucide-react";
import { LOCALE_MIRROR_KEY } from "../../i18n/locale-context";
import { useEffect, useState, useCallback } from "react";
import { setOverlayIgnoreCursor, stopActiveControl } from "../../services/desktop-bridge";
import "../../styles/fullscreen-control-overlay.css";

interface ControlPayload {
  active: boolean;
  toolName?: string;
  detail?: string;
}

/** 遮罩是独立 webview，拿不到主窗口的 React 状态；主窗口把界面语言镜像到同源 localStorage */
function readMirroredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_MIRROR_KEY);
  } catch {
    return null;
  }
}

export function FullscreenControlOverlayWindow() {
  const [controlState, setControlState] = useState<ControlPayload>({
    active: false,
    toolName: "",
    detail: "",
  });

  // 设置透明窗口根样式
  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    document.body.classList.add("overlay-window");
    return () => {
      document.documentElement.classList.remove("overlay-window");
      document.body.classList.remove("overlay-window");
    };
  }, []);

  // 监听来自主窗口与 Tauri 后端的控制状态同步
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isSubscribed = true;

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (!isSubscribed) return;
        unlisten = await listen<ControlPayload>("control_state_change", (event) => {
          if (!isSubscribed) return;
          setControlState(event.payload);
        });
      } catch {
        /* 非桌面端环境降级 */
      }
    }

    void subscribe();

    return () => {
      isSubscribed = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleTakeover = useCallback(async () => {
    setControlState((s) => ({ ...s, active: false }));
    await stopActiveControl();
  }, []);

  // 全局 Esc 快捷键立即接管
  useEffect(() => {
    if (!controlState.active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void handleTakeover();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [controlState.active, handleTakeover]);

  // 当鼠标悬停在顶部胶囊控制横幅时，临时解除穿透以允许点击；移开后立即恢复穿透
  const handleMouseEnterBanner = useCallback(() => {
    void setOverlayIgnoreCursor(false);
  }, []);

  const handleMouseLeaveBanner = useCallback(() => {
    void setOverlayIgnoreCursor(true);
  }, []);

  if (!controlState.active) {
    return null;
  }

  const ja = readMirroredLocale() === "ja-JP";
  const detailText =
    controlState.detail?.trim() || (ja ? "デスクトップの自動操作を実行中…" : "正在执行自动化桌面控制任务...");

  return (
    <div
      className="fullscreen-control-window"
      role="alert"
      aria-live="assertive"
      aria-label={ja ? "月見八千代が PC を操作しています" : "月见八千代 正在控制你的电脑"}
    >
      {/* 1. 四周全屏幕物理边缘激光流动环 (类似 Codex 全屏控制视界) */}
      <div className="fullscreen-control-window__glow-rim" aria-hidden="true">
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--tl" />
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--tr" />
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--bl" />
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--br" />
      </div>

      {/* 2. 屏幕正上方毛玻璃控制悬浮胶囊 */}
      <div
        className="fullscreen-control-window__banner"
        onMouseEnter={handleMouseEnterBanner}
        onMouseLeave={handleMouseLeaveBanner}
      >
        <div className="fullscreen-control-window__badge">
          <span className="fullscreen-control-window__pulse-dot" aria-hidden="true" />
          <MonitorDot size={18} aria-hidden="true" />
        </div>

        <div className="fullscreen-control-window__info">
          <div className="fullscreen-control-window__title">
            <span className="fullscreen-control-window__software">{ja ? "月見八千代" : "月见八千代"}</span>
            <span className="fullscreen-control-window__status-text">{ja ? "が PC を操作しています" : "正在控制你的电脑"}</span>
          </div>
          <div className="fullscreen-control-window__desc" title={detailText}>
            {detailText}
          </div>
        </div>

        <button
          type="button"
          className="fullscreen-control-window__takeover-btn"
          onClick={() => void handleTakeover()}
          title={ja ? "クリックまたは Esc キーで PC の操作を取り戻す" : "点击或按 Esc 键立即接管电脑控制"}
          aria-label={ja ? "PC の操作をすぐに取り戻す" : "立即接管电脑控制"}
        >
          <Square size={13} fill="currentColor" />
          <span>{ja ? "操作を取り戻す (Esc)" : "立即接管 (Esc)"}</span>
        </button>
      </div>
    </div>
  );
}
