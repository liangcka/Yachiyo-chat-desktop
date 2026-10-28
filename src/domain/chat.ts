export type Locale = "zh-CN" | "ja-JP";

export type MessageStatus = "complete" | "streaming" | "failed" | "stopped";

export interface Conversation {
  id: string;
  title: string;
  locale: Locale;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  lastCompressedAt?: number;
  /** 最后一条已压缩消息的 createdAt；早于此值的消息已被摘要取代，不再进入请求历史 */
  compressedUpTo?: number;
  /** 最后一条已压缩消息的 id；用于消息级精确因果回溯 */
  compressedUpToId?: string;
  branches?: MessageBranch[];
  /** 归档时间；存在即表示已归档，侧栏收进「已归档」分组，启动时不再自动打开 */
  archivedAt?: number;
  /**
   * 任务归属的项目（原生层返回的规范路径），在首次提交任务时确定，之后不随界面的项目选择变化。
   * null 表示明确不绑定项目；缺省为早于该字段的旧会话，归属未知，需要用户显式绑定。
   */
  workspace?: string | null;
  /** 最近一次 Agent 运行的状态（随 assistant 消息写入）；侧栏据此显示失败、已停止或被中断的任务 */
  lastRun?: ConversationRunState;
}

export interface ConversationRunState {
  readonly runId: string;
  readonly messageId: string;
  readonly messageCreatedAt: number;
  /** streaming 表示写入时仍在运行：界面没有对应的活跃运行时即为被中断 */
  readonly status: MessageStatus;
}

/** 消息对应的运行状态快照；非 Agent 运行的消息返回 undefined */
export function runStateOf(message: ChatMessage): ConversationRunState | undefined {
  return message.role === "assistant" && message.run !== undefined
    ? { runId: message.run.id, messageId: message.id, messageCreatedAt: message.createdAt, status: message.status }
    : undefined;
}

export function latestRunState(messages: ReadonlyArray<ChatMessage>): ConversationRunState | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const state = runStateOf(messages[index]!);
    if (state !== undefined) return state;
  }
  return undefined;
}

export type AgentExecutionMode = "readonly" | "confirm" | "full_auto";

/** 一次 Agent 运行的身份快照：与发起它的 assistant 消息一同持久化，供审阅、恢复与排查定位 */
export interface AgentRunRecord {
  readonly id: string;
  /** 运行实际使用的工作区；null 表示该运行未绑定项目 */
  readonly workspace: string | null;
  readonly executionMode: AgentExecutionMode;
  readonly startedAt: number;
}

/**
 * 运行中追加的补充要求：queued 已排队等待下一轮，delivered 已交给模型，
 * undelivered 运行结束前没有送达（或网关拒绝），需要用户决定是否作为新消息发送
 */
export interface SupplementRecord {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
  readonly state: "queued" | "delivered" | "undelivered";
}

/** 运行过程中网关给出的说明（run_note 事件） */
export type RunNoteRecord =
  | {
      readonly kind: "context_compacted";
      readonly foldedTurns: number;
      readonly beforeTokens: number;
      readonly afterTokens: number;
    }
  | { readonly kind: "context_overflow"; readonly tokens: number; readonly budgetTokens: number }
  | { readonly kind: "verification_reminder"; readonly reason: "not_verified"; readonly files: ReadonlyArray<string> }
  | { readonly kind: "verification_reminder"; readonly reason: "verification_failed"; readonly command: string };

/**
 * completed / failed / cancelled：网关记录的结局，但最后的输出没有接收到；
 * interrupted：运行在结束前随进程退出；unknown：网关没有记录或无法连接，结果无法确认
 */
export interface RunRecoveryRecord {
  readonly status: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
  /** 网关已丢弃部分过程事件，界面上的过程不完整 */
  readonly gap?: boolean;
}

export type WorkspaceBinding =
  | { readonly kind: "bound"; readonly workspace: string }
  | { readonly kind: "none" }
  /** 空白会话：首次提交时绑定到当时选中的项目 */
  | { readonly kind: "pending" }
  /** 已有消息但没有归属记录的旧会话：不得默认采用当前项目 */
  | { readonly kind: "legacy" };

export function workspaceBinding(conversation: Conversation | undefined, hasMessages: boolean): WorkspaceBinding {
  const workspace = conversation?.workspace;
  if (typeof workspace === "string") return { kind: "bound", workspace };
  if (workspace === null) return { kind: "none" };
  return hasMessages ? { kind: "legacy" } : { kind: "pending" };
}

/** 运行应使用的工作区：只有空白会话会采用提交时选中的项目，其余一律以会话记录为准 */
export function runWorkspaceFor(binding: WorkspaceBinding, activeProjectAtSubmit: string | null): string | null {
  if (binding.kind === "bound") return binding.workspace;
  if (binding.kind === "pending") return activeProjectAtSubmit;
  return null;
}

/** 备选路径保留完整消息及其摘要边界，避免恢复时混入另一版本的上下文。 */
export interface MessageBranch {
  rootId: string;
  version: number;
  messages: ChatMessage[];
  summary?: string;
  compressedUpTo?: number;
  compressedUpToId?: string;
}

/** 联网搜索返回的参考来源 */
export interface ChatSource {
  readonly title: string;
  readonly url: string;
}

/** 消息消耗的 Token 统计（来自 upstream 模型返回） */
export interface TokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export type CommandEndReason = "exited" | "timed_out" | "cancelled" | "spawn_failed" | "blocked";

