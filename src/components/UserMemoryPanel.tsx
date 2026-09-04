import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import type { UiCopy } from "../i18n/messages";

export interface UserMemoryPanelProps {
  copy: UiCopy;
  /** 当前长期记忆内容（跨会话共享） */
  memory: string;
  open: boolean;
  onClose: () => void;
  /** 保存编辑后的长期记忆；失败时返回 false 以便上层提示 */
  onSave: (memory: string) => Promise<boolean>;
  /** 是否以嵌入模式渲染（不带全屏遮罩与外层弹窗容器，无缝融入设置中心/侧栏） */
  embedded?: boolean;
}

/** 长期记忆管理面板：查看 / 编辑 / 清除跨会话的用户记忆 */
export function UserMemoryPanel({
  copy,
  memory,
  open,
  onClose,
  onSave,
  embedded = false,
}: UserMemoryPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(memory);
  // 外部记忆更新时（如压缩提炼），在渲染期间同步草稿，避免 effect 级联渲染
  const [prevMemory, setPrevMemory] = useState(memory);
  if (memory !== prevMemory) {
    setPrevMemory(memory);
    setDraft(memory);
  }

  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (open && !embedded) closeRef.current?.focus();
  }, [open, embedded]);

  if (!render) return null;

  const innerEditor = (
    <div className={`memory-panel-content ${embedded ? "memory-panel-content--embedded" : ""}`}>
      {!embedded && (
        <header className="skills-modal-card__header">
          <div className="skills-modal-card__title-wrap">
            <h3 className="skills-modal-card__title">{copy.userMemoryTitle}</h3>
            <p className="skills-modal-card__hint">{copy.userMemoryDescription}</p>
          </div>
          <button
            ref={closeRef}
            aria-label={copy.closeMenu}
            className="skills-modal-card__close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
      )}

      {embedded && <p className="skills-panel__hint">{copy.userMemoryDescription}</p>}

      <textarea
        aria-label={copy.userMemoryTitle}
        className="memory-panel__editor"
        onChange={(event) => setDraft(event.target.value)}
        placeholder={copy.userMemoryPlaceholder}
        rows={6}
        value={draft}
      />

      <div className="memory-panel__actions">
        <button
          className="settings-btn settings-btn--primary"
          onClick={() => {
            void onSave(draft);
          }}
          type="button"
        >
          {copy.userMemorySave}
        </button>
        <button
          className="settings-btn settings-btn--ghost danger-action"
          disabled={draft.trim().length === 0}
          onClick={() => setDraft("")}
          type="button"
        >
          {copy.userMemoryClear}
        </button>
      </div>
    </div>
  );

  if (embedded) {
    return innerEditor;
  }

  return (
    <div
      className={`model-modal-overlay memory-modal-overlay ${closing ? "model-modal-overlay--closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={copy.userMemoryTitle}
    >
      <button
        type="button"
        tabIndex={-1}
        className="model-modal-backdrop"
        onClick={onClose}
        aria-label={copy.closeMenu}
      />
      <div className="model-modal-card memory-modal-card">
        {innerEditor}
      </div>
    </div>
  );
}
