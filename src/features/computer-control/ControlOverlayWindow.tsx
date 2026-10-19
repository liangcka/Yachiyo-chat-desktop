import { MonitorDot, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOCALE_MIRROR_KEY } from "../../i18n/locale-context";
import {
  getControlOverlayState,
  onControlOverlayStateChange,
  setOverlayHitRegion,
  stopActiveControl,
  type ControlOverlayState,
} from "../../services/desktop-bridge";
import "../../styles/fullscreen-control-overlay.css";

const INACTIVE: ControlOverlayState = { active: false, toolName: "", detail: "" };

/** 遮罩是独立 webview，拿不到主窗口的 React 状态；主窗口把界面语言镜像到同源 localStorage */
function readMirroredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_MIRROR_KEY);
  } catch {
    return null;
  }
}

/** 系统级全屏电脑控制遮罩窗口：四周发光边框 + 顶部接管横幅 */
export function ControlOverlayWindow() {
  const [state, setState] = useState<ControlOverlayState>(INACTIVE);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    document.body.classList.add("overlay-window");
    return () => {
      document.documentElement.classList.remove("overlay-window");
      document.body.classList.remove("overlay-window");
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let pushed = false;
    let unlisten: (() => void) | undefined;
    void onControlOverlayStateChange((next) => {
      pushed = true;
      if (!disposed) setState(next);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    // 补上订阅建立前的状态；拉取结果晚于推送到达时以推送为准
    void getControlOverlayState().then((current) => {
      if (!disposed && !pushed && current !== null) setState(current);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 遮罩处于鼠标穿透时收不到悬停事件，把横幅区域交给后端按全局光标位置切换穿透
  useEffect(() => {
    const banner = bannerRef.current;
    if (!state.active || banner === null) return;
    const report = () => {
      const rect = banner.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      void setOverlayHitRegion({
        x: rect.left * scale,
        y: rect.top * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      });
    };
    report();
    // 入场动画带位移，ResizeObserver 感知不到 transform，动画结束后按最终位置再报一次
    const observer = new ResizeObserver(report);
    observer.observe(banner);
    banner.addEventListener("animationend", report);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      banner.removeEventListener("animationend", report);
      window.removeEventListener("resize", report);
      void setOverlayHitRegion(null);
    };
  }, [state.active]);

  const takeOver = useCallback(() => {
    setState(INACTIVE);
    void stopActiveControl();
  }, []);

  // 点击横幅后遮罩获得焦点，此时 Esc 同样可以接管
  useEffect(() => {
    if (!state.active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      takeOver();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [state.active, takeOver]);

  if (!state.active) return null;

  const ja = readMirroredLocale() === "ja-JP";
  const softwareName = ja ? "月見八千代" : "月见八千代";
  const statusText = ja ? "が PC を操作しています" : "正在控制你的电脑";
  const detailText = state.detail.trim() || (ja ? "デスクトップの自動操作を実行中…" : "正在执行自动化桌面控制任务...");

  return (
    <div className="fullscreen-control-window" role="alert" aria-live="assertive" aria-label={`${softwareName} ${statusText}`}>
      <div className="fullscreen-control-window__glow-rim" aria-hidden="true">
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--tl" />
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--tr" />
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--bl" />
        <div className="fullscreen-control-window__corner fullscreen-control-window__corner--br" />
      </div>

      <div ref={bannerRef} className="fullscreen-control-window__banner">
        <div className="fullscreen-control-window__badge">
          <span className="fullscreen-control-window__pulse-dot" aria-hidden="true" />
          <MonitorDot size={18} aria-hidden="true" />
        </div>

        <div className="fullscreen-control-window__info">
          <div className="fullscreen-control-window__title">
            <span className="fullscreen-control-window__software">{softwareName}</span>
            <span className="fullscreen-control-window__status-text">{statusText}</span>
          </div>
          <div className="fullscreen-control-window__desc" title={detailText}>
            {detailText}
          </div>
        </div>

        <button
          type="button"
          className="fullscreen-control-window__takeover-btn"
          onClick={takeOver}
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
