import { branchVersions } from "../domain/message-branches";
import type { Conversation } from "../domain/chat";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import type { SkillDefinition } from "../skills";
import { MessageBubble } from "./MessageBubble";

const FOLLOW_THRESHOLD_PX = 80;
/** 消息数超过该阈值才启用虚拟滚动；小会话走原生渲染路径（行为与旧版完全一致） */
const VIRTUALIZATION_THRESHOLD = 40;
/** 虚拟模式下的过扫描行数，保证快速滚动时上下边缘不露白 */
const OVERSCAN = 6;
/** 消息气泡高度估算值；实际高度由 measureElement 实测校正 */
const ESTIMATED_MESSAGE_HEIGHT = 96;

/** 单一版本时返回 undefined：气泡只在多版本时展示切换器，且每次新建的数组会让 memo 失效 */
function switchableVersions(conversation: Conversation | undefined, message: ChatMessage): number[] | undefined {
  const versions = conversation === undefined ? undefined : branchVersions(conversation, message);
  return versions !== undefined && versions.length > 1 ? versions : undefined;
}

function isNearBottom(
  element: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD_PX;
}

let lastProgressStr = "";
let lastScrolled: boolean | undefined = undefined;

function syncTopScrimOpacity(
  element: HTMLElement,
  onScrolledFromTopChange?: (scrolled: boolean) => void,
) {
  const scrollTop = element.scrollTop;
  const progress = Math.min(1, Math.max(0, scrollTop / 40));
  const progressStr = progress.toFixed(3);
  if (progressStr !== lastProgressStr) {
    lastProgressStr = progressStr;
    document.documentElement.style.setProperty("--top-scrim-opacity", progressStr);
  }
  const isScrolled = progress > 0;
  if (isScrolled !== lastScrolled) {
    lastScrolled = isScrolled;
    onScrolledFromTopChange?.(isScrolled);
  }
}

