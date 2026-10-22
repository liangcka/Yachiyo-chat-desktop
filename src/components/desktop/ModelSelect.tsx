import { Check, ChevronDown, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROVIDER_METADATA, findVendorForEntry, type ProviderId } from "../../domain/llm";
import { useLocale } from "../../i18n/locale-context";

export interface ModelSelectProps {
  /** 当前使用的模型配置 id */
  activeEntryId?: string;
  activeModel?: string;
  entries: readonly { id: string; provider: ProviderId; apiKey: string; model: string; baseUrl?: string; disabled?: boolean }[];
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
}



/** 同一厂商可有多条配置：OpenAI 兼容的服务商按端点显示各自名称（如 Kimi、通义），而不是统一显示 OpenAI */
function entryLabel(entry: { provider: ProviderId; baseUrl?: string }): string {
  const meta = PROVIDER_METADATA[entry.provider];
  return entry.baseUrl === undefined ? meta.label : findVendorForEntry(entry.provider, entry.baseUrl)?.name ?? meta.label;
}

export function ModelSelect({
  activeEntryId,
  activeModel,
  entries,
  onSelect,
  onOpenSettings,
  disabled = false,
}: ModelSelectProps) {
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

  const enabledEntries = entries.filter((e) => e.disabled !== true);
  const activeEntry = entries.find((e) => e.id === activeEntryId);
  const activeMeta = activeEntry ? PROVIDER_METADATA[activeEntry.provider] : undefined;
  const activeLabel = activeEntry ? entryLabel(activeEntry) : undefined;
  const currentModel = activeEntry?.model || activeModel || activeMeta?.defaultModel;
  const modelLabel = currentModel?.replace(/^glm-/i, "GLM-").replace(/-flash$/i, " Flash");

  const fullLabel = activeLabel
    ? currentModel
      ? `${activeLabel} (${currentModel})`
      : activeLabel
    : ja ? "モデルを選択 (Default)" : "选择模型 (Default)";

  return (
    <div ref={rootRef} className="dsh-model-select">
      <button
        type="button"
        className={`dsh-model-select__trigger ${open ? "dsh-model-select__trigger--active" : ""}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={ja ? `${fullLabel} - クリックでモデルを切り替え` : `${fullLabel} - 点击切换模型`}
      >
        <Cpu size={13} className="dsh-model-select__icon" />
        {modelLabel ? (
          <span className="dsh-model-select__label-group">
            <span className="dsh-model-select__model">{modelLabel}</span>
          </span>
        ) : (
          <span className="dsh-model-select__placeholder">{ja ? "モデルを選択" : "选择模型"}</span>
        )}
        <ChevronDown size={12} className={`dsh-model-select__chevron ${open ? "dsh-model-select__chevron--open" : ""}`} />
      </button>

      {open && (
        <div className="dsh-model-select__menu" role="listbox">
          <div className="dsh-model-select__header">
            <span className="dsh-model-select__header-title">{ja ? "設定済みのモデル" : "已配置模型"}</span>
          </div>

          <div className="dsh-model-select__list">
            {enabledEntries.length === 0 ? (
              <div className="dsh-model-select__empty">
                <span>{ja ? "API キーが未設定です" : "尚未配置 API Key"}</span>
              </div>
            ) : (
              enabledEntries.map((entry) => {
                const meta = PROVIDER_METADATA[entry.provider];
                const isSelected = entry.id === activeEntryId;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`dsh-model-select__option ${isSelected ? "dsh-model-select__option--selected" : ""}`}
                    onClick={() => {
                      onSelect(entry.id);
                      setOpen(false);
                    }}
                  >
                    <div className="dsh-model-select__option-main">
                      <div className="dsh-model-select__option-name">{entryLabel(entry)}</div>
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
              <span>{ja ? "モデルと API キーを管理…" : "管理模型与 API Key..."}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
