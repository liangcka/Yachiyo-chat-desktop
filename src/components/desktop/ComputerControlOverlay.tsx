import { MonitorDot, Square } from "lucide-react";
import { useEffect, useMemo } from "react";
import { formatComputerControlAction } from "../../services/mcp-manager";

export interface ComputerControlOverlayProps {
  /** 是否处于控制电脑状态 */
  active: boolean;
  /** 当前正在调用的工具名 */
  toolName?: string;
  /** 当前工具调用参数 */
  toolArgs?: Record<string, unknown>;
  /** 软件名称，默认为月见八千代 */
  softwareName?: string;
  /** 紧急接管 / 停止回调 */
  onStop: () => void;
}

export function ComputerControlOverlay({
  active,
  toolName = "",
  toolArgs,
  softwareName = "月见八千代",
  onStop,
}: ComputerControlOverlayProps) {
  // 全局 Esc 键快速紧急接管
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onStop();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [active, onStop]);

  const actionText = useMemo(() => {
    if (!toolName) return "正在执行自动化任务...";
    return formatComputerControlAction(toolName, toolArgs);
  }, [toolName, toolArgs]);

  if (!active) return null;

  return (
    <div
      className="computer-control-overlay"
      role="alert"
      aria-live="assertive"
      aria-label={`${softwareName} 正在控制你的电脑`}
    >
      {/* 1. 四周周边呼吸发光环 (类似 Codex 控制电脑光晕) */}
      <div className="computer-control-overlay__rim" aria-hidden="true">
        <div className="computer-control-overlay__corner computer-control-overlay__corner--tl" />
        <div className="computer-control-overlay__corner computer-control-overlay__corner--tr" />
        <div className="computer-control-overlay__corner computer-control-overlay__corner--bl" />
        <div className="computer-control-overlay__corner computer-control-overlay__corner--br" />
      </div>

      {/* 2. 屏幕上方悬浮弹出的控制状态窗口 */}
      <div className="computer-control-overlay__banner">
        <div className="computer-control-overlay__badge">
          <span className="computer-control-overlay__pulse-dot" aria-hidden="true" />
          <MonitorDot size={18} className="computer-control-overlay__icon" aria-hidden="true" />
        </div>

        <div className="computer-control-overlay__info">
          <div className="computer-control-overlay__title">
            <span className="computer-control-overlay__software">{softwareName}</span>
            <span className="computer-control-overlay__status-text">正在控制你的电脑</span>
          </div>
          <div className="computer-control-overlay__desc" title={actionText}>
            {actionText}
          </div>
        </div>

        <button
          type="button"
          className="computer-control-overlay__takeover-btn"
          onClick={onStop}
          title="按下 Esc 键或点击立即接管控制"
          aria-label="立即接管电脑控制"
        >
          <Square size={13} fill="currentColor" />
          <span>立即接管 (Esc)</span>
        </button>
      </div>
    </div>
  );
}
