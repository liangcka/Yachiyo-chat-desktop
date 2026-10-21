import { ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw, RotateCw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { MarkdownContent } from "./chat/MarkdownContent";
import { MessageContent } from "./chat/MessageContent";

export interface MessageBubbleProps {
  locale: Locale;
  message: ChatMessage;
  imageUrl?: string;
  /** "显示引用来源"开关；false 时不渲染 assistant 消息的参考来源列表 */
  showSources?: boolean;
  onRecall?: () => void;
  /** 以下回调都带消息 id：上层可直接传入同一个稳定引用，不必为每条消息新建闭包而让 memo 失效 */
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  versions?: number[];
  onVersionChange?: (messageId: string, version: number) => void;
  onToast?: (message: string) => void;
  onImageLoad?: () => void;
  isLastAssistant?: boolean;
  isGenerating?: boolean;
  pendingPermission?: { toolName: string; argumentsJson: string };
  pendingToolName?: string;
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
  isGenerating,
  isLastAssistant,
  locale,
  message,
  onImageLoad,
  onRecall,
  onRegenerate,
  onEdit,
  versions,
  onVersionChange,
  onToast,
  showSources,
  pendingPermission,
  pendingToolName,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
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

  const [userExpanded, setUserExpanded] = useState(false);
  const [isLongUserMessage, setIsLongUserMessage] = useState(
    () => message.role === "user" && displayText.split("\n").length > 12,
  );
  const userContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message.role !== "user") return;
    const el = userContentRef.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lh = parseFloat(style.lineHeight) || 24;
    const maxHeight = lh * 12;
    if (el.scrollHeight > maxHeight + 4 || displayText.split("\n").length > 12) {
      setIsLongUserMessage(true);
    } else {
      setIsLongUserMessage(false);
    }
  }, [displayText, message.role]);

  const hasText = displayText.trim().length > 0;
  const hasImage = message.imageId !== undefined;
  const isTyping = message.text.length === 0 && message.status === "streaming";
  // Agent 消息可能仅有工具步骤而无正文（模型先调工具后作答），此时气泡仍需渲染卡片
  const hasToolSteps = message.toolSteps !== undefined && message.toolSteps.length > 0;
  // 仅 assistant 消息渲染联网搜索的参考来源，且受"显示引用来源"开关控制；
  // 正文到达前不渲染来源区块，避免来源列表遮蔽等待反馈。
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
    onRegenerate?.(message.id);
  };

  const hasVersions = versions !== undefined && versions.length > 1;
  const isEmpty = !hasText && !hasImage && !hasToolSteps && !message.thought?.trim();
  if (isEmpty && !isTyping && !hasVersions) {
    return null;
  }

  const isStreamingMessage = message.status === "streaming";
  const hasMenuOptions = onRecall !== undefined || (!isStreamingMessage && (onRegenerate !== undefined || hasText));
  const showVersions = Boolean(hasVersions && !isGenerating && !isStreamingMessage);
  const showCopy = Boolean(hasText && !isStreamingMessage);
  const showRegenerate = Boolean(onRegenerate !== undefined && !isStreamingMessage);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={bubbleRef}
      aria-label={messageLabel(message.role, locale)}
      className={`message-bubble message-bubble--${message.role}${isTyping ? " message-bubble--typing" : ""}${menuOpen ? " message-bubble--menu-open" : ""}${isLastAssistant ? " message-bubble--last-assistant" : ""}`}
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
      {hasImage ? (
        imageUrl !== undefined ? (
          <img alt="" className="message-bubble__image" onLoad={onImageLoad} src={imageUrl} />
        ) : (
          <div aria-hidden="true" className="message-bubble__image message-bubble__image--loading" />
        )
      ) : null}
      {editing ? (
        <form className="message-bubble__edit" onSubmit={(event) => { event.preventDefault(); if (editText.trim()) { onEdit?.(message.id, editText); setEditing(false); } }}>
          <textarea aria-label={locale === "ja-JP" ? "メッセージを編集" : "编辑消息"} value={editText} onChange={(event) => setEditText(event.target.value)} />
          <div><button type="button" onClick={() => setEditing(false)}>{locale === "ja-JP" ? "キャンセル" : "取消"}</button><button type="submit" disabled={!editText.trim()}>{locale === "ja-JP" ? "保存して再生成" : "保存并重新生成"}</button></div>
        </form>
      ) : isEmpty && message.status === "failed" && message.role === "assistant" ? (
        <p>{locale === "ja-JP" ? "返信を生成できませんでした。" : "本次回复未生成。"}</p>
      ) : message.role === "assistant" ? (
        <MessageContent message={message} locale={locale} hideCitations={hideCitations} pendingPermission={pendingPermission} pendingToolName={pendingToolName} />
      ) : hasText ? (
        <div
          ref={userContentRef}
          className={`message-bubble__user-content${
            isLongUserMessage && !userExpanded ? " message-bubble__user-content--collapsed" : ""
          }`}
        >
          <MarkdownContent text={displayText} />
          {isLongUserMessage && !userExpanded ? (
            <div className="message-bubble__expand-wrapper">
              <button
                type="button"
                className="message-bubble__expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setUserExpanded(true);
                }}
              >
                {copyFor(locale).expandMessage}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {message.truncated === true ? (
        <span className="message-bubble__truncated">{copyFor(locale).truncated}</span>
      ) : null}
      {message.loopStopped === true ? (
        <span className="message-bubble__truncated">{copyFor(locale).loopStopped}</span>
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
      {!editing && (showCopy || onEdit || showRegenerate || showVersions) ? (
        <div className="message-bubble__actions">
          {showVersions && versions ? (
            <div className="message-bubble__versions" aria-label={locale === "ja-JP" ? "メッセージのバージョン" : "消息版本"}>
              <button type="button" aria-label={locale === "ja-JP" ? "前のバージョン" : "上一个版本"} disabled={!onVersionChange || versions.indexOf(message.branchVersion ?? 1) <= 0} onClick={() => onVersionChange?.(message.id, versions[versions.indexOf(message.branchVersion ?? 1) - 1]!)}><ChevronLeft size={13} /></button>
              <span>{versions.indexOf(message.branchVersion ?? 1) + 1} / {versions.length}</span>
              <button type="button" aria-label={locale === "ja-JP" ? "次のバージョン" : "下一个版本"} disabled={!onVersionChange || versions.indexOf(message.branchVersion ?? 1) >= versions.length - 1} onClick={() => onVersionChange?.(message.id, versions[versions.indexOf(message.branchVersion ?? 1) + 1]!)}><ChevronRight size={13} /></button>
            </div>
          ) : null}
          {showCopy ? (
            <button type="button" onClick={handleCopy} title={copyFor(locale).copyText} aria-label={copyFor(locale).copyText}>
              <Copy size={13} />
            </button>
          ) : null}
          {onEdit ? <button type="button" title={locale === "ja-JP" ? "メッセージを編集" : "编辑消息"} aria-label={locale === "ja-JP" ? "メッセージを編集" : "编辑消息"} onClick={() => { setEditText(message.text); setEditing(true); }}><Pencil size={13} /></button> : null}
          {showRegenerate ? (
            <button type="button" onClick={handleRegenerateAction} title={copyFor(locale).regenerate} aria-label={copyFor(locale).regenerate}>
              <RotateCw size={13} />
            </button>
          ) : null}
        </div>
      ) : null}
      {menuOpen && (
        <div
          aria-label={copyFor(locale).appName}
          className={`message-bubble__context-menu message-bubble__context-menu--${message.role} message-bubble__context-menu--${placement}`}
          role="menu"
        >
          {showRegenerate ? (
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
          {(showRegenerate || onRecall !== undefined) && showCopy ? (
            <span aria-hidden="true" className="message-bubble__context-divider" />
          ) : null}
          {showCopy ? (
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
