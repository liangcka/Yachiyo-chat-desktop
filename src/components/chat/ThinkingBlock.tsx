import { ChevronDown, Sparkles } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { Locale } from "../../domain/chat";
import { copyFor } from "../../i18n/messages";

export interface ThinkingBlockProps {
  thought?: string;
  isStreaming: boolean;
  hasText: boolean;
  locale: Locale;
}

/**
 * 助手思考状态与思维链（CoT）展示组件
 * - 纯等待期：呈现精致的星辰流光微光思考胶囊（与 message-bubble__typing 兼容）
 * - 思维链生成期：呈现支持实时打字展示与折叠/展开的深度思考面板
 */
export const ThinkingBlock = memo(function ThinkingBlock({
  hasText,
  isStreaming,
  locale,
  thought,
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

  // 如果没有思维链内容，且还在流式等待（无正文），展示精致的星光思考胶囊
  if (!hasThought) {
    if (!isStreaming || hasText) {
      return null;
    }

    return (
      <div className="thinking-indicator-wrapper" aria-live="polite">
        <div className="message-bubble__typing thinking-indicator">
          <span className="thinking-indicator__badge" aria-hidden="true">
            <Sparkles size={12} className="thinking-indicator__icon" />
          </span>
          <span className="thinking-indicator__text">{copy.thinking}</span>
          <span className="thinking-indicator__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
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
          <Sparkles
            size={12}
            className={`thinking-block__icon${isStreaming && !hasText ? " thinking-block__icon--spinning" : ""}`}
          />
          <span className="thinking-block__label">
            {isStreaming && !hasText ? copy.deepThinking : copy.thoughtCompleted}
          </span>
        </span>
        <ChevronDown
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