export interface ConversationViewProps {
  locale: Locale;
  messages: ChatMessage[];
  imageUrls?: ReadonlyMap<string, string>;
  summary?: string;
  /** "显示引用来源"开关，向下传递给消息气泡 */
  showSources?: boolean;
  onRecall?: () => void;
  onRegenerate?: (messageId?: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  conversation?: Conversation;
  onVersionChange?: (messageId: string, version: number) => void;
  /** 点击后向上翻页加载更早历史（UI 窗口化） */
  onLoadEarlier?: () => void;
  /** 是否还有更早历史可加载；false 时隐藏入口 */
  hasMoreHistory?: boolean;
  onToast?: (message: string) => void;
  onScrolledFromTopChange?: (scrolledFromTop: boolean) => void;
  /** 当前激活的技能定义列表 */
  activeSkills?: readonly SkillDefinition[];
  pendingPermission?: { toolName: string; argumentsJson: string };
  pendingToolName?: string;
}

export function ConversationView({
  activeSkills,
  imageUrls,
  locale,
  messages,
  onRecall,
  onRegenerate,
  onEdit,
  conversation,
  onVersionChange,
  onLoadEarlier,
  hasMoreHistory,
  onToast,
  onScrolledFromTopChange,
  showSources,
  summary,
  pendingPermission,
  pendingToolName,
}: ConversationViewProps) {
  const containerRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const followingRef = useRef(true);
  const previousMessagesRef = useRef<ChatMessage[]>([]);
  const virtualizationEnabled = messages.length > VIRTUALIZATION_THRESHOLD;

  // 无条件调用（hooks 不能条件化）；未启用时 count 为 0，零成本空转
  const virtualizer = useVirtualizer({
    count: virtualizationEnabled ? messages.length : 0,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey: (index) => messages[index]?.id ?? `index-${index}`,
    getScrollElement: () => containerRef.current,
    overscan: OVERSCAN,
  });

  const scrollToBottom = useCallback(
    (smooth = true) => {
      // 虚拟模式下占位层提供真实总高度，底部始终可达，两个分支共用同一逻辑
      if (smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      } else if (containerRef.current) {
        // 流式增量每帧都会触发：直接定位滚动容器，避免每帧重启平滑滚动动画与 scrollIntoView 的祖先链布局
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
      followingRef.current = true;
      if (containerRef.current) {
        syncTopScrimOpacity(containerRef.current, onScrolledFromTopChange);
      }
    },
    [onScrolledFromTopChange],
  );

  useEffect(() => {
    const previousMessages = previousMessagesRef.current;
    const previousLastMessage = previousMessages.at(-1);
    const currentLastMessage = messages.at(-1);
    const isInitialMessage = previousMessages.length === 0 && currentLastMessage !== undefined;
    const isNewMessage =
      currentLastMessage !== undefined &&
      (messages.length > previousMessages.length || currentLastMessage.id !== previousLastMessage?.id);
    const isStreamingDelta =
      currentLastMessage !== undefined &&
      previousLastMessage !== undefined &&
      currentLastMessage.id === previousLastMessage.id &&
      currentLastMessage.text !== previousLastMessage.text;

    if (isInitialMessage || isNewMessage) {
      scrollToBottom();
    } else if (isStreamingDelta && followingRef.current) {
      scrollToBottom(false);
    } else if (containerRef.current) {
      syncTopScrimOpacity(containerRef.current, onScrolledFromTopChange);
    }

    previousMessagesRef.current = messages;
  }, [messages, onScrolledFromTopChange, scrollToBottom]);

  let lastUserMessageIndex = -1;
  let lastAssistantMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (lastUserMessageIndex === -1 && messages[index]?.role === "user") {
      lastUserMessageIndex = index;
    }
    if (lastAssistantMessageIndex === -1 && messages[index]?.role === "assistant") {
      lastAssistantMessageIndex = index;
    }
    if (lastUserMessageIndex !== -1 && lastAssistantMessageIndex !== -1) {
      break;
    }
  }

  const isGenerating = messages.some((m) => m.status === "streaming");

  const handleImageLoad = useCallback(() => {
    if (followingRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  const renderMessage = useCallback(
    (message: ChatMessage, index: number) => (
      <li className={`message-list__item message-list__item--${message.role}`} key={message.id}>
        <MessageBubble
          imageUrl={message.imageId === undefined ? undefined : imageUrls?.get(message.imageId)}
          locale={locale}
          message={message}
          onImageLoad={handleImageLoad}
          showSources={showSources}
          onRecall={message.role === "user" && index === lastUserMessageIndex ? onRecall : undefined}
          onRegenerate={message.role === "assistant" ? onRegenerate : undefined}
          onEdit={message.role === "user" ? onEdit : undefined}
          versions={switchableVersions(conversation, message)}
          onVersionChange={onVersionChange}
          onToast={onToast}
          isLastAssistant={message.role === "assistant" && index === lastAssistantMessageIndex}
          isGenerating={isGenerating}
          pendingPermission={index === lastAssistantMessageIndex ? pendingPermission : undefined}
          pendingToolName={index === lastAssistantMessageIndex ? pendingToolName : undefined}
        />
      </li>
    ),
    [handleImageLoad, imageUrls, lastUserMessageIndex, lastAssistantMessageIndex, isGenerating, locale, onRecall, onRegenerate, onToast, showSources, onEdit, onVersionChange, conversation, pendingPermission, pendingToolName],
  );

  const skillsCard =
    activeSkills !== undefined && activeSkills.length > 0 ? (
      <li className="message-list__item message-list__item--skills" key="context-skills">
        <details className="skills-card">
          <summary className="skills-card__summary">
            <div className="skills-card__summary-main">
              <Sparkles aria-hidden="true" size={14} className="skills-card__icon" />
              <span className="skills-card__title">
                {locale === "ja-JP" ? "有効化されたスキル" : "已加载技能"}
              </span>
              <span className="skills-card__badge">{activeSkills.length}</span>
            </div>
            <div className="skills-card__pill-row">
              {activeSkills.map((s) => (
                <span key={s.id} className="skills-card__pill" title={s.description}>
                  {s.name}
                </span>
              ))}
            </div>
          </summary>
          <div className="skills-card__body">
            <ul className="skills-card__list">
              {activeSkills.map((s) => (
                <li key={s.id} className="skills-card__item">
                  <div className="skills-card__item-meta">
                    <strong className="skills-card__item-name">{s.name}</strong>
                    <span className="skills-card__item-desc">{s.description}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </li>
    ) : null;

  const memoryCard = summary ? (
    <li className="message-list__item message-list__item--memory" key="context-memory">
      <details className="memory-card">
        <summary className="memory-card__summary">
          <Sparkles aria-hidden="true" size={15} />
          <span>{copyFor(locale).memoryLabel}</span>
        </summary>
        <div className="memory-card__body">
          <p>{summary}</p>
        </div>
      </details>
    </li>
  ) : null;

  const loadEarlierEntry =
    hasMoreHistory && onLoadEarlier !== undefined && messages.length > 0 && !virtualizationEnabled ? (
      <li className="message-list__item message-list__item--load-earlier" key="load-earlier">
        <button className="load-earlier" onClick={() => void onLoadEarlier()} type="button">
          {copyFor(locale).loadEarlierLabel}
        </button>
      </li>
    ) : null;

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <section
      ref={containerRef}
      className="conversation-view"
      onScroll={(event) => {
        const target = event.currentTarget;
        followingRef.current = isNearBottom(target);
        syncTopScrimOpacity(target, onScrolledFromTopChange);
      }}
    >
      <ol aria-live="polite" aria-relevant="additions text" className="message-list" role="log">
        {skillsCard}
        {memoryCard}
        {loadEarlierEntry}
        {virtualizationEnabled ? (
          <li className="message-list__item message-list__item--viewport">
            <div
              style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
            >
              {virtualItems.map((virtualItem) => {
                const message = messages[virtualItem.index];
                if (message === undefined) return null;
                return (
                  <div
                    data-index={virtualItem.index}
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    style={{
                      left: 0,
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${virtualItem.start}px)`,
                      width: "100%",
                    }}
                  >
                    {renderMessage(message, virtualItem.index)}
                  </div>
                );
              })}
            </div>
          </li>
        ) : (
          messages.map(renderMessage)
        )}
        <li ref={endRef} aria-hidden="true" className="message-list__end" />
      </ol>
    </section>
  );
}
