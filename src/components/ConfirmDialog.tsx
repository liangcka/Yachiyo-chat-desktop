import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./ConfirmDialog.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** 破坏性操作：确认按钮用警示色，默认焦点落在取消上，误按回车不会直接执行 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 应用内确认弹窗。替代 window.confirm：原生弹窗在桌面端标题固定为「tauri.localhost 显示」，
 * 样式与应用割裂，且会阻塞整个页面的事件循环（包括后台对话的流式渲染）。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) (danger ? cancelRef : confirmRef).current?.focus();
  }, [danger, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  return createPortal(
    <div className="confirm-dialog-overlay">
      <button
        type="button"
        className="confirm-dialog-backdrop"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCancel}
      />
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(message !== undefined ? { "aria-describedby": messageId } : {})}
      >
        <h2 className="confirm-dialog__title" id={titleId}>
          {title}
        </h2>
        {message !== undefined ? (
          <p className="confirm-dialog__message" id={messageId}>
            {message}
          </p>
        ) : null}
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} type="button" className="confirm-dialog__button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-dialog__button confirm-dialog__button--primary${
              danger ? " confirm-dialog__button--danger" : ""
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
