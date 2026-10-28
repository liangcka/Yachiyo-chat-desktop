import {
  ArrowUp,
  Check,
  ChevronRight,
  Globe,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextMeter } from "../../components/ContextMeter";
import { ConversationView } from "../../components/ConversationView";
import { ModelSelect } from "../../components/desktop/ModelSelect";
import { ModeSelect } from "../../components/desktop/ModeSelect";
import { PlanStrip } from "../../components/desktop/PlanStrip";
import { ReasoningEffortSelect } from "../../components/desktop/ReasoningEffortSelect";
import { ProjectSelector } from "../../components/desktop/ProjectSelector";
import { ConversationProjectBar } from "../../components/desktop/ConversationProjectBar";
import { BindProjectContext, FollowUpContext, StopCommandContext } from "../../components/chat/review-context";
import { PermissionCard } from "../../components/tools/PermissionCard";
import { appendAttachments, COMPOSER_CHARACTER_LIMIT, readTextAttachment, type TextAttachment } from "../../features/file-reference/attachments";
import { extractLatestTodos, runWorkspaceFor, workspaceBinding } from "../../domain/chat";
import { copyFor } from "../../i18n/messages";
import { isRetryableChatErrorCode } from "../../services/chat-client";
import { SKILLS, skillLabel } from "../../skills";

import { controllerErrorMessage, type SharedViewProps } from "../layout-types";
import type { SettingsTabKey } from "../../components/settings/SettingsModal";
import { FileReferencePicker } from "../../components/chat/FileReferencePicker";
import {
  SlashCommandPicker,
  type SlashCommandPickerHandle,
  type SlashActionItem,
  type SlashItem,
} from "../../components/chat/SlashCommandPicker";
import { isDesktopApp } from "../../services/app-platform";
import { searchWorkspaceFiles } from "../../services/desktop-bridge";
import { getProjectDisplayName, projectManager, useProjectState } from "../../services/project-manager";
import "../../styles/desktop-chat-area.css";
import { DesktopWelcome } from "./DesktopWelcome";
import { useComposerDockTransition } from "./use-composer-dock-transition";

