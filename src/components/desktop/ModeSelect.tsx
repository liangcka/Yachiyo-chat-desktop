import { Bot, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n/locale-context";

export type ExecutionMode = "readonly" | "confirm" | "full_auto";

export interface ModeSelectProps {
  mode: ExecutionMode;
  onSelect: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

const MODES: readonly ExecutionMode[] = ["readonly", "confirm", "full_auto"];

function modeLabel(mode: ExecutionMode, ja: boolean): string {
  if (mode === "readonly") return ja ? "読み取り" : "只读";
  if (mode === "confirm") return ja ? "自動" : "自动";
  return ja ? "完全アクセス" : "完全访问";
}

export function ModeSelect({ mode, onSelect, disabled = false }: ModeSelectProps) {
  const ja = useLocale() === "ja-JP";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const title = `${ja ? "実行モード" : "执行模式"}：${modeLabel(mode, ja)}`;

  return (
    <div ref={rootRef} className="desktop-mode-select-root">
      <button
        type="button"
        className={`desktop-mode-select desktop-header-pill desktop-mode-select--${mode}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-label={ja ? "実行モード" : "执行模式"}
        title={title}
      >
        <Bot size={13} />
        <span>{modeLabel(mode, ja)}</span>
      </button>

      {open && !disabled && (
        <div className="dsh-model-select__menu desktop-mode-select__menu" role="listbox">
          {MODES.map((item) => {
            const isSelected = item === mode;
            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`dsh-model-select__option ${isSelected ? "dsh-model-select__option--selected" : ""}`}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <span className="dsh-model-select__option-name">{modeLabel(item, ja)}</span>
                {isSelected ? <Check size={14} className="dsh-model-select__check" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
