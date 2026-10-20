import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "../../domain/chat";
import { hideControlOverlay, onEmergencyStopControl, showControlOverlay } from "../../services/desktop-bridge";
import { deriveControlSession, type ComputerControlSession } from "./control-tools";

export interface ComputerControlSessionSource {
  readonly messages: readonly ChatMessage[];
  readonly streaming?: unknown;
  readonly phase: string;
  readonly pendingPermission?: unknown;
  readonly stop: () => Promise<unknown> | void;
}

/**
 * 主窗口侧的电脑控制会话：按消息流推导是否正在控制电脑，驱动系统级遮罩，
 * 并响应后端的全局 Esc 取消与主窗口内的 Esc；返回当前会话供界面展示
 */
export function useComputerControlSession(source: ComputerControlSessionSource): ComputerControlSession | null {
  const running = source.streaming !== undefined || source.phase === "streaming";
  const awaitingPermission = source.pendingPermission !== undefined && source.pendingPermission !== null;
  const session = useMemo(
    () => deriveControlSession({ messages: source.messages, running, awaitingPermission }),
    [source.messages, running, awaitingPermission],
  );
  const active = session !== null;
  const paused = session?.paused ?? false;

  // 流式期间消息每次增量都会变化，只在会话开关或暂停状态变化时同步遮罩
  useEffect(() => {
    if (active) {
      void showControlOverlay(paused);
    } else {
      void hideControlOverlay();
    }
  }, [active, paused]);

  useEffect(() => () => void hideControlOverlay(), []);

  const stopRef = useRef(source.stop);
  useEffect(() => {
    stopRef.current = source.stop;
  }, [source.stop]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onEmergencyStopControl(() => void stopRef.current()).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void stopRef.current();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [active]);

  return session;
}
