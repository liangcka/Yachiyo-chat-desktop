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

/** Agent 工具执行步骤（调用 + 可选结果），随 assistant 消息持久化 */
export interface ToolStep {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  /** 相对本轮请求开始的时间，包含权限等待。旧记录可缺省。 */
  readonly startedAtMs?: number;
  readonly result?: {
    readonly output: string;
    readonly isError: boolean;
    readonly durationMs: number;
    readonly endedAtMs?: number;
  };
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