/** 网关回报的命令执行记录：判断命令成功与否的唯一依据，不从输出文字或模型回复里推断 */
export interface CommandRecord {
  readonly executionId: string;
  readonly command: string;
  readonly cwd: string;
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly endReason: CommandEndReason;
  /** 结束时整棵进程树已确认退出；false 表示可能仍有进程在运行，结果未知 */
  readonly exitConfirmed: boolean;
  readonly orphansTerminated?: boolean;
  readonly outputBytes: number;
  readonly truncated: boolean;
  /** 完整输出日志（工作区相对路径） */
  readonly logPath?: string;
}

/** Agent 工具执行步骤（调用 + 可选结果），随 assistant 消息持久化 */
export interface ToolStep {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  /** 相对本轮请求开始的时间，包含权限等待。旧记录可缺省。 */
  readonly startedAtMs?: number;
  /** 运行中命令输出的末尾片段，结果到达后清除 */
  readonly liveOutput?: string;
  readonly result?: {
    readonly output: string;
    readonly isError: boolean;
    readonly durationMs: number;
    readonly endedAtMs?: number;
    readonly command?: CommandRecord;
  };
}

/** 取消收尾中仍在等待或结果无法确认的操作 */
export interface PendingOperationRecord {
  readonly callId: string;
  readonly name: string;
  readonly detail: string;
}

/** 运行被取消后的收尾结论 */
export interface CancellationRecord {
  /** 运行中的操作都已确认结束；false 时界面提示结果未知 */
  readonly confirmed: boolean;
  readonly unknown?: ReadonlyArray<PendingOperationRecord>;
}

/** 按流事件到达顺序引用正文、思考切片与工具；偏移使用 UTF-16 字符索引。 */
export type MessageContentSegment =
  | { readonly type: "text"; readonly start: number; readonly end: number }
  | { readonly type: "thought"; readonly start: number; readonly end: number; readonly startedAtMs?: number; readonly endedAtMs?: number }
  | { readonly type: "tool"; readonly toolId: string };

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

/** 从会话历史消息中投影提取最新的待办任务清单（对齐 DSH Last-write-wins 投影状态机） */
export function extractLatestTodos(
  messages: ReadonlyArray<ChatMessage>,
): ReadonlyArray<TodoItem> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.toolSteps && msg.toolSteps.length > 0) {
      for (let j = msg.toolSteps.length - 1; j >= 0; j--) {
        const step = msg.toolSteps[j];
        if (step.name === "todo_write") {
          try {
            const parsed = JSON.parse(step.argumentsJson) as { todos?: unknown };
            if (Array.isArray(parsed?.todos)) {
              return parsed.todos as TodoItem[];
            }
          } catch {
            // 解析失败忽略
          }
        }
      }
    }
  }
  return undefined;
}

export interface ChatMessage {
  id: string;
  branchRootId?: string;
  branchVersion?: number;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  imageId?: string;
  status: MessageStatus;
  createdAt: number;
  /** 服务端按输出上限截断回复时为 true */
  truncated?: boolean;
  /** Agent 检测到没有进展的循环而提前结束时为 true */
  loopStopped?: boolean;
  /** 联网搜索的参考来源，随消息持久化 */
  sources?: ReadonlyArray<ChatSource>;
  /** 深度思考/思维链内容（DeepSeek-R1 / Claude Thinking / Gemini Thought） */
  thought?: string;
  /** 生成该消息时的厂商快照 */
  provider?: string;
  /** 生成该消息时的具体模型快照 */
  model?: string;
  /** 单条消息的 Token 消耗统计 */
  usage?: TokenUsage;
  /** 单次流式响应总耗时（毫秒） */
  latencyMs?: number;
  /** 用户主动停止/中断标记 */
  interrupted?: boolean;
  /** Agent 模式下该消息内的工具调用步骤序列 */
  toolSteps?: ReadonlyArray<ToolStep>;
  /** 旧记录缺省；新回复按此顺序展示，text/thought 仍供复制与请求历史使用。 */
  contentSegments?: ReadonlyArray<MessageContentSegment>;
  /** 第一个内容片段相对请求开始的时间；不以请求延迟代替过程耗时。 */
  contentStartedAtMs?: number;
  /** 生成该消息时生效的技能列表（名称快照） */
  skills?: ReadonlyArray<string>;
  /** 桌面 Agent 运行身份；Web 对话与旧记录缺省 */
  run?: AgentRunRecord;
  /** 已请求取消、正在等待收尾（运行结束后清除） */
  cancelRequested?: boolean;
  /** 取消收尾期间仍在等待的操作 */
  cancelPending?: ReadonlyArray<PendingOperationRecord>;
  /** 运行中追加的补充要求及其送达状态 */
  supplements?: ReadonlyArray<SupplementRecord>;
  /** 已处理的最后一个运行事件序号：重新连接时从这里之后回填 */
  runEventSeq?: number;
  /** 没能正常接收到终止事件时的恢复结论（断线重连失败、应用重启后发现运行已结束或被中断） */
  recovery?: RunRecoveryRecord;
  /** 与网关的连接中断，正在按事件序号重新连接（仅界面状态） */
  reconnecting?: boolean;
  /** 运行过程中的说明：上下文压缩、上下文超限、交付前的执行反馈 */
  runNotes?: ReadonlyArray<RunNoteRecord>;
  /** 正在等待同一项目中其他任务完成写入的操作（仅界面状态，运行结束后清除） */
  waitingFor?: ReadonlyArray<PendingOperationRecord>;
  /** 运行被取消后的收尾结论 */
  cancellation?: CancellationRecord;
}

export type StoredImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface StoredImage {
  id: string;
  conversationId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType: StoredImageMimeType;
}

