import { shouldCompressContext } from "../domain/context-budget";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  runWorkspaceFor,
  workspaceBinding,
  type AgentExecutionMode,
  type CancellationRecord,
  type ChatMessage,
  type ChatSource,
  type Conversation,
  type Locale,
  type MessageContentSegment,
  type RunRecoveryRecord,
  type StoredImage,
  type SupplementRecord,
  type TokenUsage,
  type ToolStep,
} from "../domain/chat";
import { archiveBranch, restoreBranch } from "../domain/message-branches";
import { appendContentSegment, finishThoughtSegment } from "../domain/message-content";
import {
  DEFAULT_MAX_TOOL_ROUNDS,
  customModelRequestOptions,
  supportsImageInput,
  type ActiveLlmConfig,
} from "../domain/llm";
import type { SkillDefinition } from "../skills";
import { createDesktopFileReader, expandFileReferences, hasFileReferences } from "../features/file-reference/expand-file-references";

import { isDesktopApp } from "../services/app-platform";
import { projectManager, sameWorkspace } from "../services/project-manager";
import { readReasoningEffort } from "../services/reasoning-effort";
import {
  cancelAgentRun,
  ChatClientError,
  getAgentRunState,
  isRetryableChatErrorCode,
  listActiveAgentRuns,
  isStreamDisconnect,
  resumeAgentRun,
  stopAgentToolCall,
  streamChat as streamChatRequest,
  submitAgentApproval,
  submitAgentSupplement,
  type ActiveRunSummary,
  type AgentRunState,
  type ResumeRunResult,
  type StreamChatMessage,
  type StreamChatOptions,
  type StreamChatRequest,
  type StreamChatResult,
} from "../services/chat-client";
import {
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatState,
} from "./chat-reducer";
import {
  compressionInstruction,
  compressionTriggerUncompressedMessages,
  countUncompressedMessages,
  parseCompressionOutput,
} from "./conversation-compression";
import {
  blobToDataUrl,
  formatClientTimestamp,
  isHistoryMessage,
  maximumRequestMessages,
  requestHistory,
  selectRequestImages,
  withOmittedImageNote,
} from "./request-history";
import { createStreamBatcher, type StreamBatcher } from "./stream-batcher";
import {
  buildTitleRequestMessages,
  cleanAiGeneratedTitle,
  generateConversationTitle,
  isDefaultTitle,
} from "./conversation-title";

export interface ChatRepository {
  createConversation(locale: Locale, now?: number): Promise<Conversation>;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  renameConversation?(id: string, title: string): Promise<void>;
  setConversationArchived?(id: string, archived: boolean): Promise<void>;
  /** 记录任务归属的项目；已绑定其他项目时拒绝 */
  setConversationWorkspace(id: string, workspace: string | null): Promise<void>;
  listMessages(
    conversationId: string,
    options?: { beforeCreatedAt?: number; limit?: number },
  ): Promise<ChatMessage[]>;
  putMessage(message: ChatMessage): Promise<void>;
  saveBranchState(conversation: Conversation, messages: ChatMessage[]): Promise<void>;
  updateConversationSummary(
    id: string,
    summary: string,
    now?: number,
    compressedUpTo?: number,
    compressedUpToId?: string,
  ): Promise<void>;
  getUserMemory(): Promise<string>;
  updateUserMemory(memory: string): Promise<void>;
  /** 将存储中的会话消息截断为给定前缀（定点删除水位线之后的部分） */
  replaceMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
  deleteMessagesFrom(conversationId: string, fromCreatedAt: number): Promise<void>;
  putImage(image: StoredImage): Promise<void>;
  getImage(id: string): Promise<StoredImage | undefined>;
  setLocale(locale: Locale): Promise<void>;
  getLocale(): Promise<Locale>;
  deleteConversation?(id: string): Promise<void>;
  setConversationLocale(id: string, locale: Locale): Promise<void>;
}

export type StreamChatFunction = (
  request: StreamChatRequest,
  options: StreamChatOptions,
) => Promise<StreamChatResult>;

export interface ChatControllerOptions {
  repository: ChatRepository;
  streamChat?: StreamChatFunction;
  activeLlmConfig?: ActiveLlmConfig;
  /** 已启用的技能，内容将作为技能指令注入每次请求 */
  activeSkills?: readonly SkillDefinition[];
  /** 联网搜索开关，开启后普通聊天请求携带 webSearch: true（summary 压缩不携带） */
  webSearchEnabled?: boolean;
  /** 智能搜索开关，开启后普通聊天请求携带 smartSearch: true（需联网搜索同时开启） */
  webSearchSmart?: boolean;
  /** 是否在首轮对话完成后自动调用大模型生成自定义标题（默认 false，由外部或设置开启） */
  autoAiTitle?: boolean;
  /** 会话元数据（标题/时间/自愈）变更外部通知，便于顶层同步刷新列表 */
  onConversationUpdated?: () => void;
  /** 非当前会话的运行结束时通知（后台任务完成提醒） */
  onBackgroundRunFinished?: (conversationId: string, status: "complete" | "failed" | "stopped") => void;
  /** 运行中网关下发的提示码（如 REASONING_EFFORT_REJECTED），由界面本地化后提示 */
  onNotice?: (code: string) => void;
  now?: () => number;
  id?: () => string;
  /** 运行编号生成器（与消息 id 分开，避免影响消息 id 序列） */
  runId?: () => string;
  /** 重新连接运行的事件流（默认走本地网关） */
  resumeRun?: (runId: string, afterSeq: number, options: StreamChatOptions) => Promise<ResumeRunResult>;
  /** 查询运行在网关中的状态（默认走本地网关） */
  getRunState?: (runId: string) => Promise<AgentRunState>;
  /** 断线后重新连接的等待间隔；测试可缩短 */
  reconnectDelaysMs?: readonly number[];
  /** 网关中仍在执行的运行（默认走本地网关） */
  listActiveRuns?: () => Promise<ActiveRunSummary[]>;
}

/** 侧栏显示的实时运行状态：运行中、等待确认、正在取消、等待同一项目中的其他任务完成写入 */
export type RunActivity = "streaming" | "approval" | "cancelling" | "waiting";

export interface RecalledMessageData {
  text: string;
  imageId?: string;
}

export interface ChatController extends ChatState {
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  stop(): Promise<void>;
  recall(): Promise<RecalledMessageData | undefined>;
  regenerate(messageId?: string): Promise<void>;
  editMessage(messageId: string, text: string): Promise<void>;
  switchBranch(messageId: string, version: number): Promise<void>;
  compressConversation(manual?: boolean): Promise<boolean>;
  updateUserMemory(memory: string): Promise<boolean>;
  newConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  generateAiTitle(
    conversationId?: string,
    overrideMessages?: readonly ChatMessage[],
  ): Promise<string | undefined>;
  /** 向上翻页：加载当前窗口之前更早的历史消息（UI 窗口化） */
  loadEarlier(): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  setPendingImage(image?: StoredImage): void;
  setOnline(online: boolean): void;
  clearError(): void;
  agentMode: "readonly" | "confirm" | "full_auto";
  agentEnabled: boolean;
  toggleAgent(): void;
  setExecutionMode(mode: "readonly" | "confirm" | "full_auto"): void;
  approvePermission(requestId: string, approved: boolean, sessionScope?: boolean): Promise<boolean>;
  /** 所有正在运行的会话（含后台），键为会话 id */
  runningConversations: ReadonlyMap<string, RunActivity>;
  /** 停止指定会话的运行（不要求是当前会话） */
  stopConversation(id: string): Promise<void>;
  /** 把当前未绑定项目的会话绑定到指定项目；已绑定其他项目或正在运行时返回 false */
  bindConversationWorkspace(workspace: string): Promise<boolean>;
  /** 只停止某条运行中的命令（按工具调用），运行继续 */
  stopToolCall(callId: string): Promise<boolean>;
  /** 当前会话的 Agent 运行中追加补充要求（不中断任务） */
  supplement(text: string): Promise<SupplementResult>;
}

interface ControllerServices {
  repository: ChatRepository;
  streamChat: StreamChatFunction;
  resumeRun: (runId: string, afterSeq: number, options: StreamChatOptions) => Promise<ResumeRunResult>;
  getRunState: (runId: string) => Promise<AgentRunState>;
  listActiveRuns: () => Promise<ActiveRunSummary[]>;
  reconnectDelaysMs: readonly number[];
  now: () => number;
  id: () => string;
  runId: () => string;
}

/** 运行没有正常接收到终止事件：依据网关的运行状态收尾 */
interface RecoveredRun {
  readonly recovered: true;
  readonly state: AgentRunState;
}

/** 断线后重新连接的等待间隔（合计约 15 秒） */
const defaultReconnectDelaysMs: readonly number[] = [300, 1000, 2000, 4000, 8000];

function recoveryFor(state: AgentRunState, gap: boolean): RunRecoveryRecord {
  const status = state.kind === "finished" ? state.status : state.kind === "active" ? "unknown" : "unknown";
  return { status, ...(gap ? { gap: true } : {}) };
}

interface InitialData {
  conversation: Conversation;
  locale: Locale;
  messages: ChatMessage[];
  userMemory?: string;
  hasMoreHistory?: boolean;
  /** 存储中仍为“运行中”的 Agent 消息：加载后向网关确认，能接回则接回，否则标记结局 */
  staleRuns?: ChatMessage[];
}

/** 残留的 Agent 运行消息：界面先按已停止显示，存储保持原状，等向网关确认后再决定 */
function isStaleAgentRun(message: ChatMessage): boolean {
  return message.status === "streaming" && message.run !== undefined;
}

/** ActiveRun 内的工具步骤可变缓冲（domain ToolStep 为 readonly 快照形态） */
type MutableToolStep = { -readonly [K in keyof ToolStep]: ToolStep[K] };

interface ActiveRun {
  assistant: ChatMessage;
  controller: AbortController;
  finishing?: Promise<void>;
  preparation: Promise<void>;
  text: string;
  thought?: string;
  provider?: string;
  model?: string;
  usage?: TokenUsage;
  startTime: number;
  /** 联网搜索返回的参考来源（sources 事件先于 delta 到达），随消息持久化 */
  sources?: ReadonlyArray<ChatSource>;
  /** Agent 工具步骤缓冲（onToolCall 追加、onToolResult 回填），终态快照进消息 */
  toolSteps: MutableToolStep[];
  contentSegments: ReadonlyArray<MessageContentSegment>;
  contentStartedAtMs?: number;
  timer?: ReturnType<typeof setTimeout>;
  token: number;
  /** 本次运行等待中的权限审批；会话在后台时暂存于此，切回前台再交给界面 */
  pendingPermission?: NonNullable<ChatState["pendingPermission"]>;
  /** 网关已确认运行身份（收到 run_started），之后取消走显式取消接口而不是断开连接 */
  runConfirmed?: boolean;
  /** 已请求取消，正在等待网关收尾 */
  cancelling?: boolean;
  /** 运行进入终态（finishRun 完成）时兑现 */
  ended: Promise<void>;
  resolveEnded: () => void;
  /** 待推送到界面的命令增量输出 */
  liveOutputDirty: Set<string>;
  liveOutputTimer?: ReturnType<typeof setTimeout>;
  /** 正在等待同一项目中的其他任务完成写入 */
  waitingForWorkspace?: boolean;
  /** 已处理的最后一个事件序号 */
  lastSeq?: number;
  /** 重新连接时网关已丢弃了部分事件 */
  eventGap?: boolean;
  /** 安排一次部分持久化（由 startAssistant 注入，供运行外部的回调使用） */
  schedulePersistence?: () => void;
}

/** 追加补充要求的结果：unavailable 表示当前没有可接受补充的运行（未开始、正在取消或不是 Agent 运行） */
export type SupplementResult = "queued" | "undelivered" | "unavailable";

const partialPersistenceInterval = 250;
/** 运行中命令输出在界面保留的末尾长度 */
const liveOutputLimit = 8 * 1024;
const liveOutputFlushInterval = 120;
/** 请求取消后等待网关收尾的上限：命令终止宽限与 MCP 收尾时间之和再留余量 */
const cancelSettleTimeoutMs = 20_000;

