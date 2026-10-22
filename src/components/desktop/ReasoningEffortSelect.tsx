import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "../../i18n/locale-context";
import {
  fetchReasoningSupport,
  readReasoningChoices,
  reasoningModelKey,
  writeReasoningEffort,
  type ReasoningLevel,
  type ReasoningModel,
  type ReasoningSupport,
} from "../../services/reasoning-effort";
import "./ReasoningEffortSelect.css";

export interface ReasoningEffortSelectProps {
  /** 当前激活的模型；未配置模型时不渲染 */
  model?: ReasoningModel;
  onOpenModelSettings: () => void;
  disabled?: boolean;
}

const LEVEL_LABELS: Record<ReasoningLevel, { zh: string; ja: string }> = {
  low: { zh: "轻度", ja: "軽め" },
  medium: { zh: "中", ja: "中" },
  high: { zh: "高", ja: "高" },
  xhigh: { zh: "极高", ja: "最高" },
  max: { zh: "Ultra", ja: "Ultra" },
};

function levelLabel(level: ReasoningLevel, ja: boolean): string {
  return ja ? LEVEL_LABELS[level].ja : LEVEL_LABELS[level].zh;
}

/** 滑杆上第 index 档的位置（百分比） */
function stopPosition(index: number, count: number): number {
  return count <= 1 ? 0 : (index / (count - 1)) * 100;
}

/**
 * 对话框的思考档位选择器：档位表来自桌面网关，按模型分别记忆用户选择；
 * 不选择时请求不携带档位，沿用各厂商默认规则。模型不支持调节时按钮禁用并说明原因
 */
