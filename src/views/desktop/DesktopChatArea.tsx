import {
  ArrowUp,
  FolderCode,
  Globe,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Square,
  Terminal,
  WifiOff,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { ContextMeter } from "../../components/ContextMeter";
import { ConversationView } from "../../components/ConversationView";
import { ModelSelect } from "../../components/desktop/ModelSelect";
import { CaptureButton } from "../../features/capture/CaptureButton";
import { isRetryableChatErrorCode } from "../../services/chat-client";
import { controllerErrorMessage, imageErrorMessage, type SharedViewProps } from "../layout-types";
import type { DesktopRightTab } from "./DesktopSidebar";

export interface DesktopChatAreaProps extends SharedViewProps {
  activeRightTab: DesktopRightTab;
  onToggleSidebar?: () => void;
  onToggleWorkspace: () => void;
  resolvedTheme?: "light" | "dark";
  sidebarCollapsed?: boolean;
}

export function DesktopChatArea({
  activeRightTab,
  activeProviderSupportsImage,
  composerValue,
  controller,
  copy,
  imageUrls,
  isOnline,
  llmActiveProvider,
  llmEntries,
  onImage,
  onLlmActivate,
  onRecall,
  onRegenerate,
  onSend,
  onToggleSidebar,
  onToggleWorkspace,
  pendingImageDataUrl,
  processImage,
  setComposerValue,
  setPendingImageDataUrl,
  showToast,
  sidebarCollapsed = false,
  webSearchSettings,
}: DesktopChatAreaProps) {
  const currentTitle = controller.activeConversation?.title || copy.newChat;
  const isStreaming = controller.phase === "streaming";
  const isCompressing = controller.phase === "compressing";
  const isOffline = !isOnline || controller.phase === "offline";
  const isBlank = controller.messages.length === 0 && !controller.activeConversation?.summary;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整输入框高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 40), 280);
    el.style.height = `${nextHeight}px`;
  }, [composerValue]);

  const handleHeroPrompt = (text: string) => {
    onSend(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isStreaming && !isCompressing && !isOffline && (composerValue.trim() || pendingImageDataUrl)) {
        onSend(composerValue);
      }
    }
  };

  return (
    <main className="desktop-main-chat" aria-label="核心对话工作台">
      {/* 顶栏：侧栏开关 | 会话标题 | 状态徽章 | 截图 / 工作区 */}
      <header className="desktop-chat-header">
        <div className="desktop-chat-header__lead">
          {onToggleSidebar ? (
            <button
              type="button"
              className="desktop-chat-header__icon-btn"
              onClick={onToggleSidebar}
              title="切换侧边栏 (Ctrl+[)"
              aria-label="切换侧边栏"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeft size={18} />}
            </button>
          ) : null}

          <h2 className="desktop-chat-header__title" title={currentTitle}>
            {currentTitle}
          </h2>
          <div className="desktop-chat-header__badges">
            {isOffline ? (
              <span className="desktop-status-pill desktop-status-pill--offline">
                <WifiOff size={12} /> {copy.offline}
              </span>
            ) : isCompressing ? (
              <span className="desktop-status-pill desktop-status-pill--compressing">
                <Sparkles size={12} /> {copy.compressingContext}
              </span>
            ) : isStreaming ? (
              <span className="desktop-status-pill desktop-status-pill--streaming">
                <span className="desktop-status-pill__dot" /> 思考与生成中...
              </span>
            ) : (
              <span className="desktop-status-pill desktop-status-pill--ready">就绪</span>
            )}
            {webSearchSettings.enabled ? (
              <span className="desktop-status-pill desktop-status-pill--search" title="已开启联网搜索">
                <Globe size={11} /> 联网搜索
              </span>
            ) : null}
          </div>
        </div>

        <div className="desktop-chat-header__actions">
          <CaptureButton
            copy={copy}
            disabled={isOffline || isStreaming || isCompressing || !activeProviderSupportsImage}
            onError={(code) => showToast(imageErrorMessage(code, copy), "error")}
            onImage={onImage}
            process={processImage}
          />

          <button
            type="button"
            className={`desktop-chat-header__btn ${activeRightTab !== "none" ? "desktop-chat-header__btn--active" : ""}`}
            onClick={onToggleWorkspace}
            title={activeRightTab !== "none" ? "收起右侧工作台 (Ctrl+B)" : "展开右侧工作台 (Ctrl+B)"}
          >
            <FolderCode size={15} />
            <span>工作区</span>
            <kbd className="desktop-chat-header__kbd">^B</kbd>
          </button>
        </div>
      </header>

      {/* 消息流与 Hero 区域 */}
      <div className="desktop-chat-body">
        {isBlank ? (
          <div className="desktop-hero" role="region" aria-label="欢迎体验">
            {/* 极简大标题 */}
            <div className="desktop-hero__headline">
              <span className="desktop-hero__title">
                {controller.locale === "ja-JP" ? "月見八千代" : "月见八千代"}
              </span>
              <span className="desktop-hero__badge">PREVIEW</span>
            </div>

            <p className="desktop-hero__subtitle">
              {controller.locale === "ja-JP"
                ? "いつでもあなたのそばに。コード開発、日常対話、画像認識、何でも手伝うよ！"
                : "全能智能体工作台：代码开发、角色日常、视觉识图与联网检索助理。"}
            </p>

            {/* 探索提示卡片 */}
            <div className="desktop-hero__cards">
              <button
                type="button"
                className="desktop-hero-card"
                onClick={() => handleHeroPrompt("八千代，请帮我查看当前工作区根目录下有哪些文件和文件夹，向我简要介绍一下。")}
              >
                <div className="desktop-hero-card__icon">
                  <Terminal size={17} />
                </div>
                <div className="desktop-hero-card__content">
                  <strong className="desktop-hero-card__title">查看工作区代码</strong>
                  <span className="desktop-hero-card__desc">检索当前工作区项目结构与核心实现</span>
                </div>
              </button>

              <button
                type="button"
                className="desktop-hero-card"
                onClick={() => handleHeroPrompt("八千代，今天有什么有趣的事情发生吗？陪我聊聊天吧~")}
              >
                <div className="desktop-hero-card__icon">
                  <Sparkles size={17} />
                </div>
                <div className="desktop-hero-card__content">
                  <strong className="desktop-hero-card__title">日常陪伴与闲聊</strong>
                  <span className="desktop-hero-card__desc">月见八千代温暖的角色对话与互动</span>
                </div>
              </button>

              <button
                type="button"
                className="desktop-hero-card"
                onClick={() => handleHeroPrompt("八千代，请帮我搜索关于 DeepSeek 最新开源进展和技术动态。")}
              >
                <div className="desktop-hero-card__icon">
                  <Globe size={17} />
                </div>
                <div className="desktop-hero-card__content">
                  <strong className="desktop-hero-card__title">联网探索与研究</strong>
                  <span className="desktop-hero-card__desc">多渠道级联容灾检索最新外部资讯</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <ConversationView
            hasMoreHistory={controller.hasMoreHistory}
            imageUrls={imageUrls}
            key={controller.activeConversation?.id}
            locale={controller.locale}
            messages={controller.messages}
            onLoadEarlier={() => void controller.loadEarlier()}
            onRecall={onRecall}
            onRegenerate={isOffline || isStreaming || isCompressing ? undefined : onRegenerate}
            onToast={showToast}
            showSources={webSearchSettings.showSources}
            summary={controller.activeConversation?.summary}
          />
        )}
      </div>

      {/* 底部 22px 浮动胶囊 Composer（严格对齐 deepseek-harness InputBar） */}
      <div className="desktop-composer-dock">
        <div className="desktop-composer-dock__inner">
          {isOffline ? <p className="status-banner">{copy.offline}</p> : null}
          {controller.phase === "error" &&
          controller.errorCode !== "DAILY_QUOTA_EXCEEDED" &&
          controller.errorCode !== "SESSION_REQUIRED" ? (
            <div className="status-banner status-banner--error">
              <span>{controllerErrorMessage(controller.errorCode ?? "", copy)}</span>
              {isRetryableChatErrorCode(controller.errorCode) ? (
                <button onClick={() => void controller.retry()} type="button">
                  {copy.retry}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* 浮动卡片 */}
          <div className="dsh-composer-card">
            {/* 图片附件预览轨道 */}
            {pendingImageDataUrl ? (
              <div className="dsh-composer-card__attachment">
                <img src={pendingImageDataUrl} alt="待发送图片" className="dsh-composer-card__attachment-img" />
                <button
                  type="button"
                  className="dsh-composer-card__attachment-remove"
                  onClick={() => {
                    controller.setPendingImage(undefined);
                    setPendingImageDataUrl(undefined);
                  }}
                  title="移除图片"
                  aria-label="移除图片"
                >
                  &times;
                </button>
              </div>
            ) : null}

            {/* 输入文本框 */}
            <div className="dsh-composer-card__input-box">
              <textarea
                ref={textareaRef}
                className="dsh-composer-card__textarea"
                value={composerValue}
                onChange={(e) => setComposerValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isOffline ? copy.offline : isBlank ? "问点什么，或者输入 / 查看可用指令..." : "给八千代发送消息..."}
                disabled={isOffline || isCompressing}
                rows={1}
              />
            </div>

            {/* 底部工具行：左侧功能 + 右侧模型选择 / ContextMeter / 34px 发送按钮 */}
            <div className="dsh-composer-card__toolbar">
              <div className="dsh-composer-card__tools-left">
                <button
                  type="button"
                  className="dsh-composer-card__add-btn"
                  title="添加工具 / 指令"
                  aria-label="添加指令"
                  onClick={() => {
                    if (composerValue.startsWith("/")) {
                      setComposerValue("");
                    } else {
                      setComposerValue("/" + composerValue);
                    }
                  }}
                >
                  <Plus size={14} />
                </button>

                {webSearchSettings.enabled ? (
                  <span className="dsh-chip dsh-chip--active" title="联网搜索已启用">
                    <Globe size={12} />
                    <span>联网搜索</span>
                  </span>
                ) : null}
              </div>

              <div className="dsh-composer-card__tools-right">
                {/* 模型选择器 */}
                <ModelSelect
                  activeProvider={llmActiveProvider}
                  entries={llmEntries}
                  onSelect={(provider) => {
                    void onLlmActivate(provider);
                  }}
                  onOpenSettings={onToggleWorkspace}
                  disabled={isOffline || isStreaming}
                />

                {/* 上下文用量指示器 */}
                <ContextMeter messages={controller.messages} />

                {/* 发送 / 停止 按钮（34px 纯蓝圆形） */}
                {isStreaming ? (
                  <button
                    type="button"
                    className="dsh-composer-card__send-btn dsh-composer-card__send-btn--stop"
                    onClick={controller.stop}
                    title={copy.stop}
                    aria-label={copy.stop}
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dsh-composer-card__send-btn"
                    onClick={() => {
                      if (composerValue.trim() || pendingImageDataUrl) {
                        onSend(composerValue);
                      }
                    }}
                    disabled={isOffline || isCompressing || (!composerValue.trim() && !pendingImageDataUrl)}
                    title="发送 (Enter)"
                    aria-label="发送消息"
                  >
                    <ArrowUp size={16} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
