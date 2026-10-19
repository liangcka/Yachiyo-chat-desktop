import { useEffect, useRef, useState } from "react";
import { LOCALE_MIRROR_KEY } from "../../i18n/locale-context";
import {
  getControlOverlayState,
  onControlOverlayStateChange,
  onOverlayCursorMove,
  type ControlOverlayState,
} from "../../services/desktop-bridge";
import "../../styles/fullscreen-control-overlay.css";

const INACTIVE: ControlOverlayState = { active: false, paused: false };

/** 遮罩是独立 webview，拿不到主窗口的 React 状态；主窗口把界面语言镜像到同源 localStorage */
function readMirroredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_MIRROR_KEY);
  } catch {
    return null;
  }
}

/**
 * 系统级全屏电脑控制遮罩：细边框 + 顶部单行状态条 + 八千代光标。
 * 遮罩全程鼠标穿透、拿不到焦点，Esc 取消由后端轮询物理按键完成
 */
export function ControlOverlayWindow() {
  const [state, setState] = useState<ControlOverlayState>(INACTIVE);
  const cursorRef = useRef<HTMLDivElement>(null);

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

  // 系统光标被隐藏期间，八千代光标跟随后端推送的真实位置（物理像素→CSS 像素），直接改样式不触发重渲染
  useEffect(() => {
    if (!state.active) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onOverlayCursorMove((position) => {
      const cursor = cursorRef.current;
      if (disposed || cursor === null) return;
      const scale = window.devicePixelRatio || 1;
      cursor.style.transform = `translate(${position.x / scale}px, ${position.y / scale}px)`;
      cursor.style.opacity = "1";
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [state.active]);

  if (!state.active) return null;

  const ja = readMirroredLocale() === "ja-JP";
  const statusText = ja ? "月見八千代が PC を操作しています" : "八千代正在控制你的电脑";
  const hintText = ja ? "Esc で操作をキャンセル" : "按 Esc 取消控制";

  return (
    <div className="fullscreen-control-window" role="alert" aria-live="assertive">
      <div className="fullscreen-control-window__frame" aria-hidden="true" />

      {/* 等待审批时系统光标已交还彩叶，不再绘制八千代光标；初始透明，收到首个坐标后显示 */}
      {!state.paused && (
        <div ref={cursorRef} className="fullscreen-control-window__cursor" style={{ opacity: 0 }} aria-hidden="true">
          <svg width="18" height="24" viewBox="0 0 18 24">
            <path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.7 L9 13.3 L15.5 13.3 Z" />
          </svg>
        </div>
      )}

      <div className="fullscreen-control-window__banner">
        <span>{statusText}</span>
        <span className="fullscreen-control-window__hint">{hintText}</span>
      </div>
    </div>
  );
}