export function ReasoningEffortSelect({ model, onOpenModelSettings, disabled = false }: ReasoningEffortSelectProps) {
  const ja = useLocale() === "ja-JP";
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState(readReasoningChoices);
  const [loaded, setLoaded] = useState<{ key: string; support: ReasoningSupport }>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLSpanElement | null>(null);
  // 拖动中拇指跟随指针的连续位置（0~1）；松手时吸附到最近档位，未拖动时为 undefined
  const [dragRatio, setDragRatio] = useState<number>();
  const dragPointerRef = useRef<number | undefined>(undefined);
  const modelKey = model === undefined ? undefined : reasoningModelKey(model);
  // model 对象每次渲染都会新建，查询以其字段为依赖
  const provider = model?.provider;
  const modelId = model?.model;
  const baseUrl = model?.baseUrl;

  useEffect(() => {
    if (provider === undefined || modelId === undefined) return;
    const target: ReasoningModel = { provider, model: modelId, ...(baseUrl !== undefined ? { baseUrl } : {}) };
    let cancelled = false;
    void fetchReasoningSupport(target).then((support) => {
      if (!cancelled) setLoaded({ key: reasoningModelKey(target), support });
    });
    return () => {
      cancelled = true;
    };
  }, [provider, modelId, baseUrl]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (model === undefined || modelKey === undefined) return null;

  const support = loaded?.key === modelKey ? loaded.support : undefined;
  const levels = support?.levels ?? [];
  const supported = levels.length > 0;
  const stored = choices[modelKey];
  const selected = stored !== undefined && levels.includes(stored) ? stored : undefined;
  const effective = selected ?? support?.defaultLevel ?? levels[0];
  const effectiveIndex = effective === undefined ? 0 : levels.indexOf(effective);
  const ultra = effective === "max";

  const choose = (level: ReasoningLevel | undefined) => setChoices(writeReasoningEffort(model, level));

  const ratioAt = (clientX: number): number | undefined => {
    const rect = railRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || levels.length === 0) return undefined;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const levelForRatio = (ratio: number): ReasoningLevel | undefined => levels[Math.round(ratio * (levels.length - 1))];

  // 拖动时拇指连续跟手，档位随最近的刻度实时切换；不依赖 hasPointerCapture，部分 WebView 下它不可靠
  const dragTo = (clientX: number) => {
    const ratio = ratioAt(clientX);
    if (ratio === undefined) return;
    setDragRatio(ratio);
    const level = levelForRatio(ratio);
    if (level !== undefined && level !== effective) choose(level);
  };

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 不支持指针捕获时仍可在轨道内拖动
    }
    dragPointerRef.current = event.pointerId;
    dragTo(event.clientX);
  };

  const onTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    dragTo(event.clientX);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    dragPointerRef.current = undefined;
    setDragRatio(undefined);
  };

  const onSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? levels.length - 1 : effectiveIndex + step;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const level = levels[Math.min(levels.length - 1, Math.max(0, target))];
    if (level !== undefined) choose(level);
  };

  const placeholder = ja ? "推論の強さを選択" : "选择推理强度";
  const unsupportedHint = ja ? "このモデルは推論の強さを調整できません" : "当前模型不支持调节推理强度";
  const triggerLabel = selected === undefined ? placeholder : `${ja ? "推論" : "推理强度"} · ${levelLabel(selected, ja)}`;
  const triggerDisabled = disabled || !supported;
  const dragging = dragRatio !== undefined;
  const progress = dragging ? dragRatio * 100 : stopPosition(effectiveIndex, levels.length);

  return (
    <div ref={rootRef} className="dsh-reasoning-select">
      <button
        type="button"
        className={`dsh-reasoning-select__trigger ${open ? "dsh-reasoning-select__trigger--active" : ""}`}
        onClick={() => !triggerDisabled && setOpen((previous) => !previous)}
        disabled={triggerDisabled}
        aria-haspopup="dialog"
        aria-expanded={open && !triggerDisabled}
        title={support !== undefined && !supported ? unsupportedHint : placeholder}
      >
        <span>{support !== undefined && !supported ? (ja ? "推論の強さ" : "推理强度") : triggerLabel}</span>
        <ChevronDown size={12} className="dsh-reasoning-select__chevron" aria-hidden="true" />
      </button>

      {open && !triggerDisabled && effective !== undefined ? (
        <div className={`dsh-reasoning-select__panel ${ultra ? "dsh-reasoning-select__panel--ultra" : ""}`} role="dialog" aria-label={placeholder}>
          <div className="dsh-reasoning-select__header">
            <span className="dsh-reasoning-select__level">{levelLabel(effective, ja)}</span>
            <button
              type="button"
              className="dsh-reasoning-select__model"
              onClick={() => {
                setOpen(false);
                onOpenModelSettings();
              }}
              title={ja ? "モデル設定を開く" : "打开模型设置"}
            >
              <span>{model.model}</span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="dsh-reasoning-select__reset"
              onClick={() => choose(undefined)}
              disabled={selected === undefined}
              title={ja ? "モデルの既定に戻す" : "恢复模型默认档位"}
              aria-label={ja ? "モデルの既定に戻す" : "恢复模型默认档位"}
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <div
            className={`dsh-reasoning-select__track ${dragging ? "dsh-reasoning-select__track--dragging" : ""}`}
            role="slider"
            tabIndex={0}
            aria-label={placeholder}
            aria-valuemin={0}
            aria-valuemax={levels.length - 1}
            aria-valuenow={effectiveIndex}
            aria-valuetext={levelLabel(effective, ja)}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={onSliderKeyDown}
          >
            {/* 填充从轨道左端一直盖到拇指右缘；首档不填充 */}
            <span className="dsh-reasoning-select__fill" style={{ width: progress === 0 ? 0 : `calc(28px + (100% - 28px) * ${progress / 100})` }} />
            {ultra ? (
              <span className="dsh-reasoning-select__meteors" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            ) : null}
            <span ref={railRef} className="dsh-reasoning-select__rail" aria-hidden="true">
              {levels.map((level, index) => (
                <span
                  key={level}
                  className={`dsh-reasoning-select__stop ${index <= effectiveIndex ? "dsh-reasoning-select__stop--passed" : ""}`}
                  style={{ left: `${stopPosition(index, levels.length)}%` }}
                />
              ))}
              <span className="dsh-reasoning-select__thumb" style={{ left: `${progress}%` }} />
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