function keepTail(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 断开连接结束运行时的收尾结论：网关会随连接断开取消运行，但界面无法确认收尾；
 * 若已有工具在执行，如实标记结果未知
 */
function cancellationForAbort(run: ActiveRun): CancellationRecord | undefined {
  const unfinished = run.toolSteps.filter((step) => step.result === undefined);
  if (unfinished.length === 0 && run.cancelling !== true) return undefined;
  return {
    confirmed: false,
    unknown: unfinished.map((step) => ({ callId: step.id, name: step.name, detail: "未收到执行结果" })),
  };
}
/** UI 窗口化：初始只加载最近 windowSize 条历史，向上滚动时按 historyLoadStep 条上翻 */
const historyWindowSize = 50;
const historyLoadStep = 30;

/**
 * 派生叠加视图：流式期间增量写在 state.streaming 槽位里，这里把累积文本叠到
 * 对应消息上再交给 UI，保证组件层看到的仍是"最后一条消息的 text 在增长"。
 */
function overlayStreamedText(state: ChatState): ChatMessage[] {
  const streaming = state.streaming;
  if (streaming === undefined) return state.messages;
  const index = state.messages.findIndex((message) => message.id === streaming.messageId);
  if (index < 0) return state.messages;
  return state.messages.map((message, i) =>
    i === index
      ? {
          ...message,
          ...(streaming.contentSegments !== undefined ? { contentSegments: streaming.contentSegments } : {}),
          ...(streaming.text !== undefined ? { text: message.text + streaming.text } : {}),
          thought:
            streaming.thought === undefined
              ? message.thought
              : ((message.thought ?? "") + streaming.thought) || undefined,
        }
      : message,
  );
}

export function useChatController(options: ChatControllerOptions): ChatController {
  /** 加载与选择会话时确认残留运行；回调定义在后面，经 ref 调用 */
  const recoverStaleRunRef = useRef<((message: ChatMessage) => Promise<void>) | undefined>(undefined);
  const reattachBackgroundRunsRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const servicesRef = useRef<ControllerServices>({
    id: options.id ?? (() => crypto.randomUUID()),
    runId: options.runId ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => Date.now()),
    repository: options.repository,
    streamChat: options.streamChat ?? streamChatRequest,
    resumeRun: options.resumeRun ?? resumeAgentRun,
    getRunState: options.getRunState ?? getAgentRunState,
    listActiveRuns: options.listActiveRuns ?? listActiveAgentRuns,
    reconnectDelaysMs: options.reconnectDelaysMs ?? defaultReconnectDelaysMs,
  });
  const activeLlmConfigRef = useRef<ActiveLlmConfig | undefined>(options.activeLlmConfig);
  useEffect(() => {
    activeLlmConfigRef.current = options.activeLlmConfig;
  }, [options.activeLlmConfig]);
  const activeSkillsRef = useRef<readonly SkillDefinition[] | undefined>(options.activeSkills);
  useEffect(() => {
    activeSkillsRef.current = options.activeSkills;
  }, [options.activeSkills]);
  const webSearchEnabledRef = useRef<boolean>(options.webSearchEnabled ?? false);
  useEffect(() => {
    webSearchEnabledRef.current = options.webSearchEnabled ?? false;
  }, [options.webSearchEnabled]);
  const webSearchSmartRef = useRef<boolean>(options.webSearchSmart ?? false);
  useEffect(() => {
    webSearchSmartRef.current = options.webSearchSmart ?? false;
  }, [options.webSearchSmart]);
  const autoAiTitleRef = useRef<boolean>(options.autoAiTitle ?? true);
  useEffect(() => {
    autoAiTitleRef.current = options.autoAiTitle ?? true;
  }, [options.autoAiTitle]);
  const [agentMode, setAgentMode] = useState<AgentExecutionMode>(() => {
    try {
      const stored = localStorage.getItem("yachiyo_execution_mode");
      if (stored === "readonly" || stored === "confirm" || stored === "full_auto") return stored;
    } catch { /* 存储不可用时采用需确认模式。 */ }
    return "confirm";
  });
  const agentModeRef = useRef(agentMode);
  const agentEnabled = isDesktopApp();
  const setExecutionMode = useCallback((mode: "readonly" | "confirm" | "full_auto") => {
    agentModeRef.current = mode;
    setAgentMode(mode);
    try { localStorage.setItem("yachiyo_execution_mode", mode); } catch { /* 不影响当前会话。 */ }
  }, []);
  const toggleAgent = useCallback(() => {
    setExecutionMode(agentModeRef.current === "readonly" ? "confirm" : agentModeRef.current === "confirm" ? "full_auto" : "readonly");
  }, [setExecutionMode]);
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef<ChatState>(initialChatState);
  /** 按会话 id 索引的运行：切换或新建会话不会中断其他会话的运行 */
  const runsRef = useRef(new Map<string, ActiveRun>());
  const [runningConversations, setRunningConversations] = useState<ReadonlyMap<string, RunActivity>>(
    () => new Map(),
  );
  const compressRef = useRef<{ controller: AbortController; conversationId: string } | undefined>(undefined);
  const initializationRef = useRef<Promise<InitialData> | undefined>(undefined);
  const mountedRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runTokenRef = useRef(0);
  /** 正在准备或执行发送的会话 id → 发送令牌；各会话互不阻塞 */
  const sendingRef = useRef(new Map<string, number>());
  const sendTokenRef = useRef(0);
  const newConversationLockRef = useRef(false);
  const lastTimestampRef = useRef(0);
  const onConversationUpdatedRef = useRef(options.onConversationUpdated);
  useEffect(() => {
    onConversationUpdatedRef.current = options.onConversationUpdated;
  }, [options.onConversationUpdated]);
  const onNoticeRef = useRef(options.onNotice);
  useEffect(() => {
    onNoticeRef.current = options.onNotice;
  }, [options.onNotice]);
  const onBackgroundRunFinishedRef = useRef(options.onBackgroundRunFinished);
  useEffect(() => {
    onBackgroundRunFinishedRef.current = options.onBackgroundRunFinished;
  }, [options.onBackgroundRunFinished]);

  const nextTimestamp = useCallback(() => {
    const timestamp = Math.max(servicesRef.current.now(), lastTimestampRef.current + 1);
    lastTimestampRef.current = timestamp;
    return timestamp;
  }, []);

  const emit = useCallback((action: ChatAction) => {
    stateRef.current = chatReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  /** 运行仍是该会话的当前运行（未被停止、替换或撤回） */
  const isRunAlive = useCallback(
    (run: ActiveRun) => runsRef.current.get(run.assistant.conversationId)?.token === run.token,
    [],
  );
  /** 会话正显示在界面上；后台会话的进度只写入存储与运行缓冲，不派发到界面状态 */
  const isForeground = useCallback(
    (conversationId: string) => mountedRef.current && stateRef.current.activeConversation?.id === conversationId,
    [],
  );
  const isSending = useCallback(
    (conversationId: string | undefined) => conversationId !== undefined && sendingRef.current.has(conversationId),
    [],
  );
  const syncRunActivity = useCallback(() => {
    if (!mountedRef.current) return;
    setRunningConversations(
      new Map(
        [...runsRef.current].map(([id, run]): [string, RunActivity] => [
          id,
          run.cancelling === true
            ? "cancelling"
            : run.pendingPermission !== undefined
              ? "approval"
              : run.waitingForWorkspace === true
                ? "waiting"
                : "streaming",
        ]),
      ),
    );
  }, []);

  const streamBatcherRef = useRef<StreamBatcher | undefined>(undefined);
  useEffect(() => {
    const batcher = createStreamBatcher(emit);
    streamBatcherRef.current = batcher;
    return () => {
      batcher.flush();
      if (streamBatcherRef.current === batcher) streamBatcherRef.current = undefined;
    };
  }, [emit]);

  const queueMessage = useCallback((message: ChatMessage): Promise<void> => {
    const task = persistQueueRef.current.then(() =>
      servicesRef.current.repository.putMessage(message),
    );
    persistQueueRef.current = task.catch(() => undefined);
    return task;
  }, []);

  const createConversation = useCallback(
    async (locale: Locale): Promise<InitialData> => {
      const conversation = await servicesRef.current.repository.createConversation(
        locale,
        nextTimestamp(),
      );
      return { conversation, locale, messages: [], hasMoreHistory: false };
    },
    [nextTimestamp],
  );

  useEffect(() => {
    mountedRef.current = true;
    let ignored = false;
    const runs = runsRef.current;

    initializationRef.current ??= (async () => {
      const [locale, conversations, userMemory] = await Promise.all([
        servicesRef.current.repository.getLocale(),
        servicesRef.current.repository.listConversations(),
        servicesRef.current.repository.getUserMemory().catch(() => ""),
      ]);
      // 启动时打开最近的未归档会话；全部归档时新建一个
      let latest = conversations.find((conversation) => conversation.archivedAt === undefined);
      if (latest === undefined) {
        return { ...(await createConversation(locale)), userMemory };
      }
      lastTimestampRef.current = Math.max(lastTimestampRef.current, latest.updatedAt);
      // UI 窗口化：只加载最近 windowSize 条，更早历史经 loadEarlier 按需上翻；
      // 多取 1 条探测是否还有更早历史（hasMoreHistory），避免额外的计数查询
      const storedMessages = await servicesRef.current.repository.listMessages(latest.id, {
        limit: historyWindowSize + 1,
      });
      const hasMoreHistory = storedMessages.length > historyWindowSize;
      const windowed = storedMessages.slice(hasMoreHistory ? 1 : 0);
      const messages = windowed.map((message) =>
        message.status === "streaming" ? { ...message, status: "stopped" as const } : message,
      );
      // 普通对话的残留消息直接落盘为已停止；Agent 运行的残留消息先保持原状，等向网关确认
      for (let index = 0; index < messages.length; index += 1) {
        if (messages[index] !== windowed[index] && !isStaleAgentRun(windowed[index]!)) await queueMessage(messages[index]!);
      }
      const staleRuns = windowed.filter(isStaleAgentRun);
      if (locale !== latest.locale) await servicesRef.current.repository.setLocale(latest.locale);
      if (isDefaultTitle(latest.title)) {
        const autoTitle = generateConversationTitle(messages, latest.locale);
        if (!isDefaultTitle(autoTitle)) {
          latest = { ...latest, title: autoTitle };
          void servicesRef.current.repository.renameConversation?.(latest.id, autoTitle);
        }
      }
      if (conversations.length > 0) {
        const repo = servicesRef.current.repository;
        void (async () => {
          try {
            let updatedAny = false;
            for (let i = 0; i < conversations.length; i++) {
              const item = conversations[i]!;
              if (isDefaultTitle(item.title)) {
                const count = await repo.listMessages(item.id, { limit: 5 });
                if (count.length === 0) {
                  if (i > 0 && repo.deleteConversation) {
                    await repo.deleteConversation(item.id);
                    updatedAny = true;
                  }
                } else {
                  const autoTitle = generateConversationTitle(count, item.locale);
                  if (!isDefaultTitle(autoTitle)) {
                    await repo.renameConversation?.(item.id, autoTitle);
                    updatedAny = true;
                  }
                }
              }
            }
            if (updatedAny) {
              onConversationUpdatedRef.current?.();
            }
          } catch {
            // 静默自愈，不影响核心启动流程
          }
        })();
      }
      return {
        conversation: latest,
        locale: latest.locale,
        messages,
        userMemory,
        hasMoreHistory,
        staleRuns,
      };
    })();

    void initializationRef.current
      .then((loaded) => {
        if (!ignored && mountedRef.current) {
          focusConversationProject(loaded.conversation);
          emit({
            conversation: loaded.conversation,
            locale: loaded.locale,
            messages: loaded.messages,
            type: "loaded",
            ...(loaded.userMemory !== "" ? { userMemory: loaded.userMemory } : {}),
            ...(loaded.hasMoreHistory ? { hasMoreHistory: true } : {}),
          });
          for (const message of loaded.staleRuns ?? []) void recoverStaleRunRef.current?.(message);
          void reattachBackgroundRunsRef.current?.();
        }
      })
      .catch(() => {
        if (!ignored && mountedRef.current) {
          emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        }
      });

    return () => {
      ignored = true;
      mountedRef.current = false;
      const compress = compressRef.current;
      if (compress !== undefined) {
        compressRef.current = undefined;
        compress.controller.abort();
      }
      const stoppedRuns = [...runs.values()];
      runs.clear();
      streamBatcherRef.current?.flush();
      for (const active of stoppedRuns) {
        if (active.timer !== undefined) clearTimeout(active.timer);
        active.controller.abort();
        void active.preparation
          .catch(() => undefined)
          .then(() =>
            queueMessage({
              ...active.assistant,
              status: "stopped",
              text: active.text,
            }),
          )
          .catch(() => undefined);
      }
    };
  }, [createConversation, emit, queueMessage]);

  const makeRequestMessages = useCallback(
    async (
      messages: ChatMessage[],
      pendingImage?: StoredImage,
      reserveCharacters = 0,
      overrideSummary?: string,
      conversation: Conversation | undefined = stateRef.current.activeConversation,
    ): Promise<StreamChatMessage[]> => {
      // 运行开始后用户可能切到别的会话，摘要、压缩边界与语言必须取自发起运行的会话
      const locale = conversation?.locale ?? stateRef.current.locale;
      const activeSkills = activeSkillsRef.current ?? [];
      const hasSkills = activeSkills.length > 0;
      const skillUserText = hasSkills
        ? `【技能指令 / Skill Instructions】\n以下技能已激活，回复时必须严格遵守：\n\n${activeSkills
            .map((skill) => skill.content)
            .join("\n\n---\n\n")}`
        : "";
      const skillAssistantText = hasSkills
        ? locale === "ja-JP"
          ? "（技能指示を確認しました。厳守して実行します）"
          : "（已收到技能指令，将严格遵守执行）"
        : "";
      const skillChars = hasSkills
        ? [...skillUserText].length + [...skillAssistantText].length
        : 0;

      const activeUserMemory = stateRef.current.userMemory;
      const hasUserMemory =
        typeof activeUserMemory === "string" && activeUserMemory.trim().length > 0;

      const memoryUserText = hasUserMemory
        ? locale === "ja-JP"
          ? `【彩葉についての長期記憶（全ての会話で共有される事実）】\n${activeUserMemory.trim()}\nこれは実際に起きた確定した事実として扱ってください。`
          : `【关于彩叶的长期记忆（所有对话共享的事实）】\n${activeUserMemory.trim()}\n以下内容请作为真实发生的既定事实对待。`
        : "";
      const memoryAssistantText = hasUserMemory
        ? locale === "ja-JP"
          ? "（彩葉のこと、ちゃんと覚えていますよ）"
          : "（关于彩叶的事情，我一直都记得哦~）"
        : "";

      const memoryChars = hasUserMemory
        ? [...memoryUserText].length + [...memoryAssistantText].length
        : 0;

      const activeSummary = overrideSummary ?? conversation?.summary;
      const hasSummary = typeof activeSummary === "string" && activeSummary.trim().length > 0;

      const summaryUserText = hasSummary
        ? locale === "ja-JP"
          ? `【これまでの会話の記憶・背景（実際に起きた確定した事実）】\n${activeSummary.trim()}\nこれは私たちが実際に経験した会話の記録です。既定の事実として守り、引き継いでください。`
          : `【前情提要 / 历史背景记忆（真实发生的既定事实）】\n${activeSummary.trim()}\n这是我们真实经历过的对话记录，请作为既定事实遵守并延续。`
        : "";
      const summaryAssistantText = hasSummary
        ? locale === "ja-JP"
          ? "（これまでの経緯と記憶を把握しました。会話を続けます）"
          : "（已记住我们之前的对话与经历，继续交流~）"
        : "";

      const summaryChars = hasSummary
        ? [...summaryUserText].length + [...summaryAssistantText].length
        : 0;

      const reservedPrefixMessages =
        (hasSkills ? 2 : 0) +
        (hasUserMemory ? 2 : 0) +
        (hasSummary ? 2 : 0);
      const maxHistoryMessages = maximumRequestMessages - reservedPrefixMessages;
      const history = requestHistory(
        messages,
        reserveCharacters + summaryChars + memoryChars + skillChars,
        maxHistoryMessages,
        conversation?.compressedUpTo,
      );
      if (history.length === 0 && messages.some(isHistoryMessage)) throw new ChatClientError("INVALID_REQUEST");
      const images = await selectRequestImages(history, async (imageId) => {
        const image =
          pendingImage?.id === imageId ? pendingImage : await servicesRef.current.repository.getImage(imageId);
        return image === undefined ? undefined : blobToDataUrl(image);
      });

      // 每条历史消息可能展开为多条请求消息（agent 工具步骤序列），故 map 后 flat 展平
      // @ 引用按运行所属的工作区展开，不跟随界面当前选中的项目
      const readReferencedFile = createDesktopFileReader(conversation?.workspace ?? null);
      const chatMessages = (
        await Promise.all(
          history.map(async ({ message, text }, index): Promise<StreamChatMessage[]> => {
            if (
              message.role === "assistant" &&
              message.toolSteps !== undefined &&
              message.toolSteps.length > 0
            ) {
              const requestMessages: StreamChatMessage[] = [
                {
                  role: "assistant",
                  text: "",
                  toolCalls: message.toolSteps.map((step) => ({
                    id: step.id,
                    name: step.name,
                    arguments: safeParseArguments(step.argumentsJson),
                  })),
                },
              ];
              for (const step of message.toolSteps) {
                requestMessages.push({
                  role: "tool",
                  text: step.result?.output ?? "",
                  toolCallId: step.id,
                  toolName: step.name,
                });
              }
              if (text.trim().length > 0) {
                requestMessages.push({
                  role: "assistant",
                  text: text.trim(),
                });
              }
              return requestMessages;
            }
            const expandedText =
              // desktop 端 user 消息中的 @文件引用 在请求侧展开为文件内容块（存储与 UI 保留原文）
              message.role === "user" && isDesktopApp() && hasFileReferences(text)
                ? await expandFileReferences(text, readReferencedFile)
                : text;
            const imageDataUrl = images.get(index);
            const requestMessage: StreamChatMessage = {
              role: message.role,
              text:
                message.imageId !== undefined && imageDataUrl === undefined
                  ? withOmittedImageNote(expandedText, locale)
                  : expandedText,
            };
            if (imageDataUrl !== undefined) requestMessage.imageDataUrl = imageDataUrl;
            return [requestMessage];
          }),
        )
      ).flat();

      const prefixMessages: StreamChatMessage[] = [];
      if (hasSkills) {
        prefixMessages.push(
          { role: "user", text: skillUserText },
          { role: "assistant", text: skillAssistantText },
        );
      }
      if (hasUserMemory) {
        prefixMessages.push(
          { role: "user", text: memoryUserText },
          { role: "assistant", text: memoryAssistantText },
        );
      }
      if (hasSummary) {
        prefixMessages.push(
          { role: "user", text: summaryUserText },
          { role: "assistant", text: summaryAssistantText },
        );
      }

      const allMessages = [...prefixMessages, ...chatMessages];
      // 当历史末尾是 assistant 角色时（例如 retry 上一条已有实质产出的失败消息），
      // 运行时请求追加接续指令以符合大模型接口末尾必须是 user 的契约，同时 100% 继承上文全部工作事实
      if (allMessages.at(-1)?.role === "assistant") {
        const continuationText =
          locale === "ja-JP"
            ? "（接続が一時切断されました。上記に続けてタスクを完了してください）"
            : "（连接曾中断，请接续上文继续完成任务）";
        allMessages.push({ role: "user", text: continuationText });
      }

      return allMessages;
    },
    [],
  );

  const generateAiTitle = useCallback(
    async (
      targetConversationId?: string,
      overrideMessages?: readonly ChatMessage[],
    ): Promise<string | undefined> => {
      const convId = targetConversationId ?? stateRef.current.activeConversation?.id;
      if (!convId) return undefined;

      const targetConv =
        stateRef.current.activeConversation?.id === convId
          ? stateRef.current.activeConversation
          : await servicesRef.current.repository.getConversation(convId);
      if (!targetConv) return undefined;

      const messages =
        overrideMessages ??
        (stateRef.current.activeConversation?.id === convId
          ? stateRef.current.messages
          : await servicesRef.current.repository.listMessages(convId));
      if (messages.length === 0) return undefined;

      const requestMessages = buildTitleRequestMessages(messages, targetConv.locale);
      const activeConfig = activeLlmConfigRef.current;

      console.info("[AutoAiTitle] generateAiTitle called for conversationId:", convId);
      let generatedText = "";
      try {
        await servicesRef.current.streamChat(
          {
            locale: targetConv.locale,
            messages: requestMessages,
            mode: "title",
            ...(activeConfig !== undefined
              ? {
                  provider: activeConfig.provider,
                  apiKey: activeConfig.apiKey,
                  model: activeConfig.model,
                  ...(activeConfig.baseUrl !== undefined
                    ? { baseUrl: activeConfig.baseUrl }
                    : {}),
                  ...(activeConfig.keySlot !== undefined ? { keySlot: activeConfig.keySlot } : {}),
                  ...(activeConfig.custom !== undefined && activeConfig.baseUrl !== undefined
                    ? { customModel: customModelRequestOptions(activeConfig.custom) }
                    : {}),
                }
              : {}),
          },
          {
            onDelta: (text) => {
              generatedText += text;
            },
          },
        );
      } catch (err) {
        console.warn("[autoAiTitle] streamChat failed:", err);
        return undefined;
      }

      const cleaned = cleanAiGeneratedTitle(generatedText, targetConv.locale);
      console.info("[AutoAiTitle] Result for", convId, "raw:", JSON.stringify(generatedText), "cleaned:", JSON.stringify(cleaned));
      return cleaned;
    },
    [],
  );

  const finishRun = useCallback(
    async (
      run: ActiveRun,
      status: "complete" | "failed" | "stopped",
      errorCode?: string,
      truncated?: boolean,
      usage?: TokenUsage,
      loopStopped?: boolean,
      errorDetail?: string,
      cancellation?: CancellationRecord,
    ): Promise<void> => {
      if (run.finishing !== undefined) return run.finishing;
      run.finishing = (async () => {
        if (!isRunAlive(run)) {
          run.resolveEnded();
          return;
        }
        const conversationId = run.assistant.conversationId;
        runsRef.current.delete(conversationId);
        syncRunActivity();
        if (run.timer !== undefined) clearTimeout(run.timer);
        if (run.liveOutputTimer !== undefined) clearTimeout(run.liveOutputTimer);
        // 终态（completed/stopped/failed）必须晚于所有已缓冲的流式增量落地
        streamBatcherRef.current?.flush();
        const latencyMs = Math.max(0, servicesRef.current.now() - run.startTime);
        run.contentSegments = finishThoughtSegment(run.contentSegments, latencyMs);
        // 运行结束时仍在排队的补充没有送达模型，如实标记，由用户决定是否作为新消息发送
        if (run.assistant.supplements?.some((item) => item.state === "queued")) {
          const settled = run.assistant.supplements.map((item) => (item.state === "queued" ? { ...item, state: "undelivered" as const } : item));
          run.assistant = { ...run.assistant, supplements: settled };
          if (isForeground(conversationId)) emit({ type: "supplements-changed", messageId: run.assistant.id, supplements: settled });
        }
        const finalUsage = usage ?? run.usage;
        const message: ChatMessage = {
          ...run.assistant,
          status,
          text: run.text,
          ...(run.thought !== undefined && run.thought.length > 0 ? { thought: run.thought } : {}),
          ...(run.provider !== undefined ? { provider: run.provider } : {}),
          ...(run.model !== undefined ? { model: run.model } : {}),
          ...(finalUsage !== undefined ? { usage: finalUsage } : {}),
          latencyMs,
          contentSegments: run.contentSegments,
          contentStartedAtMs: run.contentStartedAtMs,
          ...(status === "stopped" ? { interrupted: true } : {}),
          ...(cancellation !== undefined ? { cancellation } : {}),
          ...(truncated === true ? { truncated: true } : {}),
          ...(loopStopped === true ? { loopStopped: true } : {}),
          ...(run.sources !== undefined ? { sources: run.sources } : {}),
          ...(run.lastSeq !== undefined ? { runEventSeq: run.lastSeq } : {}),
          ...(run.toolSteps.length > 0
            ? { toolSteps: run.toolSteps.map((step) => ({ ...step })) }
            : {}),
        };
        const foreground = isForeground(conversationId);
        if (foreground) {
          if (status === "complete") {
            emit({
              messageId: run.assistant.id,
              type: "completed",
              usage: finalUsage,
              latencyMs,
              contentSegments: run.contentSegments,
              contentStartedAtMs: run.contentStartedAtMs,
              ...(loopStopped === true ? { loopStopped: true } : {}),
            });
          } else if (status === "stopped") {
            emit({
              messageId: run.assistant.id,
              type: "stopped",
              latencyMs,
              contentSegments: run.contentSegments,
              ...(cancellation !== undefined ? { cancellation } : {}),
            });
          } else {
            emit({
              errorCode: errorCode ?? "SERVICE_UNAVAILABLE",
              ...(errorDetail !== undefined ? { errorDetail } : {}),
              messageId: run.assistant.id,
              type: "failed",
              latencyMs,
              contentSegments: run.contentSegments,
            });
          }
        }
        run.resolveEnded();
        await queueMessage(message).catch(() => {
          if (isForeground(conversationId)) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        });
        if (!foreground && mountedRef.current) onBackgroundRunFinishedRef.current?.(conversationId, status);

        const activeConv = stateRef.current.activeConversation;
        if (
          conversationId &&
          (status === "complete" || (status === "stopped" && run.text.trim().length > 0))
        ) {
          const targetConv =
            activeConv?.id === conversationId
              ? activeConv
              : await servicesRef.current.repository.getConversation(conversationId);

          if (targetConv !== undefined) {
            const allMessages =
              activeConv?.id === conversationId
                ? [...stateRef.current.messages, message]
                : await servicesRef.current.repository.listMessages(conversationId);
            const autoTitle = generateConversationTitle(allMessages, targetConv.locale);
            const shouldSetHeuristic = isDefaultTitle(targetConv.title);

            if (shouldSetHeuristic && !isDefaultTitle(autoTitle)) {
              await servicesRef.current.repository.renameConversation?.(conversationId, autoTitle);
              if (mountedRef.current && stateRef.current.activeConversation?.id === conversationId) {
                emit({ conversationId, title: autoTitle, type: "conversation-renamed" });
              }
              onConversationUpdatedRef.current?.();
            }

            // 阶段二：当开启 autoAiTitle 且对话正常完成时，异步向大模型请求智能概括标题并平滑升级
            // 条件：当前会话标题为默认标题或由启发式生成的标题（即用户未手动自定义更名）
            const canUpgradeToAi = shouldSetHeuristic || targetConv.title === autoTitle;
            console.info("[AutoAiTitle] Candidate check for convId:", conversationId, {
              status,
              autoAiTitle: autoAiTitleRef.current,
              canUpgradeToAi,
              originalTitle: targetConv.title,
              heuristicTitle: autoTitle,
            });
            if (status === "complete" && autoAiTitleRef.current && canUpgradeToAi) {
              void (async () => {
                try {
                  console.info("[AutoAiTitle] Initiating AI title upgrade for convId:", conversationId);
                  const aiTitle = await generateAiTitle(conversationId, allMessages);
                  if (aiTitle) {
                    const latest = await servicesRef.current.repository.getConversation(conversationId);
                    if (latest && (latest.title === autoTitle || isDefaultTitle(latest.title))) {
                      await servicesRef.current.repository.renameConversation?.(conversationId, aiTitle);
                      if (mountedRef.current && stateRef.current.activeConversation?.id === conversationId) {
                        emit({ conversationId, title: aiTitle, type: "conversation-renamed" });
                      }
                      onConversationUpdatedRef.current?.();
                      console.info("[AutoAiTitle] Successfully upgraded conversation title to:", aiTitle);
                    }
                  }
                } catch (err) {
                  console.warn("[AutoAiTitle] Failed to upgrade title:", err);
                }
              })();
            }
          }
        }
        onConversationUpdatedRef.current?.();
      })();
      return run.finishing;
    },
    [emit, generateAiTitle, isForeground, isRunAlive, queueMessage, syncRunActivity],
  );

  const setReconnecting = useCallback(
    (run: ActiveRun, reconnecting: boolean) => {
      if (reconnecting) run.assistant = { ...run.assistant, reconnecting: true };
      else {
        const rest = { ...run.assistant };
        delete rest.reconnecting;
        run.assistant = rest;
      }
      if (isForeground(run.assistant.conversationId)) {
        emit({ type: "run-reconnecting", messageId: run.assistant.id, reconnecting });
      }
    },
    [emit, isForeground],
  );

  /**
   * 连接中断而运行已在网关登记：按最后处理的事件序号重新连接，回填并继续接收。
   * 不是连接中断（网关下发的错误、协议错误）或用户已停止时返回 undefined，由调用方按原错误处理
   */
  const reconnectRun = useCallback(
    async (run: ActiveRun, options: StreamChatOptions, error: unknown): Promise<StreamChatResult | RecoveredRun | undefined> => {
      const runId = run.assistant.run?.id;
      if (!isStreamDisconnect(error) || runId === undefined || run.runConfirmed !== true || run.controller.signal.aborted || !isRunAlive(run)) {
        return undefined;
      }
      setReconnecting(run, true);
      try {
        for (const delay of servicesRef.current.reconnectDelaysMs) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (!isRunAlive(run) || run.controller.signal.aborted) return undefined;
          try {
            const resumed = await servicesRef.current.resumeRun(runId, run.lastSeq ?? 0, options);
            if (resumed.kind === "unavailable") return { recovered: true, state: resumed.state };
            return resumed.result;
          } catch (next) {
            // 重连后再次断开：从新的序号继续重试；其他错误交给调用方
            if (!isStreamDisconnect(next)) throw next;
          }
        }
        return { recovered: true, state: { kind: "unreachable" } };
      } finally {
        if (isRunAlive(run)) setReconnecting(run, false);
      }
    },
    [isRunAlive, setReconnecting],
  );

  /** 没能接收到终止事件的运行：以网关记录的结局收尾，最后的输出缺失与无法确认的结果如实标记 */
  const finishRecoveredRun = useCallback(
    async (run: ActiveRun, recovered: RecoveredRun): Promise<void> => {
      if (!isRunAlive(run)) return;
      const recovery = recoveryFor(recovered.state, run.eventGap === true);
      run.assistant = { ...run.assistant, recovery };
      if (isForeground(run.assistant.conversationId)) {
        emit({ type: "recovery-changed", messageId: run.assistant.id, recovery });
      }
      if (recovery.status === "completed") await finishRun(run, "complete");
      else if (recovery.status === "failed") await finishRun(run, "failed", "PROVIDER_STREAM_ERROR");
      else if (recovery.status === "cancelled") await finishRun(run, "stopped", undefined, undefined, undefined, undefined, undefined, { confirmed: true });
      else await finishRun(run, "stopped");
    },
    [emit, finishRun, isForeground, isRunAlive],
  );

  /**
   * 驱动一次运行直到终态：事件回调写入运行缓冲并按需推送界面；连接中断而运行已在网关登记时，
   * 按最后处理的事件序号重新连接回填，不重新发起运行、不重放任何操作。
   * connect 发起首个连接：新运行是 /api/chat，接回已有运行是事件流重连。
   */
  const driveRun = useCallback(
    async (run: ActiveRun, connect: (options: StreamChatOptions) => Promise<StreamChatResult | RecoveredRun>): Promise<void> => {
      const conversationId = run.assistant.conversationId;
      const schedulePartialPersistence = () => {
        if (run.timer !== undefined || !isRunAlive(run)) return;
        run.timer = setTimeout(() => {
          run.timer = undefined;
          if (!isRunAlive(run)) return;
          void queueMessage({
            ...run.assistant,
            status: "streaming",
            text: run.text,
            contentSegments: run.contentSegments,
            contentStartedAtMs: run.contentStartedAtMs,
            ...(run.thought !== undefined ? { thought: run.thought } : {}),
            ...(run.provider !== undefined ? { provider: run.provider } : {}),
            ...(run.model !== undefined ? { model: run.model } : {}),
            ...(run.sources !== undefined ? { sources: run.sources } : {}),
            ...(run.lastSeq !== undefined ? { runEventSeq: run.lastSeq } : {}),
            ...(run.toolSteps.length > 0
              ? { toolSteps: run.toolSteps.map((step) => ({ ...step })) }
              : {}),
          }).catch(() => undefined);
        }, partialPersistenceInterval);
      };

      run.schedulePersistence = schedulePartialPersistence;

      // 命令增量输出按固定间隔合并推送到界面，避免高频输出逐条触发渲染
      const scheduleLiveOutputFlush = () => {
        if (run.liveOutputTimer !== undefined || !isRunAlive(run)) return;
        run.liveOutputTimer = setTimeout(() => {
          run.liveOutputTimer = undefined;
          if (!isRunAlive(run)) return;
          const dirty = [...run.liveOutputDirty];
          run.liveOutputDirty.clear();
          if (!isForeground(run.assistant.conversationId)) return;
          for (const callId of dirty) {
            const step = run.toolSteps.find((item) => item.id === callId);
            if (step?.liveOutput !== undefined && step.result === undefined) {
              emit({ type: "tool-output", messageId: run.assistant.id, callId, liveOutput: step.liveOutput });
            }
          }
        }, liveOutputFlushInterval);
      };

      const streamOptions: StreamChatOptions = {
        onDelta(text) {
          if (!isRunAlive(run) || text.length === 0) return;
          const start = run.text.length;
          const atMs = servicesRef.current.now() - run.startTime;
          run.contentStartedAtMs ??= atMs;
          run.text += text;
          run.contentSegments = appendContentSegment(run.contentSegments,
            { type: "text", start, end: run.text.length }, atMs);
          if (isForeground(conversationId)) {
            streamBatcherRef.current?.push({ messageId: run.assistant.id, text, type: "delta", contentSegments: run.contentSegments });
          }
          schedulePartialPersistence();
        },
        onNotice(code) {
          if (isRunAlive(run)) onNoticeRef.current?.(code);
        },
        onThought(text) {
          if (!isRunAlive(run) || text.length === 0) return;
          const start = run.thought?.length ?? 0;
          const atMs = servicesRef.current.now() - run.startTime;
          run.contentStartedAtMs ??= atMs;
          run.thought = (run.thought ?? "") + text;
          run.contentSegments = appendContentSegment(run.contentSegments,
            { type: "thought", start, end: run.thought.length, startedAtMs: atMs }, atMs);
          if (isForeground(conversationId)) {
            streamBatcherRef.current?.push({
              messageId: run.assistant.id,
              text,
              type: "thought-delta",
              contentSegments: run.contentSegments,
            });
          }
          schedulePartialPersistence();
        },
        onSources(sources) {
          if (!isRunAlive(run) || sources.length === 0) return;
          run.sources = sources;
          if (isForeground(conversationId)) emit({ messageId: run.assistant.id, sources, type: "sources-received" });
          schedulePartialPersistence();
        },
        onToolCall(call) {
          if (!isRunAlive(run)) return;
          const argumentsJson = JSON.stringify(call.arguments ?? {});
          const atMs = servicesRef.current.now() - run.startTime;
          run.contentStartedAtMs ??= atMs;
          const step: ToolStep = { id: call.id, name: call.name, argumentsJson, startedAtMs: atMs };
          run.toolSteps.push(step);
          run.contentSegments = appendContentSegment(run.contentSegments,
            { type: "tool", toolId: call.id }, atMs);
          if (isForeground(conversationId)) {
            // 工具边界前先提交 rAF 缓冲，避免稍后的增量覆盖工具位置。
            streamBatcherRef.current?.flush();
            emit({ messageId: run.assistant.id, call: step, type: "tool-call", contentSegments: run.contentSegments });
          }
          schedulePartialPersistence();
        },
        onToolOutput(output) {
          if (!isRunAlive(run)) return;
          const step = run.toolSteps.find((item) => item.id === output.id);
          if (step === undefined || step.result !== undefined) return;
          step.liveOutput = keepTail((step.liveOutput ?? "") + output.text, liveOutputLimit);
          run.liveOutputDirty.add(step.id);
          scheduleLiveOutputFlush();
          schedulePartialPersistence();
        },
        onToolResult(result) {
          if (!isRunAlive(run)) return;
          const step = run.toolSteps.find((s) => s.id === result.id);
          const timedResult = { output: result.output, isError: result.isError, durationMs: result.durationMs,
            endedAtMs: servicesRef.current.now() - run.startTime,
            ...(result.command !== undefined ? { command: result.command } : {}) };
          if (step !== undefined) {
            step.result = timedResult;
            delete step.liveOutput;
            run.liveOutputDirty.delete(step.id);
          }
          if (isForeground(conversationId)) {
            emit({
              messageId: run.assistant.id,
              callId: result.id,
              result: timedResult,
              type: "tool-result",
            });
          }
          schedulePartialPersistence();
        },
        onPermissionRequest(request) {
          if (!isRunAlive(run)) return;
          if (run.cancelling === true) return;
          run.pendingPermission = {
            messageId: run.assistant.id,
            requestId: request.requestId,
            toolName: request.toolName,
            argumentsJson: JSON.stringify(request.arguments ?? {}),
            ...(request.callId !== undefined ? { callId: request.callId } : {}),
          };
          syncRunActivity();
          if (isForeground(conversationId)) emit({ ...run.pendingPermission, type: "permission-requested" });
        },
        onPermissionResolved(resolved) {
          if (run.pendingPermission?.requestId === resolved.requestId) {
            run.pendingPermission = undefined;
            syncRunActivity();
          }
          if (isForeground(conversationId)) {
            emit({ type: "permission-resolved", requestId: resolved.requestId, approved: resolved.approved });
          }
        },
        onRunStatus(status) {
          if (!isRunAlive(run) || status.runId !== run.assistant.run?.id) return;
          if (status.status !== "cancelling") {
            const waiting = status.status === "waiting_for_workspace";
            if (run.waitingForWorkspace !== waiting) {
              run.waitingForWorkspace = waiting;
              syncRunActivity();
            }
          }
          if (!isForeground(conversationId)) return;
          if (status.status === "cancelling") {
            emit({ type: "run-cancelling", messageId: run.assistant.id, pending: status.pending });
          } else {
            // 等待同一项目中其他任务写入时说明原因；拿到写入权后恢复为运行中
            emit({ type: "run-waiting", messageId: run.assistant.id, pending: status.status === "waiting_for_workspace" ? status.pending : [] });
          }
        },
        onSupplementDelivered(delivered) {
          if (!isRunAlive(run) || delivered.runId !== run.assistant.run?.id) return;
          const supplements = (run.assistant.supplements ?? []).map((item) =>
            delivered.ids.includes(item.id) ? { ...item, state: "delivered" as const } : item,
          );
          run.assistant = { ...run.assistant, supplements };
          if (isForeground(conversationId)) {
            emit({ type: "supplements-changed", messageId: run.assistant.id, supplements });
          }
          schedulePartialPersistence();
        },
        onRunStarted(started) {
          const record = run.assistant.run;
          if (!isRunAlive(run) || record === undefined || started.runId !== record.id) return;
          run.runConfirmed = true;
          // 以网关解析后的规范路径为准记录运行归属
          const confirmed = { ...record, workspace: started.workspace };
          run.assistant = { ...run.assistant, run: confirmed };
          if (isForeground(conversationId)) {
            emit({ type: "run-started", messageId: run.assistant.id, run: confirmed });
          }
          schedulePartialPersistence();
        },
        onTurn(turn) {
          // Agent 多轮各自上报 usage 时逐轮累加；done 事件的最终 usage 优先（finishRun 取 usage ?? run.usage）
          if (!isRunAlive(run) || turn.usage === undefined) return;
          const previous = run.usage;
          run.usage = {
            promptTokens: (previous?.promptTokens ?? 0) + (turn.usage.promptTokens ?? 0),
            completionTokens: (previous?.completionTokens ?? 0) + (turn.usage.completionTokens ?? 0),
            totalTokens: (previous?.totalTokens ?? 0) + (turn.usage.totalTokens ?? 0),
          };
        },
        onEventSeq(seq) {
          if (isRunAlive(run)) run.lastSeq = seq;
        },
        onRunNote(note) {
          if (!isRunAlive(run)) return;
          const runNotes = [...(run.assistant.runNotes ?? []), note];
          run.assistant = { ...run.assistant, runNotes };
          if (isForeground(conversationId)) emit({ type: "run-notes-changed", messageId: run.assistant.id, runNotes });
          schedulePartialPersistence();
        },
        onEventGap() {
          // 网关已丢弃的那段过程无法回填，结束时如实说明
          if (isRunAlive(run)) run.eventGap = true;
        },
        signal: run.controller.signal,
      };

      try {
        let connected: StreamChatResult | RecoveredRun;
        try {
          connected = await connect(streamOptions);
        } catch (error) {
          const recovered = await reconnectRun(run, streamOptions, error);
          if (recovered === undefined) throw error;
          connected = recovered;
        }
        if ("recovered" in connected) {
          await finishRecoveredRun(run, connected);
          return;
        }
        const result = connected;
        if (result.stopReason === "cancelled") {
          const unknown = result.unknownOperations ?? [];
          await finishRun(run, "stopped", undefined, undefined, result.usage, undefined, undefined, {
            confirmed: unknown.length === 0,
            ...(unknown.length > 0 ? { unknown } : {}),
          });
          return;
        }
        if (run.controller.signal.aborted) {
          await finishRun(run, "stopped", undefined, undefined, undefined, undefined, undefined, cancellationForAbort(run));
          return;
        }
        if (run.eventGap === true) {
          const recovery: RunRecoveryRecord = { status: "completed", gap: true };
          run.assistant = { ...run.assistant, recovery };
          if (isForeground(conversationId)) emit({ type: "recovery-changed", messageId: run.assistant.id, recovery });
        }
        const loopStopped = result.stopReason === "loop_detected";
        // 上下文超限的说明已作为运行提示记录在消息上
        const contextOverflow = result.stopReason === "context_overflow";
        // 流正常结束但零输出（如推理模型思考耗尽 token 预算）视为可重试失败，避免空气泡被静默隐藏；
        // 循环叫停或上下文超限时已执行的工具步骤仍有价值，即使没有正文也按完成落盘
        const failed = run.text.length === 0 && !loopStopped && !contextOverflow;
        await finishRun(
          run,
          failed ? "failed" : "complete",
          failed ? "PROVIDER_ERROR" : undefined,
          failed ? undefined : result.truncated,
          result.usage,
          loopStopped,
        );
      } catch (error) {
        if (!isRunAlive(run)) return;
        const code =
          run.controller.signal.aborted
            ? "ABORTED"
            : error instanceof ChatClientError
              ? error.code
              : "SERVICE_UNAVAILABLE";
        // 网关透传的上游错误原因只随 PROVIDER_ERROR 展示，其余错误码已有专门文案
        const detail = error instanceof ChatClientError && error.code === "PROVIDER_ERROR" ? error.detail : undefined;
        if (code === "ABORTED") await finishRun(run, "stopped", undefined, undefined, undefined, undefined, undefined, cancellationForAbort(run));
        else await finishRun(run, "failed", code, undefined, undefined, undefined, detail);
      }
    },
    [emit, finishRun, finishRecoveredRun, isForeground, isRunAlive, queueMessage, reconnectRun, syncRunActivity],
  );

  /**
   * 残留为“运行中”的 Agent 消息（窗口刷新、应用重启）：向网关确认运行状态。
   * 运行仍在执行或刚结束、事件仍保留时重新连接，从头回放事件重建这条消息（包括仍在等待的审批）；
   * 否则依据运行记录标记结局（已完成但输出缺失、失败、已取消、被中断或未知），不重放任何操作。
   */
  const recoverStaleRun = useCallback(
    async (message: ChatMessage): Promise<void> => {
      const record = message.run;
      if (record === undefined || message.status !== "streaming") return;
      const conversationId = message.conversationId;
      if (runsRef.current.has(conversationId)) return;
      const state = await servicesRef.current.getRunState(record.id);
      if (!mountedRef.current || runsRef.current.has(conversationId)) return;

      if (state.kind === "active" || (state.kind === "finished" && state.retained)) {
        const assistant: ChatMessage = {
          id: message.id,
          conversationId,
          role: "assistant",
          createdAt: message.createdAt,
          status: "streaming",
          text: "",
          run: record,
          ...(message.provider !== undefined ? { provider: message.provider } : {}),
          ...(message.model !== undefined ? { model: message.model } : {}),
          ...(message.skills !== undefined ? { skills: message.skills } : {}),
          ...(message.supplements !== undefined ? { supplements: message.supplements } : {}),
          ...(message.branchRootId !== undefined ? { branchRootId: message.branchRootId } : {}),
          ...(message.branchVersion !== undefined ? { branchVersion: message.branchVersion } : {}),
        };
        const run: ActiveRun = {
          assistant,
          controller: new AbortController(),
          preparation: Promise.resolve(),
          text: "",
          ...(message.provider !== undefined ? { provider: message.provider } : {}),
          ...(message.model !== undefined ? { model: message.model } : {}),
          startTime: record.startedAt,
          toolSteps: [],
          contentSegments: [],
          token: ++runTokenRef.current,
          ended: Promise.resolve(),
          resolveEnded: () => undefined,
          liveOutputDirty: new Set(),
          runConfirmed: true,
        };
        run.ended = new Promise<void>((resolve) => { run.resolveEnded = resolve; });
        runsRef.current.set(conversationId, run);
        syncRunActivity();
        if (isForeground(conversationId)) emit({ type: "run-reattached", message: assistant });
        await driveRun(run, async (options) => {
          const resumed = await servicesRef.current.resumeRun(record.id, 0, options);
          return resumed.kind === "resumed" ? resumed.result : { recovered: true, state: resumed.state };
        });
        return;
      }

      const recovery = recoveryFor(state, false);
      const status = recovery.status === "completed" ? "complete" : recovery.status === "failed" ? "failed" : "stopped";
      const settled: ChatMessage = { ...message, status, recovery, ...(status === "stopped" ? { interrupted: true } : {}) };
      await queueMessage(settled).catch(() => undefined);
      if (isForeground(conversationId)) emit({ type: "run-recovered", message: settled });
      onConversationUpdatedRef.current?.();
    },
    [driveRun, emit, isForeground, queueMessage, syncRunActivity],
  );

  /** 启动时网关里仍在执行的运行（窗口刷新后）：找到各自会话里的残留消息并在后台接回 */
  const reattachBackgroundRuns = useCallback(async (): Promise<void> => {
    if (!isDesktopApp()) return;
    const active = await servicesRef.current.listActiveRuns();
    for (const item of active) {
      if (item.conversationId === undefined || runsRef.current.has(item.conversationId)) continue;
      const recent = await servicesRef.current.repository.listMessages(item.conversationId, { limit: 5 }).catch(() => []);
      const message = recent.find((candidate) => candidate.run?.id === item.runId && candidate.status === "streaming");
      if (message !== undefined) void recoverStaleRun(message);
    }
  }, [recoverStaleRun]);

  useEffect(() => {
    recoverStaleRunRef.current = recoverStaleRun;
    reattachBackgroundRunsRef.current = reattachBackgroundRuns;
  }, [reattachBackgroundRuns, recoverStaleRun]);

  const startAssistant = useCallback(
    async (
      history: ChatMessage[],
      user: ChatMessage | undefined,
      pendingImage?: StoredImage,
      branch?: { branchRootId: string; branchVersion: number },
      preparedAssistant?: ChatMessage,
      conversationSnapshot?: Conversation,
      /** 用户触发发送那一刻的执行模式；缺省取当前模式 */
      executionModeAtSubmit: AgentExecutionMode = agentModeRef.current,
    ): Promise<void> => {
      const conversation = conversationSnapshot ?? stateRef.current.activeConversation;
      const activeConfig = activeLlmConfigRef.current;
      const currentProvider = activeConfig?.provider ?? "stepfun";
      const currentModel = activeConfig?.model ?? "step-3.7-flash";
      const activeSkills = activeSkillsRef.current ?? [];
      const currentSkillNames = activeSkills.map((s) => s.name);
      // 运行身份在提交的同步阶段固定：之后的落盘、引用展开与请求期间切换项目或执行模式都不影响本次运行
      const runRecord = isDesktopApp()
        ? {
            id: servicesRef.current.runId(),
            workspace: conversation?.workspace ?? null,
            executionMode: executionModeAtSubmit,
            startedAt: servicesRef.current.now(),
          }
        : undefined;
      const assistant: ChatMessage = {
        conversationId: history.at(-1)?.conversationId ?? "",
        createdAt: nextTimestamp(),
        id: servicesRef.current.id(),
        role: "assistant",
        ...branch,
        text: "",
        provider: currentProvider,
        model: currentModel,
        ...(currentSkillNames.length > 0 ? { skills: currentSkillNames } : {}),
        ...preparedAssistant,
        ...(runRecord !== undefined ? { run: runRecord } : {}),
        status: "streaming",
      };

      const run: ActiveRun = {
        assistant,
        controller: new AbortController(),
        preparation: Promise.resolve(),
        text: "",
        provider: currentProvider,
        model: currentModel,
        startTime: servicesRef.current.now(),
        toolSteps: [],
        contentSegments: [],
        token: ++runTokenRef.current,
        ended: Promise.resolve(),
        resolveEnded: () => undefined,
        liveOutputDirty: new Set(),
      };
      run.ended = new Promise<void>((resolve) => { run.resolveEnded = resolve; });
      runsRef.current.set(assistant.conversationId, run);
      syncRunActivity();
      if (isForeground(assistant.conversationId)) emit({ assistant, type: "send-started", user });

      run.preparation = (async () => {
        if (user !== undefined) await queueMessage(user);
        if (pendingImage !== undefined) {
          await servicesRef.current.repository.putImage(pendingImage);
        }
        await queueMessage(assistant);
      })();

      try {
        await run.preparation;
      } catch {
        await finishRun(run, "failed", "STORAGE_ERROR");
        return;
      }
      if (!isRunAlive(run)) return;
      if (run.controller.signal.aborted) {
        await finishRun(run, "stopped");
        return;
      }

      await driveRun(run, async (options) => {
        const requestMessages = await makeRequestMessages(history, pendingImage, 0, undefined, conversation);
        const locale = conversation?.locale ?? stateRef.current.locale;
        const currentTime = formatClientTimestamp(servicesRef.current.now(), locale);
        // 思考档位只由桌面网关映射到各厂商参数；Web 端 Functions 不识别该字段
        const reasoningEffort = isDesktopApp() && activeConfig !== undefined ? readReasoningEffort(activeConfig) : undefined;
        const conversationId = run.assistant.conversationId;
        return await servicesRef.current.streamChat(
          {
            locale,
            messages: requestMessages,
            currentTime,
            ...(activeConfig !== undefined
              ? {
                  provider: activeConfig.provider,
                  apiKey: activeConfig.apiKey,
                  model: activeConfig.model,
                  ...(activeConfig.baseUrl !== undefined
                    ? { baseUrl: activeConfig.baseUrl }
                    : {}),
                  ...(activeConfig.keySlot !== undefined ? { keySlot: activeConfig.keySlot } : {}),
                  ...(activeConfig.custom !== undefined && activeConfig.baseUrl !== undefined
                    ? { customModel: customModelRequestOptions(activeConfig.custom) }
                    : {}),
                }
              : {}),
            ...(webSearchEnabledRef.current === true ? { webSearch: true } : {}),
            ...(webSearchEnabledRef.current === true && webSearchSmartRef.current === true
              ? { smartSearch: true }
              : {}),
            ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
            ...(runRecord !== undefined
              ? {
                  agent: {
                    enabled: true,
                    executionMode: runRecord.executionMode,
                    ...(runRecord.workspace !== null ? { workspace: runRecord.workspace } : {}),
                    runId: runRecord.id,
                    conversationId,
                    // 只有能收图的模型才会拿到 look 截图工具
                    vision: activeConfig !== undefined && supportsImageInput(activeConfig),
                    ...(activeConfig?.custom?.contextWindow !== undefined ? { contextWindow: activeConfig.custom.contextWindow } : {}),
                    ...(activeConfig?.custom !== undefined
                      ? { maxTurns: activeConfig.custom.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS }
                      : {}),
                  },
                }
              : {}),
          },
          options,
        );
      });
    },
    [driveRun, emit, finishRun, isForeground, isRunAlive, makeRequestMessages, nextTimestamp, queueMessage, syncRunActivity],
  );

  const compressConversation = useCallback(
    async (manual = true, allowSending = false): Promise<boolean> => {
      const snapshot = stateRef.current;
      if (
        (isSending(snapshot.activeConversation?.id) && !allowSending) ||
        snapshot.activeConversation === undefined ||
        snapshot.phase === "loading" ||
        snapshot.phase === "streaming" ||
        snapshot.phase === "compressing" ||
        snapshot.phase === "offline"
      ) {
        return false;
      }
      const conversationId = snapshot.activeConversation.id;

      // 增量压缩：只处理压缩边界之后的消息，已压缩区间由摘要取代
      const previousBoundary = snapshot.activeConversation.compressedUpTo;
      const uncompressedCount = countUncompressedMessages(snapshot.messages, previousBoundary);
      if (uncompressedCount <= 1) {
        return false;
      }

      const controller = new AbortController();
      compressRef.current = { controller, conversationId };
      // 由 send 内部调用时发送锁已由 send 持有
      const sendToken = allowSending ? undefined : ++sendTokenRef.current;
      if (sendToken !== undefined) sendingRef.current.set(conversationId, sendToken);
      emit({ type: "compress-started" });

      try {
        const summaryPrompt = compressionInstruction[snapshot.locale];

        const existingSummary = snapshot.activeConversation.summary?.trim();
        const hasExistingSummary = Boolean(existingSummary && existingSummary.length > 0);

        const existingUserMemory = snapshot.userMemory?.trim();
        const hasExistingUserMemory = Boolean(
          existingUserMemory && existingUserMemory.length > 0,
        );

        const priorSummaryUser = hasExistingSummary
          ? snapshot.locale === "ja-JP"
            ? `【既存の記憶要約】\n${existingSummary}`
            : `【已有记忆摘要】\n${existingSummary}`
          : "";
        const priorSummaryAssistant = hasExistingSummary
          ? snapshot.locale === "ja-JP"
            ? "（既存の要約を確認しました）"
            : "（已知悉既有摘要）"
          : "";

        const priorMemoryUser = hasExistingUserMemory
          ? snapshot.locale === "ja-JP"
            ? `【既存のユーザープロフィール】\n${existingUserMemory}`
            : `【现有用户画像】\n${existingUserMemory}`
          : "";
        const priorMemoryAssistant = hasExistingUserMemory
          ? snapshot.locale === "ja-JP"
            ? "（既存のプロフィールを確認しました）"
            : "（已知悉现有用户画像）"
          : "";

        const reservedChars =
          [...summaryPrompt].length +
          [...priorSummaryUser].length +
          [...priorSummaryAssistant].length +
          [...priorMemoryUser].length +
          [...priorMemoryAssistant].length;

        const reservedSlots =
          (hasExistingSummary ? 2 : 0) + (hasExistingUserMemory ? 2 : 0) + 1;
        const candidates = !manual && uncompressedCount > 4
          ? snapshot.messages.filter((message) => isHistoryMessage(message) && (previousBoundary === undefined || message.createdAt > previousBoundary)).slice(0, -4)
          : snapshot.messages;
        const history = requestHistory(
          candidates,
          reservedChars,
          maximumRequestMessages - reservedSlots,
          previousBoundary,
          true,
        );
        if (history.length === 0) { emit({ type: "clear-error" }); return false; }

        const requestMessages: StreamChatMessage[] = [];
        if (hasExistingSummary) {
          requestMessages.push(
            { role: "user", text: priorSummaryUser },
            { role: "assistant", text: priorSummaryAssistant },
          );
        }
        if (hasExistingUserMemory) {
          requestMessages.push(
            { role: "user", text: priorMemoryUser },
            { role: "assistant", text: priorMemoryAssistant },
          );
        }

        for (const { message, text } of history) {
          requestMessages.push({
            role: message.role,
            text: message.imageId === undefined ? text : withOmittedImageNote(text, snapshot.locale),
          });
        }

        requestMessages.push({ role: "user", text: summaryPrompt });

        const activeConfig = activeLlmConfigRef.current;
        let summaryText = "";

        await servicesRef.current.streamChat(
          {
            locale: snapshot.locale,
            messages: requestMessages,
            mode: "summary",
            ...(activeConfig !== undefined
              ? {
                  provider: activeConfig.provider,
                  apiKey: activeConfig.apiKey,
                  model: activeConfig.model,
                  ...(activeConfig.baseUrl !== undefined
                    ? { baseUrl: activeConfig.baseUrl }
                    : {}),
                  ...(activeConfig.keySlot !== undefined ? { keySlot: activeConfig.keySlot } : {}),
                  ...(activeConfig.custom !== undefined && activeConfig.baseUrl !== undefined
                    ? { customModel: customModelRequestOptions(activeConfig.custom) }
                    : {}),
                }
              : {}),
          },
          {
            onDelta(text) {
              summaryText += text;
            },
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) {
          if (isForeground(conversationId)) emit({ type: "clear-error" });
          return false;
        }

        const { conversationMemory, userProfile } = parseCompressionOutput(summaryText);
        if (conversationMemory.length > 0) {
          // 压缩边界推进到最后一条纳入本次摘要的消息；边界只前进不后退
          const lastIncluded = history[history.length - 1];
          const nextBoundary =
            lastIncluded !== undefined
              ? Math.max(lastIncluded.message.createdAt, previousBoundary ?? 0)
              : undefined;
          const nextBoundaryId = lastIncluded?.message.id;

          await servicesRef.current.repository.updateConversationSummary(
            conversationId,
            conversationMemory,
            nextTimestamp(),
            nextBoundary,
            nextBoundaryId,
          );
          if (userProfile !== undefined) {
            await servicesRef.current.repository.updateUserMemory(userProfile);
          }
          if (isForeground(conversationId) && !controller.signal.aborted) {
            emit({
              type: "context-compressed",
              summary: conversationMemory,
              ...(nextBoundary !== undefined ? { compressedUpTo: nextBoundary } : {}),
              ...(nextBoundaryId !== undefined ? { compressedUpToId: nextBoundaryId } : {}),
              ...(userProfile !== undefined ? { userMemory: userProfile } : {}),
            });
            return true;
          }
        }
        if (isForeground(conversationId)) emit({ type: "clear-error" });
        return false;
      } catch {
        if (isForeground(conversationId)) emit({ type: "clear-error" });
        return false;
      } finally {
        if (compressRef.current?.controller === controller) {
          compressRef.current = undefined;
        }
        if (sendToken !== undefined && sendingRef.current.get(conversationId) === sendToken) {
          sendingRef.current.delete(conversationId);
        }
      }
    },
    [emit, isForeground, isSending, nextTimestamp],
  );

  const stopConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      const compress = compressRef.current;
      if (compress !== undefined && compress.conversationId === conversationId) {
        compressRef.current = undefined;
        compress.controller.abort();
        if (isForeground(conversationId)) emit({ type: "clear-error" });
      }
      const run = runsRef.current.get(conversationId);
      if (run === undefined) return;
      const runId = run.assistant.run?.id;
      // 网关已确认的运行走显式取消：连接保持，等命令终止并确认后以 cancelled 结束，
      // 界面在此期间显示“正在取消”，而不是立即断言所有操作已停止
      if (runId !== undefined && run.runConfirmed === true && !run.controller.signal.aborted) {
        if (run.cancelling !== true) {
          run.cancelling = true;
          run.pendingPermission = undefined;
          syncRunActivity();
          if (isForeground(conversationId)) emit({ type: "run-cancelling", messageId: run.assistant.id });
          const requested = await cancelAgentRun(runId);
          if (requested !== "failed" && (await settlesWithin(run.ended, cancelSettleTimeoutMs))) return;
        } else if (await settlesWithin(run.ended, cancelSettleTimeoutMs)) {
          return;
        }
        if (!isRunAlive(run)) return;
      }
      run.controller.abort();
      await run.preparation.catch(() => undefined);
      await finishRun(run, "stopped", undefined, undefined, undefined, undefined, undefined, cancellationForAbort(run));
    },
    [emit, finishRun, isForeground, isRunAlive, syncRunActivity],
  );

  /** 只停止某条运行中的命令，运行继续 */
  const updateSupplements = useCallback(
    (run: ActiveRun, update: (current: ReadonlyArray<SupplementRecord>) => ReadonlyArray<SupplementRecord>) => {
      const next = update(run.assistant.supplements ?? []);
      run.assistant = { ...run.assistant, supplements: next };
      if (isForeground(run.assistant.conversationId)) {
        emit({ type: "supplements-changed", messageId: run.assistant.id, supplements: next });
      }
      run.schedulePersistence?.();
    },
    [emit, isForeground],
  );

  /** 当前会话的 Agent 运行中追加补充要求：排队等待下一次调用模型前送达，不中断任务 */
  const supplement = useCallback(
    async (text: string): Promise<SupplementResult> => {
      const normalized = text.trim();
      const conversationId = stateRef.current.activeConversation?.id;
      const run = conversationId === undefined ? undefined : runsRef.current.get(conversationId);
      const runId = run?.assistant.run?.id;
      if (normalized.length === 0 || run === undefined || runId === undefined || !isRunAlive(run) || run.runConfirmed !== true || run.cancelling === true) {
        return "unavailable";
      }
      // 补充编号单独生成，不占用消息 id 序列
      const record: SupplementRecord = { id: crypto.randomUUID(), text: normalized, createdAt: servicesRef.current.now(), state: "queued" };
      updateSupplements(run, (current) => [...current, record]);
      const result = await submitAgentSupplement(runId, record.id, record.text);
      if (result.status === "queued") return "queued";
      // 网关拒绝（运行正在收尾或已取消）：补充没有排上，运行若已结束则 finishRun 已标记
      if (isRunAlive(run)) {
        updateSupplements(run, (current) => current.map((item) => (item.id === record.id && item.state === "queued" ? { ...item, state: "undelivered" as const } : item)));
      }
      return "undelivered";
    },
    [isRunAlive, updateSupplements],
  );

  const stopToolCall = useCallback(async (callId: string): Promise<boolean> => {
    const run = [...runsRef.current.values()].find((item) => item.toolSteps.some((step) => step.id === callId));
    const runId = run?.assistant.run?.id;
    if (run === undefined || runId === undefined || run.runConfirmed !== true) return false;
    return await stopAgentToolCall(runId, callId);
  }, []);

  /** 只停止当前显示的会话，后台会话继续运行 */
  const stop = useCallback(async (): Promise<void> => {
    const conversationId = stateRef.current.activeConversation?.id;
    if (conversationId !== undefined) await stopConversation(conversationId);
  }, [stopConversation]);

  /** 同一会话同一时刻只允许一个发送/重试/分支操作；不同会话互不阻塞 */
  const withSendingLock = useCallback(async (conversationId: string, task: () => Promise<void>) => {
    const token = ++sendTokenRef.current;
    sendingRef.current.set(conversationId, token);
    try {
      await task();
    } finally {
      if (sendingRef.current.get(conversationId) === token) sendingRef.current.delete(conversationId);
    }
  }, []);

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim() && !stateRef.current.pendingImage) return;
      // 空白会话绑定到用户按下发送时选中的项目，之后的异步准备期间切换项目不影响本次任务
      const activeProjectAtSubmit = projectManager.getState().activeProject;
      const executionModeAtSubmit = agentModeRef.current;
      if (stateRef.current.phase === "streaming") {
        const streamingId = stateRef.current.activeConversation?.id;
        await stop();
        if (streamingId !== undefined) sendingRef.current.delete(streamingId);
      }
      const snapshot = stateRef.current;
      if (
        isSending(snapshot.activeConversation?.id) ||
        snapshot.activeConversation === undefined ||
        snapshot.phase === "loading" ||
        snapshot.phase === "streaming" ||
        snapshot.phase === "compressing" ||
        snapshot.phase === "offline"
      ) {
        return;
      }

      const normalized = text.trim();
      const pendingImage = snapshot.pendingImage;
      if (normalized.length === 0 && pendingImage === undefined) return;

      const targetConversationId = snapshot.activeConversation.id;
      const binding = workspaceBinding(
        snapshot.activeConversation,
        snapshot.messages.length > 0 || Boolean(snapshot.activeConversation.summary),
      );
      const bindWorkspace = isDesktopApp() && binding.kind === "pending";
      const runWorkspace = runWorkspaceFor(binding, activeProjectAtSubmit);
      await withSendingLock(targetConversationId, async () => {
        try {
          if (bindWorkspace) {
            await servicesRef.current.repository.setConversationWorkspace(targetConversationId, runWorkspace);
            if (isForeground(targetConversationId)) {
              emit({ type: "conversation-workspace-bound", conversationId: targetConversationId, workspace: runWorkspace });
            }
            onConversationUpdatedRef.current?.();
          }
          // 未压缩历史达到阈值时先增量压缩，再发送（为摘要/长期记忆前缀预留槽位）；
          // 压缩基于界面状态，用户切走后不再继续压缩
          while (
            isForeground(targetConversationId) &&
            (countUncompressedMessages(
              stateRef.current.messages,
              stateRef.current.activeConversation?.compressedUpTo,
            ) >= compressionTriggerUncompressedMessages || shouldCompressContext(stateRef.current.messages, stateRef.current.activeConversation?.compressedUpTo, stateRef.current.activeConversation?.summary))
          ) {
            const compressed = await compressConversation(false, true);
            if (!mountedRef.current || stateRef.current.phase === "offline") return;
            if (!compressed) break;
          }
          if (!mountedRef.current || stateRef.current.phase === "offline") return;

          // 压缩期间用户切到了别的会话：消息照常发出，运行直接转入后台
          const foreground = isForeground(targetConversationId);
          const loadedConversation = foreground
            ? stateRef.current.activeConversation
            : await servicesRef.current.repository.getConversation(targetConversationId);
          if (loadedConversation === undefined) return;
          const conversation = bindWorkspace ? { ...loadedConversation, workspace: runWorkspace } : loadedConversation;
          const history = foreground
            ? stateRef.current.messages
            : await servicesRef.current.repository.listMessages(targetConversationId, { limit: historyWindowSize });

          const image =
            pendingImage === undefined ? undefined : { ...pendingImage, conversationId: targetConversationId };
          const user: ChatMessage = {
            conversationId: targetConversationId,
            createdAt: nextTimestamp(),
            ...(image === undefined ? {} : { imageId: image.id }),
            id: servicesRef.current.id(),
            role: "user",
            status: "complete",
            text: normalized,
          };
          await startAssistant([...history, user], user, image, undefined, undefined, conversation, executionModeAtSubmit);
        } catch {
          if (isForeground(targetConversationId)) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        }
      });
    },
    [compressConversation, emit, isForeground, isSending, nextTimestamp, startAssistant, stop, withSendingLock],
  );

  const retry = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    if (
      isSending(snapshot.activeConversation?.id) ||
      snapshot.activeConversation === undefined ||
      snapshot.phase === "loading" ||
      snapshot.phase === "streaming" ||
      snapshot.phase === "offline" ||
      !isRetryableChatErrorCode(snapshot.errorCode) ||
      !snapshot.messages.some(({ role }) => role === "user")
    ) {
      return;
    }
    const executionModeAtSubmit = agentModeRef.current;
    await withSendingLock(snapshot.activeConversation.id, () =>
      startAssistant(snapshot.messages, undefined, undefined, undefined, undefined, undefined, executionModeAtSubmit),
    );
  }, [isSending, startAssistant, withSendingLock]);

  const recall = useCallback(async (): Promise<RecalledMessageData | undefined> => {
    const snapshot = stateRef.current;
    if (
      snapshot.activeConversation === undefined ||
      snapshot.phase === "loading" ||
      snapshot.phase === "compressing"
    ) {
      return undefined;
    }

    const messages = snapshot.messages;
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }

    if (lastUserIndex === -1) {
      return undefined;
    }

    const conversationId = snapshot.activeConversation.id;
    const compress = compressRef.current;
    if (compress !== undefined && compress.conversationId === conversationId) {
      compressRef.current = undefined;
      compress.controller.abort();
      emit({ type: "clear-error" });
    }

    const active = runsRef.current.get(conversationId);
    if (active !== undefined) {
      runsRef.current.delete(conversationId);
      syncRunActivity();
      if (active.timer !== undefined) clearTimeout(active.timer);
      streamBatcherRef.current?.flush();
      active.controller.abort();
    }

    const recalledUser = messages[lastUserIndex];
    if (recalledUser === undefined) return undefined;

    const remainingMessages = messages.slice(0, lastUserIndex);

    try {
      const task = persistQueueRef.current.then(async () => {
        // 水位线定点删除：撤回目标及其后的所有记录（含未加载的窗口外消息），保留区不动
        await servicesRef.current.repository.deleteMessagesFrom(
          conversationId,
          recalledUser.createdAt,
        );
      });
      persistQueueRef.current = task.catch(() => undefined);
      await task;

      if (mountedRef.current) {
        emit({ messages: remainingMessages, type: "messages-reverted" });
      }

      return {
        imageId: recalledUser.imageId,
        text: recalledUser.text,
      };
    } catch {
      if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      return undefined;
    }
  }, [emit, syncRunActivity]);

  const forkMessage = useCallback(async (messageId: string, text?: string): Promise<void> => {
    const current = stateRef.current;
    if (isSending(current.activeConversation?.id) || !current.activeConversation || ["loading", "streaming", "compressing", "offline"].includes(current.phase)) return;
    if (text !== undefined && !text.trim()) return;
    const conversationId = current.activeConversation.id;
    const executionModeAtSubmit = agentModeRef.current;
    await withSendingLock(conversationId, async () => { try {
      if (!current.activeConversation) return;
      await persistQueueRef.current;
      const messages = await servicesRef.current.repository.listMessages(current.activeConversation.id);
      const index = messages.findIndex((message) => message.id === messageId);
      const target = messages[index];
      if (!target || (text !== undefined && target.role !== "user") || (text === undefined && target.role !== "assistant")) return;
      const fork = archiveBranch(current.activeConversation, messages, target);
      const preceding = messages.slice(0, index);
      const branch = { branchRootId: fork.rootId, branchVersion: fork.version };
      const user: ChatMessage | undefined = text === undefined ? undefined : {
        ...target, ...branch, id: servicesRef.current.id(), text: text.trim(), createdAt: nextTimestamp(), status: "complete",
      };
      if (!user && !preceding.some((message) => message.role === "user")) return;
      const preparedAssistant: ChatMessage | undefined = user ? undefined : {
        conversationId: current.activeConversation.id, id: servicesRef.current.id(), createdAt: nextTimestamp(),
        role: "assistant", status: "stopped", text: "", ...branch,
      };
      // 分支锚点与旧路径在同一事务提交，生成或后续写入失败仍能切回旧版本。
      await servicesRef.current.repository.saveBranchState(fork.conversation, [...preceding, ...(user ? [user] : [preparedAssistant!])]);
      if (stateRef.current.activeConversation?.id !== current.activeConversation.id || !mountedRef.current) return;
      emit({ type: "conversation-selected", conversation: fork.conversation, messages: preceding, hasMoreHistory: false });
      while (countUncompressedMessages(stateRef.current.messages, stateRef.current.activeConversation?.compressedUpTo) >= compressionTriggerUncompressedMessages || shouldCompressContext(stateRef.current.messages, stateRef.current.activeConversation?.compressedUpTo, stateRef.current.activeConversation?.summary)) {
        const compressed = await compressConversation(false, true);
        if (!mountedRef.current || stateRef.current.activeConversation?.id !== current.activeConversation.id) return;
        if (!compressed) break;
      }
      await startAssistant(user ? [...preceding, user] : preceding, user, undefined, user ? undefined : branch, preparedAssistant, undefined, executionModeAtSubmit);
      onConversationUpdatedRef.current?.();
    } catch {
      if (isForeground(conversationId)) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
    } });
  }, [compressConversation, emit, isForeground, isSending, nextTimestamp, startAssistant, withSendingLock]);

  const editMessage = useCallback((messageId: string, text: string) => forkMessage(messageId, text), [forkMessage]);
  const regenerate = useCallback(async (messageId?: string): Promise<void> => {
    const target = messageId ?? [...stateRef.current.messages].reverse().find((message) => message.role === "assistant")?.id;
    if (target) await forkMessage(target);
  }, [forkMessage]);
  const switchBranch = useCallback(async (messageId: string, version: number): Promise<void> => {
    const current = stateRef.current;
    if (isSending(current.activeConversation?.id) || !current.activeConversation || !["idle", "error"].includes(current.phase)) return;
    await withSendingLock(current.activeConversation.id, async () => { try {
      if (!current.activeConversation) return;
      await persistQueueRef.current;
      const messages = await servicesRef.current.repository.listMessages(current.activeConversation.id);
      const target = messages.find((message) => message.id === messageId);
      if (!target) return;
      const restored = restoreBranch(current.activeConversation, messages, target, version);
      await servicesRef.current.repository.saveBranchState(restored.conversation, restored.messages);
      if (mountedRef.current && stateRef.current.activeConversation?.id === current.activeConversation.id)
        emit({ type: "conversation-selected", conversation: restored.conversation, messages: restored.messages, hasMoreHistory: false });
    } catch { if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" }); } });
  }, [emit, isSending, withSendingLock]);

  const selectConversation = useCallback(
    async (id: string): Promise<void> => {
      // 切换会话不停止任何运行：离开的会话转入后台继续，切回运行中的会话时接上实时进度
      try {
        const conversation = await servicesRef.current.repository.getConversation(id);
        if (conversation === undefined) throw new TypeError("Conversation is missing.");
        // 先等已排队的写入落盘，避免读到刚结束的后台运行的旧快照
        await persistQueueRef.current;
        // UI 窗口化：切换会话同样只加载最近 windowSize 条，多取 1 条探测更早历史
        const stored = await servicesRef.current.repository.listMessages(id, {
          limit: historyWindowSize + 1,
        });
        const hasMoreHistory = stored.length > historyWindowSize;
        const messages = hasMoreHistory ? stored.slice(1) : stored;
        let currentConv = conversation;
        const autoTitle = generateConversationTitle(messages, currentConv.locale);
        if (isDefaultTitle(currentConv.title)) {
          if (!isDefaultTitle(autoTitle)) {
            currentConv = { ...currentConv, title: autoTitle };
            void servicesRef.current.repository.renameConversation?.(id, autoTitle);
            onConversationUpdatedRef.current?.();
          }
        }
        await servicesRef.current.repository.setLocale(currentConv.locale);
        // 以下同步执行到派发为止，保证实时快照与之后到达的增量首尾衔接
        const run = runsRef.current.get(id);
        const visible = messages.map((message) =>
          message.status === "streaming" && message.id !== run?.assistant.id
            ? { ...message, status: "stopped" as const }
            : message,
        );
        streamBatcherRef.current?.flush();
        emit({
          conversation: currentConv,
          messages: run === undefined ? visible : withLiveRun(visible, run),
          type: "conversation-selected",
          ...(hasMoreHistory ? { hasMoreHistory: true } : {}),
          ...(run !== undefined ? { running: true } : {}),
          ...(run?.pendingPermission !== undefined ? { pendingPermission: run.pendingPermission } : {}),
        });
        focusConversationProject(currentConv);
        if (run === undefined) {
          for (const message of messages.filter(isStaleAgentRun)) void recoverStaleRunRef.current?.(message);
        }
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    },
    [emit],
  );

  const renameConversation = useCallback(
    async (id: string, title: string): Promise<void> => {
      const normalized = title.trim();
      if (!normalized) return;
      await servicesRef.current.repository.renameConversation?.(id, normalized);
      if (mountedRef.current && stateRef.current.activeConversation?.id === id) {
        emit({ conversationId: id, title: normalized, type: "conversation-renamed" });
      }
      onConversationUpdatedRef.current?.();
    },
    [emit],
  );

  const newConversation = useCallback(async (): Promise<void> => {
    if (newConversationLockRef.current) return;
    newConversationLockRef.current = true;
    try {
      const currentActive = stateRef.current.activeConversation;
      // 1. 防御：如果当前活跃会话无消息且未在发送中，复用当前会话，避免在空会话中无限繁殖新记录
      if (currentActive !== undefined && stateRef.current.messages.length === 0 && !isSending(currentActive.id)) {
        const currentStored = await servicesRef.current.repository.getConversation(currentActive.id);
        if (currentStored !== undefined) {
          const storedMsgs = await servicesRef.current.repository.listMessages(currentActive.id, { limit: 1 });
          if (storedMsgs.length === 0) {
            return;
          }
        }
      }

      // 2. 检查会话列表中是否已有未使用的空白会话（无消息且为默认标题），若有则直接复用
      const existingList = await servicesRef.current.repository.listConversations();
      const blankConversations: Conversation[] = [];
      for (const conv of existingList) {
        // 刚开始运行的会话可能还没把首条消息写进存储，不能当作空白会话复用或清理
        if (
          conv.id === currentActive?.id ||
          conv.archivedAt !== undefined ||
          runsRef.current.has(conv.id) ||
          isSending(conv.id)
        ) {
          continue;
        }
        if (isDefaultTitle(conv.title)) {
          const msgs = await servicesRef.current.repository.listMessages(conv.id, { limit: 1 });
          if (msgs.length === 0) {
            blankConversations.push(conv);
          }
        }
      }

      if (blankConversations.length > 0) {
        const [target, ...redundant] = blankConversations;
        if (servicesRef.current.repository.deleteConversation) {
          for (const extra of redundant) {
            void servicesRef.current.repository.deleteConversation(extra.id).catch(() => undefined);
          }
        }
        await selectConversation(target!.id);
        return;
      }

      // 3. 所有已有会话均有消息（或无已有空会话），创建新的空白会话
      try {
        const loaded = await createConversation(stateRef.current.locale);
        streamBatcherRef.current?.flush();
        emit({
          conversation: loaded.conversation,
          messages: loaded.messages,
          type: "conversation-selected",
          ...(loaded.hasMoreHistory ? { hasMoreHistory: true } : {}),
        });
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    } finally {
      newConversationLockRef.current = false;
    }
  }, [createConversation, emit, isSending, selectConversation]);

  const loadEarlier = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    const conversation = snapshot.activeConversation;
    const oldest = snapshot.messages[0];
    if (conversation === undefined || oldest === undefined) return;
    try {
      // 排他上界 = 当前窗口最早一条，避免与已加载区间重叠
      const earlier = await servicesRef.current.repository.listMessages(conversation.id, {
        beforeCreatedAt: oldest.createdAt,
        limit: historyLoadStep,
      });
      if (mountedRef.current && stateRef.current.activeConversation?.id === conversation.id) {
        emit({ messages: earlier, type: "load-earlier-loaded" });
      }
    } catch {
      if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
    }
  }, [emit]);

  const setLocale = useCallback(
    async (locale: Locale): Promise<void> => {
      await stop();
      try {
        await servicesRef.current.repository.setLocale(locale);
        const conversation = stateRef.current.activeConversation;
        if (conversation !== undefined) {
          await servicesRef.current.repository.setConversationLocale(conversation.id, locale);
        }
        emit({ locale, type: "locale-changed" });
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    },
    [emit, stop],
  );

  const setPendingImage = useCallback(
    (image?: StoredImage) => emit({ image, type: "pending-image-changed" }),
    [emit],
  );

  const setOnline = useCallback(
    (online: boolean) => {
      if (!online) {
        for (const conversationId of [...runsRef.current.keys()]) void stopConversation(conversationId);
      }
      emit({ online, type: "connectivity-changed" });
    },
    [emit, stopConversation],
  );

  const updateUserMemory = useCallback(
    async (memory: string): Promise<boolean> => {
      const normalized = memory.trim();
      try {
        await servicesRef.current.repository.updateUserMemory(normalized);
        if (mountedRef.current) emit({ type: "user-memory-updated", memory: normalized });
        return true;
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        return false;
      }
    },
    [emit],
  );

  const clearError = useCallback(() => emit({ type: "clear-error" }), [emit]);

  const bindConversationWorkspace = useCallback(
    async (workspace: string): Promise<boolean> => {
      const conversation = stateRef.current.activeConversation;
      if (
        conversation === undefined ||
        typeof conversation.workspace === "string" ||
        runsRef.current.has(conversation.id) ||
        isSending(conversation.id)
      ) {
        return false;
      }
      try {
        await servicesRef.current.repository.setConversationWorkspace(conversation.id, workspace);
      } catch {
        return false;
      }
      if (isForeground(conversation.id)) {
        emit({ type: "conversation-workspace-bound", conversationId: conversation.id, workspace });
      }
      onConversationUpdatedRef.current?.();
      return true;
    },
    [emit, isForeground, isSending],
  );

  const approvePermission = useCallback(
    async (requestId: string, approved: boolean, sessionScope = false): Promise<boolean> => {
      // 审批绑定所属运行：取消中或已结束的运行不再回填决定
      const run = [...runsRef.current.values()].find((item) => item.pendingPermission?.requestId === requestId);
      const runId = run?.assistant.run?.id;
      if (run === undefined || runId === undefined || run.cancelling === true) return false;
      return await submitAgentApproval({ runId, requestId, approved, ...(sessionScope ? { sessionScope: true } : {}) });
    },
    [],
  );

  return {
    ...state,
    messages: overlayStreamedText(state),
    agentMode,
    agentEnabled,
    approvePermission,
    clearError,
    newConversation,
    loadEarlier,
    pendingPermission: state.pendingPermission,
    recall,
    regenerate,
    editMessage,
    switchBranch,
    setExecutionMode,
    retry,
    selectConversation,
    renameConversation,
    generateAiTitle,
    send,
    compressConversation,
    toggleAgent,
    updateUserMemory,
    setLocale,
    setOnline,
    setPendingImage,
    stop,
    stopConversation,
    runningConversations,
    bindConversationWorkspace,
    stopToolCall,
    supplement,
  };
}

/**
 * 打开已绑定项目的会话时，把界面浏览的项目对齐到该会话的项目，
 * 使文件树、编辑器与审阅显示的正是这个任务操作的项目；未绑定的会话不改变当前项目
 */
function focusConversationProject(conversation: Conversation): void {
  if (!isDesktopApp() || typeof conversation.workspace !== "string") return;
  if (sameWorkspace(conversation.workspace, projectManager.getState().activeProject)) return;
  void projectManager.switchProject(conversation.workspace);
}

/**
 * 运行中消息的实时快照：存储里的部分持久化按 250ms 节流、可能落后，
 * 切回前台时以内存中的运行缓冲为准
 */
function withLiveRun(messages: ChatMessage[], run: ActiveRun): ChatMessage[] {
  const live: ChatMessage = {
    ...run.assistant,
    status: "streaming",
    text: run.text,
    contentSegments: run.contentSegments,
    ...(run.contentStartedAtMs !== undefined ? { contentStartedAtMs: run.contentStartedAtMs } : {}),
    ...(run.thought !== undefined ? { thought: run.thought } : {}),
    ...(run.sources !== undefined ? { sources: run.sources } : {}),
    ...(run.toolSteps.length > 0 ? { toolSteps: run.toolSteps.map((step) => ({ ...step })) } : {}),
    ...(run.cancelling === true ? { cancelRequested: true } : {}),
  };
  const index = messages.findIndex((message) => message.id === live.id);
  return index < 0 ? [...messages, live] : messages.map((message, i) => (i === index ? live : message));
}

/** 工具步骤参数 JSON 的宽松解析：非法 JSON 回退为空对象（服务端/模型输出不可信） */
function safeParseArguments(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
}
