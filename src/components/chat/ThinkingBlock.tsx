import { ChevronRight } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { Locale } from "../../domain/chat";
import { copyFor } from "../../i18n/messages";

export interface ThinkingBlockProps {
  thought?: string;
  durationMs?: number;
  isStreaming: boolean;
  hasText: boolean;
  locale: Locale;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  hasText,
  isStreaming,
  locale,
  thought,
  durationMs,
}: ThinkingBlockProps) {
  const hasThought = typeof thought === "string" && thought.trim().length > 0;
  const copy = copyFor(locale);

  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  // 正文开始后收起思考，避免全文继续占据答案区域。
  useEffect(() => {
    if (hasText) {
      setUserExpanded(null);
    }
  }, [hasText]);

  // 没有正文和思考片段时保留等待反馈。
  if (!hasThought) {
    if (!isStreaming || hasText) {
      return null;
    }

    return (
      <div className="thinking-indicator-wrapper" role="status">
        <span className="thinking-indicator__text">{copy.thinking}</span>
      </div>
    );
  }

  const isExpanded = userExpanded ?? false;
  const thinking = isStreaming && !hasText;
  const latestLine = thought?.trim().split(/\r?\n/u).at(-1);

  return (
    <div className={`thinking-block${isExpanded ? " thinking-block--expanded" : ""}`} aria-live="polite">
      <button
        type="button"
        className="thinking-block__toggle"
        onClick={() => setUserExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="thinking-block__toggle-lead">
          <span className="thinking-block__label">
            {thinking ? copy.thinking : durationMs !== undefined
              ? durationMs < 1000
                ? (locale === "ja-JP" ? "1 秒未満考えました" : "思考了不到 1 秒")
                : (locale === "ja-JP" ? `${Math.round(durationMs / 1000)} 秒考えました` : `思考了 ${Math.round(durationMs / 1000)} 秒`)
              : (locale === "ja-JP" ? "思考を見る" : "查看思考")}
          </span>
          {thinking ? <span className="thinking-block__preview">{latestLine}</span> : null}
        </span>
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`thinking-block__chevron${isExpanded ? " thinking-block__chevron--open" : ""}`}
        />
      </button>

      {isExpanded ? (
        <div className="thinking-block__content">
          <div className="thinking-block__text">{thought}</div>
          {isStreaming && !hasText ? (
            <span className="thinking-block__cursor" aria-hidden="true" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
