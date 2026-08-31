import { Check, ChevronDown, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROVIDER_METADATA, type ProviderId } from "../../domain/llm";

export interface ModelSelectProps {
  activeProvider?: ProviderId;
  activeModel?: string;
  entries: readonly { provider: ProviderId; apiKey: string; model: string }[];
  onSelect: (provider: ProviderId) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
}

export function ModelSelect({
  activeProvider,
  activeModel,
  entries,
  onSelect,
  onOpenSettings,
  disabled = false,
}: ModelSelectProps) {
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

  const activeEntry = entries.find((e) => e.provider === activeProvider);
  const displayLabel = activeEntry
    ? `${PROVIDER_METADATA[activeEntry.provider].label} (${activeEntry.model || activeModel})`
    : activeProvider
      ? PROVIDER_METADATA[activeProvider].label
      : "选择模型 (Default)";

  return (
    <div ref={rootRef} className="dsh-model-select">
      <button
        type="button"
        className="dsh-model-select__trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={displayLabel}
      >
        <span className="dsh-model-select__label">{displayLabel}</span>
        <ChevronDown size={12} className={`dsh-model-select__chevron ${open ? "dsh-model-select__chevron--open" : ""}`} />
      </button>

      {open && (
        <div className="dsh-model-select__menu" role="listbox">
          <div className="dsh-model-select__header">
            <span className="dsh-model-select__header-title">已配置模型</span>
          </div>

          <div className="dsh-model-select__list">
            {entries.length === 0 ? (
              <div className="dsh-model-select__empty">
                <span>尚未配置 API Key</span>
                <button
                  type="button"
                  className="dsh-model-select__settings-btn"
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                >
                  <Cpu size={13} />
                  <span>前往配置</span>
                </button>
              </div>
            ) : (
              entries.map((entry) => {
                const meta = PROVIDER_METADATA[entry.provider];
                const isSelected = entry.provider === activeProvider;
                return (
                  <button
                    key={entry.provider}
                    type="button"
                    className={`dsh-model-select__option ${isSelected ? "dsh-model-select__option--selected" : ""}`}
                    onClick={() => {
                      onSelect(entry.provider);
                      setOpen(false);
                    }}
                  >
                    <div className="dsh-model-select__option-main">
                      <div className="dsh-model-select__option-name">{meta.label}</div>
                      <div className="dsh-model-select__option-model">{entry.model || meta.defaultModel}</div>
                    </div>
                    {isSelected ? <Check size={14} className="dsh-model-select__check" /> : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="dsh-model-select__footer">
            <button
              type="button"
              className="dsh-model-select__manage-btn"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Cpu size={14} />
              <span>管理模型与 API Key...</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
