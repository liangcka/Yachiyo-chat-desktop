import { ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw, RotateCw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { ImageLightbox } from "./chat/ImageLightbox";
import { MarkdownContent } from "./chat/MarkdownContent";
import { MessageContent } from "./chat/MessageContent";
import { RunRecoveryNotice } from "./chat/RunRecoveryNotice";

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
  /** 仅最后一条回复传入：Agent 未正常收尾时提供“继续”入口 */
  onContinue?: () => void;
  isLastAssistant?: boolean;
  isGenerating?: boolean;
  pendingPermission?: { toolName: string; argumentsJson: string; callId?: string };
  pendingToolName?: string;
}

/** 与 .message-bubble__edit--closing 的退场动画时长一致 */
const EDIT_EXIT_MS = 140;

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
  onContinue,
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
  const [editClosing, setEditClosing] = useState(false);
  const [bubbleReturning, setBubbleReturning] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const editCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const bubbleRef = useRef<HTMLElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  // 进入编辑即聚焦并把光标放到末尾
  useEffect(() => {
    if (!editing) return;
    const el = editTextareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // 编辑框随内容增高，超出上限后在框内滚动。先量出目标高度再从旧高度起跳，CSS 的 height 过渡才有起点；
  // 未到上限时隐藏滚动条，否则过渡途中内容暂时高于框体会闪出滚动条
  useEffect(() => {
    const el = editTextareaRef.current;
    if (!editing || !el) return;
    const previous = el.style.height;
    el.style.height = "auto";
    const target = el.scrollHeight;
    const next = `${target}px`;
    if (previous && previous !== next) {
      el.style.height = previous;
      void el.offsetHeight;
    }
    el.style.height = next;
    el.style.overflowY = target > parseFloat(window.getComputedStyle(el).maxHeight) ? "auto" : "hidden";
  }, [editing, editText]);

  useEffect(() => () => clearTimeout(editCloseTimerRef.current), []);

  const openEdit = () => {
    clearTimeout(editCloseTimerRef.current);
    setEditClosing(false);
    setEditText(message.text);
    setEditing(true);
  };

  // 收起编辑框先播放退场动画，结束后换回气泡并让气泡做一次回弹入场
  const closeEdit = () => {
    if (editClosing) return;
    setEditClosing(true);
    editCloseTimerRef.current = setTimeout(() => {
      setEditing(false);
      setEditClosing(false);
      setBubbleReturning(true);
    }, EDIT_EXIT_MS);
  };

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

  // 长按菜单只服务触屏：鼠标端的撤回已在悬停操作条里，右键不再弹出重复的菜单
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
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

  const submitEdit = () => {
    if (!editText.trim() || editClosing) return;
    onEdit?.(message.id, editText);
    closeEdit();
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
  // Agent 未正常收尾时说明原因：中断/出错，或最后一步是工具调用、之后没有正文
  const endedOnTool = message.contentSegments?.at(-1)?.type === "tool";
  const runEndNote =
    message.role !== "assistant" || isEmpty || message.loopStopped === true || message.truncated === true || message.recovery !== undefined
      ? undefined
      : message.status === "stopped"
        ? copyFor(locale).runStopped
        : message.status === "failed"
          ? copyFor(locale).runFailed
          : message.status === "complete" && hasToolSteps && endedOnTool
            ? copyFor(locale).runNoFinalAnswer
            : undefined;
  // 取消要等网关确认命令等操作收尾：收尾期间与无法确认的结果都如实说明，不伪装成已停止
  const copy = copyFor(locale);
  const cancelNote =
    message.role !== "assistant" || message.recovery !== undefined
      ? undefined
      : isStreamingMessage && message.cancelRequested === true
        ? [copy.runCancelling, ...(message.cancelPending ?? []).map((operation) => `${operation.name}：${operation.detail}`)].join(" ")
        : isStreamingMessage && (message.waitingFor?.length ?? 0) > 0
          ? [copy.runWaitingForWorkspace, ...(message.waitingFor ?? []).map((operation) => operation.name)].join(" ")
        : message.status === "stopped" && message.cancellation !== undefined
          ? message.cancellation.confirmed
            ? copy.runCancelled
            : copy.runCancelUnknown(
                (message.cancellation.unknown ?? []).map((operation) => operation.name).join("、") ||
                  (locale === "ja-JP" ? "実行中だった操作" : "运行中的操作"),
              )
          : undefined;
  const hasMenuOptions = onRecall !== undefined;
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
          <button
            type="button"
            className="message-bubble__image-button"
            aria-label={locale === "ja-JP" ? "画像を拡大" : "放大图片"}
            onClick={() => {
              // 长按呼出菜单后的那次 click 交给气泡自身吞掉
              if (!ignoreNextClickRef.current) setPreviewOpen(true);
            }}
          >
            <img alt="" className="message-bubble__image" onLoad={onImageLoad} src={imageUrl} />
          </button>
        ) : (
          <div aria-hidden="true" className="message-bubble__image message-bubble__image--loading" />
        )
      ) : null}
      {editing ? (
        <form className={`message-bubble__edit${editClosing ? " message-bubble__edit--closing" : ""}`} onSubmit={(event) => { event.preventDefault(); submitEdit(); }}>
          <textarea
            ref={editTextareaRef}
            aria-label={locale === "ja-JP" ? "メッセージを編集" : "编辑消息"}
            rows={1}
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                // 只退出编辑，不让外层的 Escape 监听（停止生成、关弹窗）一并触发
                event.stopPropagation();
                closeEdit();
              } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submitEdit();
              }
            }}
          />
          <div className="message-bubble__edit-actions">
            <button type="button" className="message-bubble__edit-cancel" onClick={closeEdit}>{locale === "ja-JP" ? "キャンセル" : "取消"}</button>
            <button type="submit" className="message-bubble__edit-save" disabled={!editText.trim()}>{locale === "ja-JP" ? "保存して再生成" : "保存并重新生成"}</button>
          </div>
        </form>
      ) : isEmpty && message.status === "failed" && message.role === "assistant" ? (
        <p>{locale === "ja-JP" ? "返信を生成できませんでした。" : "本次回复未生成。"}</p>
      ) : message.role === "assistant" ? (
        <MessageContent message={message} locale={locale} hideCitations={hideCitations} pendingPermission={pendingPermission} pendingToolName={pendingToolName} latest={onContinue !== undefined} />
      ) : hasText ? (
        <div
          className={`message-bubble__user-bubble${bubbleReturning ? " message-bubble__user-bubble--returning" : ""}`}
          onAnimationEnd={() => setBubbleReturning(false)}
        >
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
        </div>
      ) : null}
      {message.truncated === true ? (
        <span className="message-bubble__truncated">{copyFor(locale).truncated}</span>
      ) : null}
      {message.loopStopped === true ? (
        <span className="message-bubble__truncated">{copyFor(locale).loopStopped}</span>
      ) : null}
      {cancelNote !== undefined ? (
        <div
          className={`message-bubble__run-note${message.cancellation?.confirmed === false ? " message-bubble__run-note--warning" : ""}`}
          role="status"
        >
          <span>{cancelNote}</span>
        </div>
      ) : null}
      {message.role === "assistant" ? (
        <RunRecoveryNotice
          message={message}
          locale={locale}
          latest={onContinue !== undefined}
          {...(onRegenerate !== undefined ? { onRegenerate: () => onRegenerate(message.id) } : {})}
        />
      ) : null}
      {runEndNote !== undefined ? (
        <div className="message-bubble__run-note" role="status">
          <span>{runEndNote}</span>
          {onContinue !== undefined && !isGenerating ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); onContinue(); }}>
              {copyFor(locale).continueRun}
            </button>
          ) : null}
        </div>
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
      {!editing && (showCopy || onEdit || showRegenerate || showVersions || onRecall) ? (
        <div className="message-bubble__actions">
          {message.role === "user" ? (
            <time className="message-bubble__time" dateTime={new Date(message.createdAt).toISOString()}>
              {new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}
            </time>
          ) : null}
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
          {onEdit ? <button type="button" title={locale === "ja-JP" ? "メッセージを編集" : "编辑消息"} aria-label={locale === "ja-JP" ? "メッセージを編集" : "编辑消息"} onClick={openEdit}><Pencil size={13} /></button> : null}
          {onRecall !== undefined ? (
            <button type="button" onClick={handleRecallAction} title={copyFor(locale).recall} aria-label={copyFor(locale).recall}>
              <RotateCcw size={13} />
            </button>
          ) : null}
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
        </div>
      )}
      {previewOpen && imageUrl !== undefined ? <ImageLightbox src={imageUrl} onClose={() => setPreviewOpen(false)} /> : null}
    </article>
  );
});
