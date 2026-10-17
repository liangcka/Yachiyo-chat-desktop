import { contextCharacters, REQUEST_CHARACTER_BUDGET } from "../domain/context-budget";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Locale } from "../domain/chat";

export interface ContextMeterProps {
  messages: ChatMessage[];
  compressedUpTo?: number;
  summary?: string;
  /** 估计 Token 预算，默认由应用请求字符上限换算。 */
  contextLimit?: number;
  locale?: Locale;
}

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}k`;
  return `${num}`;
}

export function ContextMeter({
  messages,
  compressedUpTo,
  summary,
  contextLimit = 1800 + Math.ceil(REQUEST_CHARACTER_BUDGET / 2.2),
  locale,
}: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const isJapanese = locale === "ja-JP";

  // 估算 Token 用量（中文 ~1.5 字符/token，英文代码 ~3.5 字符/token，平均约 2.2 字符/token）
  const breakdown = useMemo(() => {
    const systemTokens = 1200; // 角色提示词与系统设定基线
    const toolsTokens = 600; // 联网检索及工具 schema 基线
    const messageChars = contextCharacters(messages, compressedUpTo, summary);
    const messageTokens = Math.ceil(messageChars / 2.2);
    const usedTokens = systemTokens + toolsTokens + messageTokens;
    const percent = Math.min(100, Math.max(1, Math.round((usedTokens / contextLimit) * 100)));
    return {
      systemTokens,
      toolsTokens,
      messageTokens,
      usedTokens,
      percent,
      contextWindow: contextLimit,
    };
  }, [messages, contextLimit, compressedUpTo, summary]);

  // 点击外部或按 Esc 关闭弹出层
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

  const percent = breakdown.percent;
  const strokeDash = (CIRCUMFERENCE * percent) / 100;
  if (percent <= 50) return null;

  return (
    <span ref={rootRef} className="context-meter-root" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="context-meter-trigger"
        aria-label={`上下文已用 ${percent}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${isJapanese ? "コンテキスト推定量" : "上下文估算"} ${percent}% (~${formatTokens(breakdown.usedTokens)} / ${formatTokens(breakdown.contextWindow)})`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle className="context-meter-track" cx="7" cy="7" r={RADIUS} />
          <circle
            className="context-meter-fill"
            cx="7"
            cy="7"
            r={RADIUS}
            strokeDasharray={`${strokeDash} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>

      {open && (
        <div className="context-meter-panel" role="dialog" aria-label={isJapanese ? "コンテキスト使用状況の詳細" : "上下文用量详情"}>
          <div className="context-meter-panel__header">
            <span className="context-meter-panel__title">{isJapanese ? "コンテキスト推定量" : "上下文估算"}</span>
            <span className="context-meter-panel__percent">{percent}%</span>
            <span className="context-meter-panel__figures">
              {`~${formatTokens(breakdown.usedTokens)} / ${formatTokens(breakdown.contextWindow)}`}
            </span>
          </div>

          <div className="context-meter-panel__bar">
            <div
              className="context-meter-panel__segment context-meter-panel__segment--system"
              style={{ width: `${(breakdown.systemTokens / breakdown.usedTokens) * percent}%` }}
              title={`${isJapanese ? "システム設定" : "系统设定"}: ~${formatTokens(breakdown.systemTokens)}`}
            />
            <div
              className="context-meter-panel__segment context-meter-panel__segment--tools"
              style={{ width: `${(breakdown.toolsTokens / breakdown.usedTokens) * percent}%` }}
              title={`${isJapanese ? "ツール・スキル" : "工具与技能"}: ~${formatTokens(breakdown.toolsTokens)}`}
            />
            <div
              className="context-meter-panel__segment context-meter-panel__segment--messages"
              style={{ width: `${(breakdown.messageTokens / breakdown.usedTokens) * percent}%` }}
              title={`${isJapanese ? "会話履歴" : "对话消息"}: ~${formatTokens(breakdown.messageTokens)}`}
            />
          </div>

          <div className="context-meter-panel__rows">
            <div className="context-meter-panel__row">
              <span className="context-meter-panel__label">
                <span className="context-meter-panel__swatch context-meter-panel__swatch--system" />
                {isJapanese ? "システムプロンプト" : "系统提示词"}
              </span>
              <span className="context-meter-panel__val">~{formatTokens(breakdown.systemTokens)}</span>
            </div>
            <div className="context-meter-panel__row">
              <span className="context-meter-panel__label">
                <span className="context-meter-panel__swatch context-meter-panel__swatch--tools" />
                {isJapanese ? "ツールとプラグイン" : "工具与插件"}
              </span>
              <span className="context-meter-panel__val">~{formatTokens(breakdown.toolsTokens)}</span>
            </div>
            <div className="context-meter-panel__row">
              <span className="context-meter-panel__label">
                <span className="context-meter-panel__swatch context-meter-panel__swatch--messages" />
                {isJapanese ? "会話履歴" : "对话历史"}
              </span>
              <span className="context-meter-panel__val">~{formatTokens(breakdown.messageTokens)}</span>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