export interface DesktopChatAreaProps extends SharedViewProps {
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onRenameConversation?: (id: string, title: string) => Promise<void>;
  onToggleSidebar?: () => void;
  onToggleRightPane?: () => void;
  rightPaneOpen?: boolean;
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
  llmActiveEntryId,
  llmEntries,
  onImage,
  onLlmActivate,
  onNewChat,
  onOpenSettings,
  onRecall,
  onRegenerate,
  onSend,
  onSkillToggle,
  onWebSearchSettingsChange,
  pendingImageDataUrl,
  processImage,
  setComposerValue,
  setPendingImageDataUrl,
  showToast,
  webSearchSettings,
}: DesktopChatAreaProps) {
  const pendingPermission = controller.pendingPermission;
  const isLoading = controller.phase === "loading";
  const isStreaming = controller.phase === "streaming";
  // 已请求取消、等待网关确认收尾：停止按钮不再可点，避免误以为已经停止
  const isCancelling = controller.activeConversation !== undefined
    && controller.runningConversations.get(controller.activeConversation.id) === "cancelling";
  const isCompressing = controller.phase === "compressing";
  const isOffline = !isOnline || controller.phase === "offline";
  // Agent 运行中输入的内容作为补充要求排队送达，不中断任务；普通对话仍是停止后发送
  const streamingMessage = isStreaming ? [...controller.messages].reverse().find((message) => message.role === "assistant" && message.status === "streaming") : undefined;
  const canSupplement = streamingMessage?.run !== undefined && streamingMessage.cancelRequested !== true;
  const composerUnavailable = isLoading || isOffline || isCompressing;
  const isJapanese = controller.locale === "ja-JP";
  const loadingLabel = isJapanese ? "会話を読み込み中…" : "正在加载对话…";
  const isBlank = controller.messages.length === 0 && !controller.activeConversation?.summary;
  // 桌面端没有服务端兜底模型：未配置时直接引导到设置，而不是发出必然失败的请求
  const activeLlmEntry = llmEntries.find((entry) => entry.id === llmActiveEntryId);
  const needsModelSetup = isDesktopApp() && activeLlmEntry === undefined;

  // 走与输入框相同的发送入口，但不带输入框里的附件
  const controllerLocale = controller.locale;
  const handleContinue = useCallback(() => {
    onSend(copyFor(controllerLocale).continuePrompt);
  }, [controllerLocale, onSend]);
  // 结果区的“继续处理”与重发未送达的补充：直接发给当前会话，不动输入框里正在写的内容
  const sendFollowUp = useCallback((text: string) => {
    void controller.send(text);
  }, [controller]);

  const latestTodos = useMemo(
    () => extractLatestTodos(controller.messages),
    [controller.messages],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 技能快捷面板状态
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const conversationId = controller.activeConversation?.id;
  const activeConversationIdRef = useRef(conversationId);
  useLayoutEffect(() => { activeConversationIdRef.current = conversationId; }, [conversationId]);
  const [attachmentDraft, setAttachmentDraft] = useState<{ conversationId?: string; files: TextAttachment[] }>({ files: [] });
  const attachments = attachmentDraft.conversationId === conversationId ? attachmentDraft.files : [];
  const setAttachments = (update: TextAttachment[] | ((files: TextAttachment[]) => TextAttachment[])): void => {
    setAttachmentDraft((previous) => ({ conversationId, files: typeof update === "function" ? update(previous.conversationId === conversationId ? previous.files : []) : update }));
  };
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false);
  const skillPopoverRef = useRef<HTMLDivElement>(null);

  const activeSkills = useMemo(
    () => SKILLS.filter((skill) => activeSkillIds.includes(skill.id)),
    [activeSkillIds],
  );

  useEffect(() => {
    if (!skillPopoverOpen && !addMenuOpen) return;
    const handleMouseDownDoc = (e: MouseEvent) => {
      if (skillPopoverRef.current && !skillPopoverRef.current.contains(e.target as Node)) {
        setSkillPopoverOpen(false);
        setAddMenuOpen(false);
      }
    };
    const handleKeyDownDoc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { setSkillPopoverOpen(false); setAddMenuOpen(false); }
    };
    document.addEventListener("mousedown", handleMouseDownDoc);
    document.addEventListener("keydown", handleKeyDownDoc);
    return () => {
      document.removeEventListener("mousedown", handleMouseDownDoc);
      document.removeEventListener("keydown", handleKeyDownDoc);
    };
  }, [skillPopoverOpen, addMenuOpen]);

  // 自动调整输入框高度
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 20), 280);
    el.style.height = `${nextHeight}px`;
  }, [composerValue]);

  const { composerRef, prepareTransition } = useComposerDockTransition(
    isBlank,
    controller.activeConversation?.id,
  );

  const submitSupplement = (text: string): void => {
    const content = appendAttachments(text, attachments);
    setComposerValue("");
    setAttachments([]);
    void controller.supplement(content).then((result) => {
      if (result === "unavailable") {
        setComposerValue(text);
        showToast(isJapanese ? "タスクの準備中のため追加できません。少し待つか、停止してから送信してください" : "任务尚未就绪，暂时不能追加补充；稍后再试，或停止后发送", "error");
      } else if (result === "undelivered") {
        showToast(isJapanese ? "タスクが終了処理中のため届きませんでした。メッセージの下から新しいメッセージとして送信できます" : "任务正在收尾，补充未送达；可在消息下方作为新消息发送", "error");
      }
    });
  };

  const sendMessage = (text: string): void => {
    if (canSupplement && !pendingImageDataUrl) {
      submitSupplement(text);
      return;
    }
    if (needsModelSetup) {
      showToast(copy.desktopKeyRequired, "error");
      onOpenSettings?.("models");
      return;
    }
    const content = appendAttachments(text, attachments);
    if (attachments.length > 0 && [...content].length > COMPOSER_CHARACTER_LIMIT) {
      showToast(
        isJapanese
          ? "本文と添付ファイルの合計が 20000 文字を超えています。一部を削除してから送信してください"
          : "正文与附件合计超过 20000 字，请移除部分内容后发送",
        "error",
      );
      return;
    }
    prepareTransition();
    onSend(content);
    setAttachments([]);
  };

  // @ 引用文件模糊搜索浮层状态
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState("");
  const [filePickerAtIndex, setFilePickerAtIndex] = useState(-1);
  const [filePickerItems, setFilePickerItems] = useState<string[]>([]);
  const [filePickerIndex, setFilePickerIndex] = useState(0);

  // / 快捷指令与技能浮层状态
  const [slashPickerOpen, setSlashPickerOpen] = useState(false);
  const [slashPickerQuery, setSlashPickerQuery] = useState("");
  const slashPickerRef = useRef<SlashCommandPickerHandle>(null);

  // 任务的项目归属：已有任务以记录为准，空白任务在提交时绑定当前选中的项目
  const { activeProject } = useProjectState();
  const binding = workspaceBinding(controller.activeConversation, !isBlank);
  const composerWorkspace = runWorkspaceFor(binding, activeProject);
  const bindingLocked = isStreaming || isCompressing || isLoading;
  const bindProject = useCallback(
    async (workspace: string) => {
      const bound = await controller.bindConversationWorkspace(workspace);
      const name = getProjectDisplayName(workspace, controller.locale);
      showToast(
        bound
          ? isJapanese ? `このタスクを ${name} に紐付けました` : `已将本任务绑定到 ${name}`
          : isJapanese ? "紐付けできませんでした。実行中のタスクや紐付け済みのタスクは変更できません" : "绑定失败：运行中或已绑定其他项目的任务不能更改项目",
        bound ? "info" : "error",
      );
    },
    [controller, isJapanese, showToast],
  );
  const pickAndBindProject = useCallback(async () => {
    const picked = await projectManager.pickAndOpenProject(isJapanese ? "プロジェクトを選択" : "选择项目");
    if (picked !== undefined) await bindProject(picked);
  }, [bindProject, isJapanese]);
  const requestProjectBinding = useCallback(() => {
    if (binding.kind === "legacy" || binding.kind === "none") void pickAndBindProject();
    else void projectManager.pickAndOpenProject(isJapanese ? "プロジェクトを選択" : "选择项目");
  }, [binding.kind, isJapanese, pickAndBindProject]);

  // 检索任务所属项目的文件列表；在 @ 浮层里选好项目后随之重新检索
  useEffect(() => {
    if (!filePickerOpen) return;
    let cancelled = false;
    void searchWorkspaceFiles(composerWorkspace, filePickerQuery, 25).then((results) => {
      if (cancelled) return;
      setFilePickerItems(results ?? []);
      setFilePickerIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [composerWorkspace, filePickerOpen, filePickerQuery]);

  const updatePickersTrigger = (text: string, cursorPos: number) => {
    const beforeCursor = text.slice(0, cursorPos);

    // 检查 @ 触发
    const atMatch = beforeCursor.match(/(?:^|\s)@([^\s]*)$/);
    if (atMatch && atMatch[1] !== undefined) {
      const q = atMatch[1];
      const atIdx = cursorPos - q.length - 1;
      setFilePickerOpen(true);
      setFilePickerQuery(q);
      setFilePickerAtIndex(atIdx);
      setSlashPickerOpen(false);
      return;
    }
    setFilePickerOpen(false);
    setFilePickerAtIndex(-1);

    // 检查 / 触发
    const slashMatch = beforeCursor.match(/(?:^|\s)\/([^\s]*)$/);
    if (slashMatch && slashMatch[1] !== undefined) {
      setSlashPickerOpen(true);
      setSlashPickerQuery(slashMatch[1]);
      return;
    }
    setSlashPickerOpen(false);
  };

  const handleSelectFileReference = (path: string) => {
    const el = textareaRef.current;
    const cursorPos = el ? el.selectionStart : composerValue.length;
    const atIdx = filePickerAtIndex >= 0 ? filePickerAtIndex : cursorPos;
    const before = composerValue.slice(0, atIdx);
    const after = composerValue.slice(cursorPos);
    const inserted = /\s/u.test(path) ? `@"${path}" ` : `@${path} `;
    const nextValue = `${before}${inserted}${after}`;
    setComposerValue(nextValue);
    setFilePickerOpen(false);
    setFilePickerAtIndex(-1);

    queueMicrotask(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const nextPos = before.length + inserted.length;
        textareaRef.current.setSelectionRange(nextPos, nextPos);
      }
    });
  };

  const slashActions = useMemo<SlashActionItem[]>(() => [
    {
      id: "action:agent",
      type: "action",
      name: isJapanese ? "Agentモード切り替え" : "切换 Agent 模式",
      command: "/agent",
      description: isJapanese
        ? `現在のモード：${controller.agentMode === "readonly" ? "読み取り" : controller.agentMode === "confirm" ? "自動" : "完全アクセス"} (クリックで切り替え)`
        : `当前模式：${controller.agentMode === "readonly" ? "只读" : controller.agentMode === "confirm" ? "自动" : "完全访问"} (点击切换)`,
      icon: "bot",
      onExecute: () => {
        controller.toggleAgent();
        const nextMode = controller.agentMode === "readonly"
          ? (isJapanese ? "自動" : "自动")
          : controller.agentMode === "confirm"
            ? (isJapanese ? "完全アクセス" : "完全访问")
            : (isJapanese ? "読み取り" : "只读");
        showToast(isJapanese ? `Agentモードを「${nextMode}」に切り替えました` : `已切换 Agent 模式为：${nextMode}`);
      },
    },
    {
      id: "action:web",
      type: "action",
      name: isJapanese ? "ウェブ検索の切り替え" : "切换联网搜索",
      command: "/web",
      description: isJapanese
        ? `現在の状態：${webSearchSettings.enabled ? "オン" : "オフ"}（クリックで切り替え）`
        : `当前状态：${webSearchSettings.enabled ? "已开启" : "已关闭"} (点击切换)`,
      icon: "globe",
      onExecute: () => {
        onWebSearchSettingsChange?.({ enabled: !webSearchSettings.enabled });
        showToast(
          webSearchSettings.enabled
            ? isJapanese ? "ウェブ検索をオフにしました" : "联网搜索已关闭"
            : isJapanese ? "ウェブ検索をオンにしました" : "联网搜索已开启",
        );
      },
    },
    {
      id: "action:new-chat",
      type: "action",
      name: isJapanese ? "新しい会話" : "新建对话",
      command: "/clear",
      description: isJapanese ? "ワークベンチをリセットして新しい会話を始めます" : "重置当前工作台并开启新对话",
      icon: "plus",
      onExecute: () => {
        void onNewChat();
      },
    },
  ], [controller, isJapanese, onNewChat, onWebSearchSettingsChange, showToast, webSearchSettings.enabled]);

  const handleSelectSlashItem = (item: SlashItem) => {
    if (item.type === "action") {
      item.onExecute();
    } else {
      const nextActive = !activeSkillIds.includes(item.skill.id);
      void onSkillToggle?.(item.skill.id, nextActive);
      showToast(
        nextActive
          ? isJapanese ? `スキル「${item.name}」を読み込みました` : `已加载「${item.name}」技能`
          : isJapanese ? `スキル「${item.name}」を外しました` : `已卸载「${item.name}」技能`,
      );
    }

    // 移除触发词 /xxx
    const el = textareaRef.current;
    const cursorPos = el ? el.selectionStart : composerValue.length;
    const beforeCursor = composerValue.slice(0, cursorPos);
    const slashIdx = beforeCursor.lastIndexOf("/");
    if (slashIdx >= 0) {
      const nextValue = composerValue.slice(0, slashIdx) + composerValue.slice(cursorPos);
      setComposerValue(nextValue);
      queueMicrotask(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(slashIdx, slashIdx);
        }
      });
    }
    setSlashPickerOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (filePickerOpen && filePickerItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFilePickerIndex((prev) => (prev + 1) % filePickerItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFilePickerIndex((prev) => (prev - 1 + filePickerItems.length) % filePickerItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filePickerItems[filePickerIndex] || filePickerItems[0];
        if (selected) {
          handleSelectFileReference(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setFilePickerOpen(false);
        return;
      }
    } else if (filePickerOpen && e.key === "Escape") {
      e.preventDefault();
      setFilePickerOpen(false);
      return;
    }

    if (slashPickerOpen && slashPickerRef.current?.handleKeyDown(e)) return;

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const hasContent = Boolean(composerValue.trim() || pendingImageDataUrl || attachments.length > 0);
      if (pendingPermission !== undefined) {
        if (hasContent && !composerUnavailable) {
          void controller.approvePermission(pendingPermission.requestId, false);
          sendMessage(composerValue);
        }
        return;
      }
      if (!composerUnavailable && hasContent) {
        sendMessage(composerValue);
      }
    }
  };


  const attachFiles = async (files: File[]): Promise<void> => {
    let addedCharacters = [...appendAttachments("", attachments)].length;
    for (const file of files.slice(0, 8)) {
      if (activeConversationIdRef.current !== conversationId) return;
      try {
        if (file.type.startsWith("image/")) {
          if (!activeProviderSupportsImage) { showToast(isJapanese ? "現在のモデルは画像に対応していません。モデルを切り替えてください" : "当前模型不支持图片，请先切换模型", "error"); continue; }
          const image = await processImage(file);
          if (activeConversationIdRef.current === conversationId) onImage(image);
        } else {
          const attachment = await readTextAttachment(file, controller.locale);
          if (activeConversationIdRef.current !== conversationId) return;
          addedCharacters += [...appendAttachments("", [attachment])].length;
          if (addedCharacters > COMPOSER_CHARACTER_LIMIT) { showToast(isJapanese ? "添付ファイルの合計が 20000 文字を超えています。分けて送信してください" : "附件合计超过 20000 字，请分批发送", "error"); break; }
          setAttachments((previous) => [...previous, attachment].slice(-8));
        }
      } catch (error) { showToast(error instanceof Error ? error.message : copy.imageInvalid, "error"); }
    }
  };
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await attachFiles(files);
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.defaultPrevented || composerUnavailable || !onImage) return;
    const items = event.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            await attachFiles([file]);
            return;
          }
        }
      }
    }
  };

  const composerNode = (
    <div className="desktop-composer-dock__inner" ref={composerRef}>
      {/* 写入操作在继续执行前需要授权。 */}
      {pendingPermission !== undefined ? (
        <PermissionCard
          key={pendingPermission.requestId}
          argumentsJson={pendingPermission.argumentsJson}
          toolName={pendingPermission.toolName}
          locale={controller.locale}
          onApprove={(sessionScope) => {
            return controller.approvePermission(pendingPermission.requestId, true, sessionScope);
          }}
          onDeny={() => {
            return controller.approvePermission(pendingPermission.requestId, false);
          }}
        />
      ) : null}

      {isOffline ? <p className="status-banner">{copy.offline}</p> : null}
      {controller.phase === "error" &&
      controller.errorCode !== "DAILY_QUOTA_EXCEEDED" &&
      controller.errorCode !== "SESSION_REQUIRED" ? (
        <div className="status-banner status-banner--error">
          <span>
            {controllerErrorMessage(controller.errorCode ?? "", copy)}
            {controller.errorDetail !== undefined ? <span className="status-banner__detail">{controller.errorDetail}</span> : null}
          </span>
          {isRetryableChatErrorCode(controller.errorCode) ? (
            <button onClick={() => void controller.retry()} type="button">
              {copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}

      {activeSkills.length > 0 || attachments.length > 0 ? <div className="dsh-composer-chips" aria-label={isJapanese ? "読み込み済みの内容" : "已加载内容"}>
        {activeSkills.map((skill) => <button type="button" key={skill.id} onClick={() => void onSkillToggle?.(skill.id, false)} title={isJapanese ? `スキル ${skillLabel(skill, controller.locale).name} を外す` : `移除技能 ${skill.name}`}>{skillLabel(skill, controller.locale).name}<X size={12} /></button>)}
        {attachments.map((file, index) => <button type="button" key={`${file.name}-${index}`} title={isJapanese ? `添付 ${file.name} を削除` : `移除附件 ${file.name}`} onClick={() => setAttachments((previous) => previous.filter((_, i) => i !== index))}>{file.name}<X size={12} /></button>)}
      </div> : null}
      {/* 空白对话时在输入框上方选择项目，首次提交即绑定该项目；已有任务展示其归属 */}
      {isBlank
        ? isDesktopApp()
          ? <ProjectSelector variant="composer" className="desktop-composer-project" onNewChat={onNewChat} />
          : <p className="desktop-composer-capability" role="note">{copy.webCapabilityNote}</p>
        : null}
      {!isBlank && isDesktopApp() ? (
        <ConversationProjectBar
          locale={controller.locale}
          binding={binding}
          activeProject={activeProject}
          disabled={bindingLocked}
          onBind={(workspace) => void bindProject(workspace)}
          onPickAndBind={() => void pickAndBindProject()}
        />
      ) : null}
      {/* 输入框主卡片 */}
      <div className="dsh-composer-card"
        onDragOver={(event) => { if (!composerUnavailable && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => { if (composerUnavailable) return; event.preventDefault(); void attachFiles(Array.from(event.dataTransfer.files)); }}>
        {/* @ 引用文件模糊搜索浮层 */}
        {filePickerOpen ? (
          <FileReferencePicker
            workspace={composerWorkspace}
            onSelectProject={requestProjectBinding}
            query={filePickerQuery}
            items={filePickerItems}
            selectedIndex={filePickerIndex}
            onSelectedIndexChange={setFilePickerIndex}
            onSelect={handleSelectFileReference}
            onClose={() => setFilePickerOpen(false)}
          />
        ) : null}

        {/* / 快捷指令与技能快速选择浮层 */}
        {slashPickerOpen ? (
          <SlashCommandPicker
            ref={slashPickerRef}
            locale={controller.locale}
            query={slashPickerQuery}
            skills={SKILLS}
            activeSkillIds={activeSkillIds}
            actions={slashActions}
            onSelect={handleSelectSlashItem}
            onToggleSkill={(id, next) => {
              void onSkillToggle?.(id, next);
            }}
            onClose={() => setSlashPickerOpen(false)}
          />
        ) : null}

        {/* 隐藏的图片上传 input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />

        {/* 图片附件预览轨道 */}
        {pendingImageDataUrl || controller.pendingImage ? (
          <div className="dsh-composer-card__attachment">
            <div className="dsh-composer-card__attachment-thumb">
              <img
                src={pendingImageDataUrl || "blob:mock-image"}
                alt={isJapanese ? "送信予定の画像" : "待发送图片"}
                className="dsh-composer-card__attachment-img"
              />
              <button
                type="button"
                className="dsh-composer-card__attachment-remove"
                onClick={() => {
                  controller.setPendingImage(undefined);
                  setPendingImageDataUrl(undefined);
                }}
                title={isJapanese ? "画像を削除" : "移除图片"}
                aria-label={isJapanese ? "画像を削除" : "移除图片"}
              >
                <X size={11} strokeWidth={2.6} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {/* 输入文本框 */}
        <div className="dsh-composer-card__input-box">
          <textarea
            ref={textareaRef}
            aria-label={copy.inputHint}
            className="dsh-composer-card__textarea"
            value={composerValue}
            onChange={(e) => {
              setComposerValue(e.target.value);
              updatePickersTrigger(e.target.value, e.target.selectionStart);
            }}
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                updatePickersTrigger(e.currentTarget.value, e.currentTarget.selectionStart);
              }
            }}
            onClick={(e) => {
              updatePickersTrigger(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isLoading ? loadingLabel : isOffline ? copy.offline : isCompressing ? copy.compressingContext : canSupplement ? copy.supplementHint : copy.inputHint}
            disabled={composerUnavailable}
            rows={1}
          />
        </div>

        {/* 控制入口集中在输入区，弹层向上展开。 */}
        <div className="dsh-composer-card__toolbar" role="group" aria-label={isJapanese ? "会話ツールバー" : "对话工具栏"}>
          <div className="dsh-composer-card__tools-left">
            <div className="dsh-skill-trigger-wrapper" ref={skillPopoverRef}>
              <button
                type="button"
                className="dsh-composer-card__add-btn"
                title={isJapanese ? "ファイル、プロジェクト、スキルを追加" : "添加文件、项目或技能"}
                aria-label={isJapanese ? "ファイル、プロジェクト、スキルを追加" : "添加文件、项目或技能"}
                aria-expanded={addMenuOpen || skillPopoverOpen}
                disabled={composerUnavailable}
                onClick={() => {
                  setAddMenuOpen(!addMenuOpen);
                  setSkillPopoverOpen(false);
                }}
              >
                <Plus size={15} />
              </button>
              {addMenuOpen && !skillPopoverOpen ? (
                <div className="dsh-skill-popover dsh-add-menu" role="dialog" aria-label={isJapanese ? "コンテンツを追加" : "添加内容"}>
                  <button
                    type="button"
                    className="dsh-add-menu__item"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setAddMenuOpen(false);
                    }}
                  >
                    <span className="dsh-add-menu__item-main">
                      <Paperclip size={14} />
                      <span>{isJapanese ? "ファイルまたは画像を追加" : "添加文件或图片"}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dsh-add-menu__item"
                    onClick={() => {
                      setSkillPopoverOpen(true);
                      setAddMenuOpen(false);
                    }}
                  >
                    <span className="dsh-add-menu__item-main">
                      <Sparkles size={14} />
                      <span>{isJapanese ? "スキルを読み込む" : "加载技能"}</span>
                    </span>
                    <ChevronRight size={14} className="dsh-add-menu__arrow" />
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={webSearchSettings.enabled}
                    className="dsh-add-menu__item dsh-add-menu__item--checkable"
                    onClick={() => {
                      onWebSearchSettingsChange?.({ enabled: !webSearchSettings.enabled });
                    }}
                  >
                    <span className="dsh-add-menu__item-main">
                      <Globe size={14} />
                      <span>{isJapanese ? "ウェブ検索" : "联网搜索"}</span>
                    </span>
                    <span
                      className={`dsh-skill-popover__checkbox-custom ${
                        webSearchSettings.enabled ? "dsh-skill-popover__checkbox-custom--checked" : ""
                      }`}
                    >
                      {webSearchSettings.enabled ? <Check size={11} /> : null}
                    </span>
                  </button>
                </div>
              ) : null}
              {skillPopoverOpen ? (
                <div className="dsh-skill-popover" role="dialog" aria-label={isJapanese ? "スキルを素早く読み込む" : "快捷加载技能"}>
                  <ul className="dsh-skill-popover__list">
                    {SKILLS.map((skill) => {
                      const isActive = activeSkillIds.includes(skill.id);
                      return (
                        <li key={skill.id} className="dsh-skill-popover__item">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isActive}
                            className="dsh-skill-popover__btn"
                            onClick={() => void onSkillToggle?.(skill.id, !isActive)}
                          >
                            <span
                              className={`dsh-skill-popover__checkbox-custom ${
                                isActive ? "dsh-skill-popover__checkbox-custom--checked" : ""
                              }`}
                            >
                              {isActive ? <Check size={11} /> : null}
                            </span>
                            <span className="dsh-skill-popover__item-meta">
                              <span className="dsh-skill-popover__item-name">{skillLabel(skill, controller.locale).name}</span>
                              <span className="dsh-skill-popover__item-desc">{skillLabel(skill, controller.locale).description}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="dsh-skill-popover__footer">
                    <button
                      type="button"
                      className="dsh-skill-popover__more-btn"
                      onClick={() => {
                        setSkillPopoverOpen(false);
                        onOpenSettings?.("custom");
                      }}
                    >
                      {isJapanese ? "全スキルを管理 →" : "管理全部技能 →"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 模型选择器 */}
            <ModelSelect
              activeEntryId={llmActiveEntryId}
              entries={llmEntries}
              onSelect={(id) => {
                void onLlmActivate(id);
              }}
              onOpenSettings={() => {
                onOpenSettings?.("models");
              }}
              disabled={composerUnavailable || isStreaming}
            />

            {/* 执行模式：只有桌面版能执行本地操作 */}
            {isDesktopApp() ? (
              <ModeSelect
                mode={controller.agentMode}
                onSelect={controller.setExecutionMode}
                disabled={isStreaming}
              />
            ) : null}
          </div>

          <div className="dsh-composer-card__tools-right">
            {/* 思考档位只由桌面网关映射到各厂商参数，Web 端不显示 */}
            {isDesktopApp() && activeLlmEntry !== undefined ? (
              <ReasoningEffortSelect
                model={{
                  provider: activeLlmEntry.provider,
                  model: activeLlmEntry.model,
                  ...(activeLlmEntry.baseUrl !== undefined ? { baseUrl: activeLlmEntry.baseUrl } : {}),
                }}
                onOpenModelSettings={() => onOpenSettings?.("models")}
                disabled={composerUnavailable}
              />
            ) : null}

            {/* 上下文用量指示器 */}
            <ContextMeter
              messages={controller.messages}
              compressedUpTo={controller.activeConversation?.compressedUpTo}
              summary={controller.activeConversation?.summary}
              locale={controller.locale}
              {...(activeLlmEntry?.custom?.contextWindow !== undefined
                ? { contextLimit: activeLlmEntry.custom.contextWindow }
                : {})}
            />

            {/* 生成期间保留停止入口。 */}
            {isStreaming && canSupplement && (composerValue.trim() || attachments.length > 0) && !pendingImageDataUrl ? (
              <button
                type="button"
                className="dsh-composer-card__send-btn dsh-composer-card__send-btn--stop"
                onClick={controller.stop}
                disabled={isCancelling}
                title={isCancelling ? copy.runCancelling : copy.stop}
                aria-label={isCancelling ? copy.runCancelling : copy.stop}
              >
                {isCancelling ? <Loader2 size={14} className="dsh-composer-card__spin" /> : <Square size={14} fill="currentColor" />}
              </button>
            ) : null}
            {isStreaming && !composerValue.trim() && attachments.length === 0 && !pendingImageDataUrl ? (
              <button
                type="button"
                className="dsh-composer-card__send-btn dsh-composer-card__send-btn--stop"
                onClick={controller.stop}
                disabled={isCancelling}
                title={isCancelling ? copy.runCancelling : copy.stop}
                aria-label={isCancelling ? copy.runCancelling : copy.stop}
              >
                {isCancelling ? <Loader2 size={14} className="dsh-composer-card__spin" /> : <Square size={14} fill="currentColor" />}
              </button>
            ) : (
              <button
                type="button"
                className="dsh-composer-card__send-btn"
                onClick={() => {
                  if (!composerUnavailable && (composerValue.trim() || pendingImageDataUrl || attachments.length > 0)) {
                    sendMessage(composerValue);
                  }
                }}
                disabled={composerUnavailable || (!composerValue.trim() && !pendingImageDataUrl && attachments.length === 0)}
                title={`${isStreaming ? (canSupplement && !pendingImageDataUrl ? copy.supplementSend : isJapanese ? "現在の返信を止めて追加の指示を送信" : "停止当前回复并发送补充要求") : copy.send} (Enter)`}
                aria-label={isStreaming && canSupplement && !pendingImageDataUrl ? copy.supplementSend : copy.send}
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
    <main className="desktop-main-chat" aria-label={isJapanese ? "会話ワークベンチ" : "核心对话工作台"}>
      {/* 消息流与 Hero 区域 */}
      <div className={`desktop-chat-body ${isBlank ? "desktop-chat-body--welcome" : ""}`}>
        {isBlank ? (
          <DesktopWelcome
            locale={controller.locale}
            needsModelSetup={needsModelSetup}
            onSetupModel={() => onOpenSettings?.("models")}
          />
        ) : (
          <div className="desktop-conversation-region">
            <BindProjectContext.Provider value={requestProjectBinding}>
            <StopCommandContext.Provider value={controller.stopToolCall}>
            <FollowUpContext.Provider value={isOffline || isCompressing || isStreaming ? undefined : sendFollowUp}>
              <ConversationView
                activeSkills={activeSkills}
                hasMoreHistory={controller.hasMoreHistory}
                imageUrls={imageUrls}
                key={controller.activeConversation?.id}
                locale={controller.locale}
                messages={controller.messages}
                pendingPermission={pendingPermission ? { toolName: pendingPermission.toolName, argumentsJson: pendingPermission.argumentsJson, ...(pendingPermission.callId !== undefined ? { callId: pendingPermission.callId } : {}) } : undefined}
                pendingToolName={pendingPermission?.toolName}
                conversation={controller.activeConversation}
                onEdit={isOffline || isStreaming || isCompressing ? undefined : controller.editMessage}
                onVersionChange={isStreaming || isCompressing ? undefined : controller.switchBranch}
                onLoadEarlier={() => void controller.loadEarlier()}
                onRecall={onRecall}
                onRegenerate={isOffline || isStreaming || isCompressing ? undefined : onRegenerate}
                onContinue={isOffline || isStreaming || isCompressing ? undefined : handleContinue}
                onToast={showToast}
                showSources={webSearchSettings.showSources}
                summary={controller.activeConversation?.summary}
              />
            </FollowUpContext.Provider>
            </StopCommandContext.Provider>
            </BindProjectContext.Provider>
          </div>
        )}

        {latestTodos && latestTodos.length > 0 ? (
          <PlanStrip todos={latestTodos} running={isStreaming} />
        ) : null}

        {/* 输入节点持续挂载，首次发送只改变布局位置，保留焦点与输入法状态。 */}
        <div className="desktop-composer-dock">
          {composerNode}
        </div>
      </div>
    </main>
  );
}
