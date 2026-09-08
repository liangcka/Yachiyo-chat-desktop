import { Copy, RotateCcw, RotateCw, Sparkles } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { MarkdownContent } from "./chat/MarkdownContent";
import { ThinkingBlock } from "./chat/ThinkingBlock";
import { ToolCard } from "./tools/ToolCard";

export interface MessageBubbleProps {
  locale: Locale;
  message: ChatMessage;
  imageUrl?: string;
  /** "显示引用来源"开关；false 时不渲染 assistant 消息的参考来源列表 */
  showSources?: boolean;
  onRecall?: () => void;
  onRegenerate?: () => void;
  onToast?: (message: string) => void;
  onImageLoad?: () => void;
}

function messageLabel(role: ChatMessage["role"], locale: Locale): string {
  if (locale === "ja-JP") return role === "assistant" ? "八千代の返事" : "あなたのメッセージ";
  return role === "assistant" ? "八千代的回复" : "我的消息";
}

/** 去除联网回复正文中的 [n] 引用标记（仅展示层，存储保留原文） */
function stripCitationMarkers(text: string): string {
  return text.replace(/\[(\d{1,2})\]/gu, "");
}

/** memo 化：流式期间只有最后一条消息变化，其余气泡跳过重渲（配合上游稳定回调引用） */
export const MessageBubble = memo(function MessageBubble({
  imageUrl,
  locale,
  message,
  onImageLoad,
  onRecall,
  onRegenerate,
  onToast,
  showSources,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const bubbleRef = useRef<HTMLElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const ignoreNextClickRef = useRef(false);

  // 关闭"显示引用来源"时，联网回复正文中的 [n] 引用标记一并隐藏（仅展示层）
  const hideCitations = showSources === false && message.sources !== undefined && message.sources.length > 0;
  const strippedText = hideCitations ? stripCitationMarkers(message.text) : message.text;
  const displayText = strippedText.trim().length > 0 ? strippedText : message.text;

  const hasText = displayText.trim().length > 0;
  const hasImage = message.imageId !== undefined;
  const isTyping = message.text.length === 0 && message.status === "streaming";
  // Agent 消息可能仅有工具步骤而无正文（模型先调工具后作答），此时气泡仍需渲染卡片
  const hasToolSteps = message.toolSteps !== undefined && message.toolSteps.length > 0;
  // 仅 assistant 消息渲染联网搜索的参考来源，且受"显示引用来源"开关控制；
  // 正文到达前（搜索与模型等待期）不渲染来源区块，保持三点等待动画
  const visibleSources =
    message.role === "assistant" && showSources !== false && hasText
      ? message.sources?.filter(({ title, url }) => title.length > 0 && url.length > 0)
      : undefined;
  const hasVisibleSources = visibleSources !== undefined && visibleSources.length > 0;

  const openMenu = () => {
    if (bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      const scrollContainer = bubbleRef.current.closest(".conversation-view");
      const containerRect = scrollContainer?.getBoundingClientRect();

      // 菜单高度约 40px，加上外边距与浮动安全间隙共约 52px
      const REQUIRED_VERTICAL_SPACE = 52;
      // 避开视口顶部的 Header / Titlebar（桌面端 76px 以上，移动端含安全区与控制条约 80~100px）与内边距
      const VIEWPORT_HEADER_OFFSET = 135;

      const topSpaceInContainer = containerRect ? rect.top - containerRect.top : rect.top;
      const hasTopSpace = topSpaceInContainer >= REQUIRED_VERTICAL_SPACE && rect.top >= VIEWPORT_HEADER_OFFSET;

      const bottomSpaceInContainer = containerRect
        ? containerRect.bottom - rect.bottom
        : window.innerHeight - rect.bottom;
      const hasBottomSpace = bottomSpaceInContainer >= REQUIRED_VERTICAL_SPACE;

      if (!hasTopSpace && hasBottomSpace) {
        setPlacement("bottom");
      } else if (!hasBottomSpace && hasTopSpace) {
        setPlacement("top");
      } else if (!hasTopSpace && !hasBottomSpace) {
        setPlacement(topSpaceInContainer >= bottomSpaceInContainer ? "top" : "bottom");
      } else {
        setPlacement("top");
      }
    }
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDownDoc = (e: PointerEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDownDoc, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownDoc, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      ignoreNextClickRef.current = true;
      openMenu();
      try {
        navigator.vibrate?.(40);
      } catch {
        // Ignore vibration errors
      }
    }, 400);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - pointerStartPosRef.current.x,
      e.clientY - pointerStartPosRef.current.y,
    );
    if (dist > 8) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      pointerStartPosRef.current = null;
    }
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    pointerStartPosRef.current = null;
    setTimeout(() => {
      ignoreNextClickRef.current = false;
    }, 120);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    openMenu();
  };

  const handleCopy = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(displayText);
      onToast?.(copyFor(locale).copied);
    } catch {
      // Ignore clipboard write failures
    }
  };

  const handleRecallAction = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMenuOpen(false);
    onRecall?.();
  };

  const handleRegenerateAction = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMenuOpen(false);
    onRegenerate?.();
  };

  if (!hasText && !hasImage && !isTyping && !hasToolSteps) {
    return null;
  }

  const hasMenuOptions = onRecall !== undefined || onRegenerate !== undefined || hasText;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={bubbleRef}
      aria-label={messageLabel(message.role, locale)}
      className={`message-bubble message-bubble--${message.role}${isTyping ? " message-bubble--typing" : ""}${menuOpen ? " message-bubble--menu-open" : ""}`}
      data-status={message.status}
      onContextMenu={hasMenuOptions ? handleContextMenu : undefined}
      onPointerCancel={handlePointerUp}
      onPointerDown={hasMenuOptions ? handlePointerDown : undefined}
      onPointerMove={hasMenuOptions ? handlePointerMove : undefined}
      onPointerUp={handlePointerUp}
      onClick={(e) => {
        if (ignoreNextClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          ignoreNextClickRef.current = false;
        }
      }}
    >
      {message.role === "assistant" ? (
        <div className="assistant-identity-header">
          <div className="assistant-identity-header__lead">
            <span className="assistant-identity-header__avatar" aria-hidden="true">
              <Sparkles size={13} />
            </span>
            <span className="assistant-identity-header__name">
              {locale === "ja-JP" ? "月見八千代" : "月见八千代"}
            </span>
            {message.skills !== undefined && message.skills.length > 0 ? (
              <span
                className="assistant-identity-header__skills-tag"
                title={
                  locale === "ja-JP"
                    ? `適用スキル: ${message.skills.join("、")}`
                    : `已生效技能：${message.skills.join("、")}`
                }
              >
                <Sparkles size={10} className="assistant-identity-header__skills-icon" />
                <span>{message.skills.join(" · ")}</span>
              </span>
            ) : null}
            {message.status === "streaming" && hasText ? (
              <span className="assistant-identity-header__status assistant-identity-header__status--streaming">
                <span className="assistant-identity-header__pulse" />
                {copyFor(locale).thinking}
              </span>
            ) : null}
          </div>
          <div className="assistant-identity-header__actions">
            {hasText ? (
              <button
                type="button"
                className="assistant-identity-header__action-btn"
                onClick={handleCopy}
                title={copyFor(locale).copyText}
                aria-label={copyFor(locale).copyText}
              >
                <Copy size={12} />
              </button>
            ) : null}
            {onRegenerate !== undefined && message.status !== "streaming" ? (
              <button
                type="button"
                className="assistant-identity-header__action-btn"
                onClick={handleRegenerateAction}
                title={copyFor(locale).regenerate}
                aria-label={copyFor(locale).regenerate}
              >
                <RotateCw size={12} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {hasImage ? (
        imageUrl !== undefined ? (
          <img alt="" className="message-bubble__image" onLoad={onImageLoad} src={imageUrl} />
        ) : (
          <div aria-hidden="true" className="message-bubble__image message-bubble__image--loading" />
        )
      ) : null}
      {hasToolSteps ? (
        <div className="message-bubble__tools">
          {message.toolSteps?.map((step) => (
            <ToolCard
              isError={step.result?.isError}
              isRunning={step.result === undefined && message.status === "streaming"}
              key={step.id}
              args={safeParseArgs(step.argumentsJson)}
              output={step.result?.output}
              toolName={step.name}
            />
          ))}
        </div>
      ) : null}
      {message.role === "assistant" ? (
        <ThinkingBlock
          hasText={hasText}
          isStreaming={message.status === "streaming"}
          locale={locale}
          thought={message.thought}
        />
      ) : null}
      {hasText ? (
        <>
          <MarkdownContent text={displayText} isAssistant={message.role === "assistant"} />
          {message.truncated === true ? (
            <span className="message-bubble__truncated">{copyFor(locale).truncated}</span>
          ) : null}
        </>
      ) : message.role !== "assistant" && message.status === "streaming" ? (
        <span aria-hidden="true" className="message-bubble__typing">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {hasVisibleSources && visibleSources !== undefined ? (
        <div aria-label={copyFor(locale).sourcesLabel} className="message-bubble__sources">
          {visibleSources.map((source) => (
            <a
              href={source.url}
              key={source.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {source.title}
            </a>
          ))}
        </div>
      ) : null}
      {menuOpen && (
        <div
          aria-label={copyFor(locale).appName}
          className={`message-bubble__context-menu message-bubble__context-menu--${message.role} message-bubble__context-menu--${placement}`}
          role="menu"
        >
          {onRegenerate !== undefined ? (
            <button
              aria-label={copyFor(locale).regenerate}
              className="message-bubble__context-item message-bubble__context-item--regenerate"
              onClick={handleRegenerateAction}
              role="menuitem"
              type="button"
            >
              <RotateCw aria-hidden="true" size={13} strokeWidth={2.2} />
              <span>{copyFor(locale).regenerate}</span>
            </button>
          ) : null}
          {onRecall !== undefined ? (
            <button
              aria-label={copyFor(locale).recall}
              className="message-bubble__context-item message-bubble__context-item--recall"
              onClick={handleRecallAction}
              role="menuitem"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} strokeWidth={2.2} />
              <span>{copyFor(locale).recall}</span>
            </button>
          ) : null}
          {(onRegenerate !== undefined || onRecall !== undefined) && hasText ? (
            <span aria-hidden="true" className="message-bubble__context-divider" />
          ) : null}
          {hasText ? (
            <button
              aria-label={copyFor(locale).copyText}
              className="message-bubble__context-item"
              onClick={handleCopy}
              role="menuitem"
              type="button"
            >
              <Copy aria-hidden="true" size={13} strokeWidth={2.2} />
              <span>{copyFor(locale).copyText}</span>
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
});

/** 工具步骤参数 JSON 的防御性解析：非法 JSON 或非对象形态回退为 undefined（模型输出不可信） */
function safeParseArgs(json: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
