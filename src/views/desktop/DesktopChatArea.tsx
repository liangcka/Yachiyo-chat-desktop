import {
  ArrowUp,
  Camera,
  Check,
  Globe,

  PanelLeft,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  Square,
  Terminal,
  WifiOff,
  X,
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMeter } from "../../components/ContextMeter";
import { ConversationView } from "../../components/ConversationView";
import { ModelSelect } from "../../components/desktop/ModelSelect";
import { PlanStrip } from "../../components/desktop/PlanStrip";
import { ProjectSelector } from "../../components/desktop/ProjectSelector";
import { PermissionCard } from "../../components/tools/PermissionCard";
import { extractLatestTodos } from "../../domain/chat";
import { isRetryableChatErrorCode } from "../../services/chat-client";
import { SKILLS } from "../../skills";

import { controllerErrorMessage, type SharedViewProps } from "../layout-types";
import type { SettingsTabKey } from "../../components/settings/SettingsModal";

export interface DesktopChatAreaProps extends SharedViewProps {
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onRenameConversation?: (id: string, title: string) => Promise<void>;
  onToggleSidebar?: () => void;
  resolvedTheme?: "light" | "dark";
  sidebarCollapsed?: boolean;
}

export function DesktopChatArea({
  activeProviderSupportsImage,
  activeSkillIds = [],
  composerValue,
  controller,
  copy,
  imageUrls,
  isOnline,
  llmActiveProvider,
  llmEntries,
  onImage,
  onLlmActivate,
  onNewChat,
  onOpenSettings,
  onRecall,
  onRegenerate,
  onRenameConversation,
  onSend,
  onSkillToggle,
  onToggleSidebar,
  pendingImageDataUrl,
  processImage,
  setComposerValue,
  setPendingImageDataUrl,
  showToast,
  sidebarCollapsed = false,
  webSearchSettings,
}: DesktopChatAreaProps) {
  const currentTitle = controller.activeConversation?.title || copy.newChat;
  const pendingPermission = controller.pendingPermission;
  const isStreaming = controller.phase === "streaming";
  const isCompressing = controller.phase === "compressing";
  const isOffline = !isOnline || controller.phase === "offline";
  const isBlank = controller.messages.length === 0 && !controller.activeConversation?.summary;

  const latestTodos = useMemo(
    () => extractLatestTodos(controller.messages),
    [controller.messages],
  );


  // 顶栏标题即地编辑状态

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 技能快捷面板状态
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false);
  const skillPopoverRef = useRef<HTMLDivElement>(null);

  const activeSkills = useMemo(
    () => SKILLS.filter((skill) => activeSkillIds.includes(skill.id)),
    [activeSkillIds],
  );

  useEffect(() => {
    if (!skillPopoverOpen) return;
    const handlePointerDownDoc = (e: MouseEvent | PointerEvent) => {
      if (skillPopoverRef.current && !skillPopoverRef.current.contains(e.target as Node)) {
        setSkillPopoverOpen(false);
      }
    };
    const handleKeyDownDoc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setSkillPopoverOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDownDoc, true);
    document.addEventListener("keydown", handleKeyDownDoc);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownDoc, true);
      document.removeEventListener("keydown", handleKeyDownDoc);
    };
  }, [skillPopoverOpen]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

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

  const handleStartEditTitle = () => {
    if (!controller.activeConversation) return;
    setEditingTitleDraft(currentTitle);
    setIsEditingTitle(true);
  };

  const handleSaveTitle = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!controller.activeConversation || !editingTitleDraft.trim()) {
      setIsEditingTitle(false);
      return;
    }
    if (onRenameConversation) {
      await onRenameConversation(controller.activeConversation.id, editingTitleDraft.trim());
    }
    setIsEditingTitle(false);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const processed = await processImage(file);
      onImage(processed);
    } catch {
      showToast(copy.imageInvalid, "error");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.defaultPrevented || isOffline || isStreaming || isCompressing || !onImage) return;
    const items = event.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            try {
              const processed = await processImage(file);
              onImage(processed);
            } catch {
              showToast(copy.imageInvalid, "error");
            }
            return;
          }
        }
      }
    }
  };

  const composerNode = (
    <div className="desktop-composer-dock__inner">
      {/* 项目选择与新建项目下拉菜单放置在输入框左上角外部 */}
      <div className="desktop-composer-context-row">
        <ProjectSelector
          variant="composer"
          onOpenSettings={() => onOpenSettings?.("project")}
          onNewChat={onNewChat}
        />
        {controller.agentEnabled ? (
          <button
            type="button"
            className="desktop-composer-agent-badge"
            title="Agent 模式已开启：八千代可主动探查工程并执行任务（点击可切换）"
            onClick={controller.toggleAgent}
            aria-label="Agent 模式已开启"
          >
            <span className="desktop-composer-agent-badge__dot" />
            Agent 模式
          </button>
        ) : null}
      </div>

      {/* Agent 写类工具的授权卡片：从输入框上方平滑拉起的精致操作子容器 */}
      {pendingPermission !== undefined ? (
        <PermissionCard
          argumentsJson={pendingPermission.argumentsJson}
          toolName={pendingPermission.toolName}
          onApprove={(sessionScope) => {
            void controller.approvePermission(pendingPermission.requestId, true, sessionScope);
          }}
          onDeny={() => {
            void controller.approvePermission(pendingPermission.requestId, false);
          }}
        />
      ) : null}

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

      {/* 输入框主卡片 */}
      <div className="dsh-composer-card">
        {/* 隐藏的图片上传 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />

        {/* 图片附件预览轨道 */}
        {pendingImageDataUrl || controller.pendingImage ? (
          <div className="dsh-composer-card__attachment">
            <img
              src={pendingImageDataUrl || "blob:mock-image"}
              alt="待发送图片"
              className="dsh-composer-card__attachment-img"
            />
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
            onPaste={handlePaste}
            placeholder={isOffline ? copy.offline : copy.inputHint}
            disabled={isOffline || isCompressing}
            rows={1}
          />
        </div>

        {/* 底部工具行：左侧功能 + 右侧模型选择 / ContextMeter / 34px 发送按钮 */}
        <div className="dsh-composer-card__toolbar">
          <div className="dsh-composer-card__tools-left">
            {/* 附件/图片上传与指令唤起按钮 */}
            <button
              type="button"
              className="dsh-composer-card__add-btn"
              title={copy.capture}
              aria-label={copy.capture}
              onClick={() => fileInputRef.current?.click()}
              disabled={isOffline || isStreaming || isCompressing || !activeProviderSupportsImage}
            >
              <Plus size={15} />
            </button>

            <button
              type="button"
              className="dsh-composer-card__slash-btn"
              title="输入 / 查看快捷指令"
              aria-label="快捷指令"
              onClick={() => {
                if (composerValue.startsWith("/")) {
                  setComposerValue("");
                } else {
                  setComposerValue("/" + composerValue);
                }
                textareaRef.current?.focus();
              }}
            >
              <span>/</span>
            </button>

            {webSearchSettings.enabled ? (
              <span className="dsh-chip dsh-chip--active" title="联网搜索已启用">
                <Globe size={12} />
                <span>联网搜索</span>
              </span>
            ) : null}

            <button
              aria-label="Agent 模式开关"
              aria-pressed={controller.agentEnabled}
              className={controller.agentEnabled ? "desktop-toggle desktop-toggle--active" : "desktop-toggle"}
              onClick={controller.toggleAgent}
              title="Agent 模式：八千代多步读写工作区"
              type="button"
            >
              Agent
            </button>

            {/* 技能快捷配置胶囊与浮窗 */}
            <div className="dsh-skill-trigger-wrapper" ref={skillPopoverRef}>
              <button
                type="button"
                className={`desktop-toggle ${activeSkillIds.length > 0 ? "desktop-toggle--active" : ""}`}
                onClick={() => setSkillPopoverOpen((prev) => !prev)}
                title={
                  activeSkillIds.length > 0
                    ? `已加载 ${activeSkillIds.length} 项技能 (点击展开配置)`
                    : "加载技能 (点击配置)"
                }
                aria-label="技能快捷配置"
                aria-expanded={skillPopoverOpen}
              >
                <Sparkles size={12} />
                <span>技能</span>
                {activeSkillIds.length > 0 ? (
                  <span className="dsh-skill-count-badge">{activeSkillIds.length}</span>
                ) : null}
              </button>

              {skillPopoverOpen ? (
                <div className="dsh-skill-popover" role="dialog" aria-label="快捷加载技能">
                  <div className="dsh-skill-popover__header">
                    <div className="dsh-skill-popover__title">
                      <Sparkles size={13} />
                      <span>加载技能</span>
                    </div>
                    <button
                      type="button"
                      className="dsh-skill-popover__close"
                      onClick={() => setSkillPopoverOpen(false)}
                      title="关闭"
                      aria-label="关闭技能面板"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <ul className="dsh-skill-popover__list">
                    {SKILLS.map((skill) => {
                      const isActive = activeSkillIds.includes(skill.id);
                      return (
                        <li key={skill.id} className="dsh-skill-popover__item">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isActive}
                            onClick={() => {
                              if (onSkillToggle) {
                                void onSkillToggle(skill.id, !isActive);
                              }
                            }}
                            className="dsh-skill-popover__btn"
                          >
                            <span className={`dsh-skill-popover__checkbox-custom ${isActive ? "dsh-skill-popover__checkbox-custom--checked" : ""}`}>
                              {isActive ? <Check size={11} strokeWidth={3} /> : null}
                            </span>
                            <div className="dsh-skill-popover__item-meta">
                              <span className="dsh-skill-popover__item-name">{skill.name}</span>
                              <span className="dsh-skill-popover__item-desc">{skill.description}</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {onOpenSettings ? (
                    <div className="dsh-skill-popover__footer">
                      <button
                        type="button"
                        className="dsh-skill-popover__more-btn"
                        onClick={() => {
                          setSkillPopoverOpen(false);
                          onOpenSettings("custom");
                        }}
                      >
                        管理全部技能 &rarr;
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="dsh-composer-card__tools-right">
            {/* 模型选择器紧挨着发送按钮 */}
            <ModelSelect
              activeProvider={llmActiveProvider}
              entries={llmEntries}
              onSelect={(provider) => {
                void onLlmActivate(provider);
              }}
              onOpenSettings={() => {
                onOpenSettings?.("models");
              }}
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
                title={`${copy.send} (Enter)`}
                aria-label={copy.send}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="desktop-main-chat" aria-label="核心对话工作台">
      {/* 顶栏：侧栏开关 | 会话标题（支持即地编辑） | 状态徽章 | 截图 / 工作区 / 设置 */}
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

          {/* 会话标题（支持点击即地编辑重命名） */}
          {isEditingTitle ? (
            <form onSubmit={(e) => void handleSaveTitle(e)} className="desktop-chat-header__rename-form">
              <input
                ref={titleInputRef}
                type="text"
                value={editingTitleDraft}
                onChange={(e) => setEditingTitleDraft(e.target.value)}
                onBlur={() => void handleSaveTitle()}
                className="desktop-chat-header__rename-input"
                aria-label="重命名当前会话"
              />
              <button type="submit" className="desktop-chat-header__rename-btn" title={copy.confirm}>
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => setIsEditingTitle(false)}
                className="desktop-chat-header__rename-btn"
                title={copy.cancel}
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <div className="desktop-chat-header__title-wrapper">
              <button
                type="button"
                className="desktop-chat-header__title-btn"
                title={`${currentTitle} (点击重命名)`}
                onClick={handleStartEditTitle}
              >
                <h2 className="desktop-chat-header__title">{currentTitle}</h2>
              </button>
              {controller.activeConversation ? (
                <button
                  type="button"
                  className="desktop-chat-header__title-edit-btn"
                  onClick={handleStartEditTitle}
                  title="重命名会话"
                  aria-label="重命名会话"
                >
                  <Pencil size={12} />
                </button>
              ) : null}
            </div>
          )}

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
      </header>

      {/* 消息流与 Hero 区域 */}
      <div className="desktop-chat-body">
        {isBlank ? (
          <div className="desktop-hero" role="region" aria-label="欢迎体验">
            {/* 极简大标题 */}
            <div className="desktop-hero__headline">
              <span className="desktop-hero__icon-halo" aria-hidden="true">
                <Sparkles size={20} />
              </span>
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

            {/* 新对话居中对话框输入区域 */}
            <div className="desktop-hero__composer">
              {composerNode}
            </div>

            {/* 4 个等宽轻量化快捷引导卡片 */}
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

              <button
                type="button"
                className="desktop-hero-card"
                onClick={() => handleHeroPrompt("八千代，请向我介绍一下你支持哪些视觉与图片分析功能？")}
              >
                <div className="desktop-hero-card__icon">
                  <Camera size={17} />
                </div>
                <div className="desktop-hero-card__content">
                  <strong className="desktop-hero-card__title">视觉与图片分析</strong>
                  <span className="desktop-hero-card__desc">多模态图像识别、代码抓取与解析</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <ConversationView
            activeSkills={activeSkills}
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

      {/* Agent 任务待办清单 PlanStrip：对齐 DSH todo-write 任务呈现 */}
      {latestTodos && latestTodos.length > 0 ? (
        <PlanStrip todos={latestTodos} />
      ) : null}


      {/* 底部锚定输入交互区（仅在有消息时渲染） */}
      {!isBlank ? (
        <div className="desktop-composer-dock">
          {composerNode}
        </div>
      ) : null}
    </main>
  );
}
