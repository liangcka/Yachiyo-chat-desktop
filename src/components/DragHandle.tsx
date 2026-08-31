import React, { useCallback, useRef } from "react";

interface DragHandleProps {
  position: "left" | "right";
  onDrag: (dx: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  disabled?: boolean;
}

/**
 * 可拖拽分隔条 —— 用于调整左右面板宽度。
 *
 * 使用 Pointer Capture 保证拖拽期间即使光标移出元素也能持续接收事件，
 * 通过 rAF 节流避免高频 pointermove 导致的布局抖动。
 */
const DragHandle = React.memo(function DragHandle({
  position,
  onDrag,
  onDragStart,
  onDragEnd,
  disabled = false,
}: DragHandleProps) {
  // 拖拽基准 X 坐标，每次 move 后更新为最新位置以计算增量
  const baseXRef = useRef(0);
  // rAF ID，用于节流和组件卸载 / pointerup 时取消待执行帧
  const rafIdRef = useRef(0);
  // 标记当前是否处于拖拽状态，避免 pointerup 后残余的 rAF 回调仍调用 onDrag
  const draggingRef = useRef(false);
  // 分隔条 DOM 引用
  const handleRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;

      // 仅响应主按键（鼠标左键 / 触屏主手指）
      if (e.button !== 0) return;

      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      baseXRef.current = e.clientX;
      draggingRef.current = true;
      el.dataset.active = "";

      onDragStart?.();
    },
    [disabled, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;

      const clientX = e.clientX;

      // 取消上一帧尚未执行的回调，保证每帧最多触发一次 onDrag
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        if (!draggingRef.current) return;

        const dx = clientX - baseXRef.current;
        if (dx !== 0) {
          baseXRef.current = clientX;
          onDrag(dx);
        }
      });
    },
    [onDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;

      draggingRef.current = false;

      // 清除可能残留的 rAF 回调
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }

      const el = e.currentTarget;
      el.releasePointerCapture(e.pointerId);
      delete el.dataset.active;

      onDragEnd?.();
    },
    [onDragEnd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      const STEP = 10;
      let dx = 0;

      if (e.key === "ArrowLeft") {
        dx = -STEP;
      } else if (e.key === "ArrowRight") {
        dx = STEP;
      }

      if (dx !== 0) {
        e.preventDefault();
        onDrag(dx);
      }
    },
    [disabled, onDrag],
  );

  return (
    // ARIA: focusable separator 是合法的交互模式（用于调节面板大小）
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={handleRef}
      className={`drag-handle drag-handle--${position}`}
      role="separator"
      aria-orientation="vertical"
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      style={disabled ? { pointerEvents: "none" } : undefined}
    >
      {!disabled && <div className="drag-handle__pill" />}
    </div>
  );
});

export default DragHandle;
