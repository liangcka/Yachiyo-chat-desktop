import React, { useCallback, useEffect, useRef } from "react";
import { useLocale } from "../i18n/locale-context";

interface DragHandleProps {
  position: "left" | "right";
  onDrag: (dx: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  disabled?: boolean;
}

/** 指针捕获保证越过面板边界后仍可拖动；每帧合并位移，并在松开时提交最后一段。 */
const DragHandle = React.memo(function DragHandle({
  position,
  onDrag,
  onDragStart,
  onDragEnd,
  disabled = false,
}: DragHandleProps) {
  const ja = useLocale() === "ja-JP";
  const baseXRef = useRef(0);
  const latestXRef = useRef(0);
  const rafIdRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    pointerIdRef.current = null;
  }, []);

  const flushDrag = useCallback(() => {
    const dx = latestXRef.current - baseXRef.current;
    baseXRef.current = latestXRef.current;
    if (dx !== 0) onDrag(dx);
  }, [onDrag]);

  const finishDrag = useCallback((element: HTMLDivElement) => {
    const pointerId = pointerIdRef.current;
    if (pointerId === null) return;
    pointerIdRef.current = null;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    flushDrag();
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    delete element.dataset.active;
    onDragEnd?.();
  }, [flushDrag, onDragEnd]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || pointerIdRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    baseXRef.current = event.clientX;
    latestXRef.current = event.clientX;
    event.currentTarget.dataset.active = "";
    onDragStart?.();
  }, [disabled, onDragStart]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    latestXRef.current = event.clientX;
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = 0;
        if (pointerIdRef.current !== null) flushDrag();
      });
    }
  }, [flushDrag]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    latestXRef.current = event.clientX;
    finishDrag(event.currentTarget);
  }, [finishDrag]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId === pointerIdRef.current) finishDrag(event.currentTarget);
  }, [finishDrag]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const dx = event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0;
    if (dx === 0) return;
    event.preventDefault();
    onDragStart?.();
    onDrag(dx);
    onDragEnd?.();
  }, [disabled, onDrag, onDragStart, onDragEnd]);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={handleRef}
      className={`drag-handle drag-handle--${position}`}
      role="separator"
      aria-label={
        position === "left"
          ? ja ? "サイドバーの幅を調整" : "调整侧栏宽度"
          : ja ? "パネルの幅を調整" : "调整审阅面板宽度"
      }
      aria-orientation="vertical"
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onKeyDown={handleKeyDown}
      style={disabled ? { pointerEvents: "none" } : undefined}
    >
      {!disabled && <div className="drag-handle__pill" />}
    </div>
  );
});

export default DragHandle;
