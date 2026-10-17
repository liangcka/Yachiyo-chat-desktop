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

  // 当处于纯思考期（无正文）时默认展开；正文开始输出后默认折叠，并允许用户手动展开/收起
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  // 监听正文开始输出，重置用户手动状态（若未手动干预）
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

  // 存在深度思维链内容（Thought）
  const isExpanded = userExpanded ?? (!hasText && isStreaming);

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
            {isStreaming && !hasText ? copy.deepThinking : durationMs !== undefined && durationMs >= 1000
              ? (locale === "ja-JP" ? `${Math.round(durationMs / 1000)} 秒考えました` : `思考了 ${Math.round(durationMs / 1000)} 秒`)
              : (locale === "ja-JP" ? "思考を見る" : "查看思考")}
          </span>
        </span>
        <ChevronRight
          size={14}
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
