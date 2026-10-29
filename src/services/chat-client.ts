import type { ChatSource, CommandEndReason, CommandRecord, Locale, PendingOperationRecord, RunNoteRecord, TokenUsage } from "../domain/chat";
import { KEYSTORE_MANAGED_API_KEY, type CustomModelRequestOptions, type ProviderId } from "../domain/llm";
import { apiCredentials } from "./app-platform";
import { apiFetch } from "./api-origins";
import type { ReasoningLevel } from "./reasoning-effort";

export interface StreamChatMessage {
  role: "user" | "assistant" | "tool";
  text: string;
  imageDataUrl?: string;
  /** assistant 消息携带的工具调用列表（与 Rust 侧 serde 命名一致） */
  toolCalls?: { id: string; name: string; arguments: unknown }[];
  /** role: "tool" 消息对应的调用 id 与工具名 */
  toolCallId?: string;
  toolName?: string;
}

export interface StreamChatRequest {
  locale: Locale;
  messages: StreamChatMessage[];
  mode?: "chat" | "summary" | "title";
  /** 发送消息时的客户端本地格式化时间戳 */
  currentTime?: string;
  /** 用户自带 Key 路径：三者必须同时存在，否则走服务端 fallback */
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  /** 自定义 OpenAI 兼容端点；仅 OpenAI 兼容厂商有效，存在时模型名不再受白名单约束 */
  baseUrl?: string;
  /** 桌面端：Key 由网关从加密存储取用时指明配置对应的密钥槽 */
  keySlot?: string;
  /** 自定义模型的线路协议与采样参数；仅与 baseUrl 同时出现 */
  customModel?: CustomModelRequestOptions;
  /** 开启后服务端先执行联网搜索并下发 sources 事件（仅普通聊天，summary 不携带） */
  webSearch?: boolean;
  /** 智能搜索：联网搜索开启时启用双市场并行检索（结果更多、带发布日期） */
  smartSearch?: boolean;
  /** 对话框选择的思考档位；桌面网关映射为厂商原生取值，模型不支持时忽略 */
  reasoningEffort?: ReasoningLevel;
  /** Agent 模式：开启后服务端启用多轮工具调用循环 */
  agent?: {
    enabled: true;
    executionMode?: "readonly" | "confirm" | "full_auto";
    auto?: boolean;
    maxTurns?: number;
    workspace?: string;
    /** 当前模型能接收图片，桌面网关据此决定是否下发 look 截图工具 */
    vision?: boolean;
    /** 提交任务时生成的运行编号；网关拒绝同一编号的重复运行 */
    runId?: string;
    conversationId?: string;
    /** 模型的上下文窗口（token），网关据此做运行内的上下文预算 */
    contextWindow?: number;
  };
}

/** 网关确认的运行身份（run_started 事件） */
export interface RunStartedEvent {
  runId: string;
  conversationId?: string;
  workspace: string | null;
  executionMode: "readonly" | "confirm" | "full_auto";
  startedAt: number;
}

export interface StreamChatResult {
  truncated: boolean;
  usage?: TokenUsage;
  /** 桌面 Agent 检测到没有进展的循环而提前结束，或按请求取消并完成收尾 */
  stopReason?: "loop_detected" | "cancelled" | "context_overflow";
  /** 取消时结果无法确认的操作 */
  unknownOperations?: PendingOperationRecord[];
}

export type ChatClientErrorCode =
  | "SESSION_REQUIRED"
  | "API_KEY_MISSING"
  | "DAILY_QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "WORKSPACE_REQUIRED"
  | "WORKSPACE_UNAVAILABLE"
  | "RUN_ALREADY_ACTIVE"
  | "PROVIDER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "ABORTED"
  | "STREAM_ERROR";

export class ChatClientError extends Error {
  constructor(
    readonly code: ChatClientErrorCode,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "ChatClientError";
  }
  /** 该错误是否属于重发同一请求即可能成功的瞬时故障 */
  get retryable(): boolean {
    return isRetryableChatErrorCode(this.code);
  }
}

/** 重发同一请求即可能成功的瞬时故障码；UI 层据此决定是否展示"重试"入口 */
const retryableChatErrorCodes: ReadonlySet<string> = new Set([
  "NETWORK_ERROR",
  "PROVIDER_ERROR",
  "SERVICE_UNAVAILABLE",
  "STREAM_ERROR",
]);

export function isRetryableChatErrorCode(code: string | undefined): boolean {
  return code !== undefined && retryableChatErrorCodes.has(code);
}

/** 流内 error 事件的 code → 客户端错误码；未知码一律视为上游故障，原始值进 detail */
function streamErrorEvent(code: string, detail?: string): ChatClientError {
  if (code === "WORKSPACE_REQUIRED") return new ChatClientError("WORKSPACE_REQUIRED", undefined, detail);
  if (code === "WORKSPACE_UNAVAILABLE") return new ChatClientError("WORKSPACE_UNAVAILABLE", undefined, detail);
  if (code === "RUN_ALREADY_ACTIVE") return new ChatClientError("RUN_ALREADY_ACTIVE", undefined, detail);
  if (code === "API_KEY_MISSING") return new ChatClientError("API_KEY_MISSING", undefined, detail);
  if (code === "PROVIDER_STREAM_ERROR") return new ChatClientError("PROVIDER_ERROR", undefined, detail);
  return new ChatClientError("PROVIDER_ERROR", undefined, `${code}${detail === undefined ? "" : ` ${detail}`}`);
}

export const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 45_000;

export interface StreamChatOptions {
  onDelta: (text: string) => void;
  /** 深度思考/思维链流式增量回调 */
  onThought?: (text: string) => void;
  /** 不中断运行的提示（如所选思考档位被模型拒绝、已按默认档位继续） */
  onNotice?: (code: string) => void;
  /** sources 事件（先于首个 delta 到达）合法时回调一次 */
  onSources?: (sources: ChatSource[]) => void;
  /** Agent 工具调用下发（载荷校验失败视为流损坏） */
  onToolCall?: (call: { id: string; name: string; arguments: unknown }) => void;
  /** 运行中命令的增量输出（网关已节流） */
  onToolOutput?: (output: { id: string; stream: "stdout" | "stderr"; text: string }) => void;
  /** Agent 工具执行结果回传；命令附带结构化执行记录 */
  onToolResult?: (result: { id: string; name: string; output: string; isError: boolean; durationMs: number; command?: CommandRecord }) => void;
  /** Agent 工具权限审批请求（等待 UI 通过 submitAgentApproval 回传决定） */
  onPermissionRequest?: (request: { requestId: string; toolName: string; arguments: unknown; callId?: string }) => void;
  /** 权限审批决议下发（批准、拒绝或超时） */
  onPermissionResolved?: (resolved: { requestId: string; approved: boolean; reason?: "approved" | "denied" | "timeout" }) => void;
  /** 运行进入取消收尾，列出仍在等待结束的操作 */
  onRunStatus?: (status: { runId: string; status: "running" | "cancelling" | "waiting_for_workspace"; pending: PendingOperationRecord[] }) => void;
  /** Agent 单轮（模型调用 + 工具执行）完成，usage 存在时携带该轮用量 */
  onTurn?: (turn: { index: number; usage?: TokenUsage }) => void;
  /** 桌面网关确认运行身份与实际工作区 */
  onRunStarted?: (run: RunStartedEvent) => void;
  /** 运行中追加的补充要求已交给模型 */
  onSupplementDelivered?: (delivered: { runId: string; ids: string[] }) => void;
  /** 运行过程中的说明：上下文压缩、超限、交付前的执行反馈 */
  onRunNote?: (note: RunNoteRecord) => void;
  /** 处理完一个带序号的事件后回报序号（断线后从这里重新连接） */
  onEventSeq?: (seq: number) => void;
  /** 重新连接时网关已丢弃的事件区间：这段过程无法回填 */
  onEventGap?: (gap: { from: number; to: number }) => void;
  /** 只处理序号大于它的事件，重复事件直接跳过 */
  afterSeq?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  /** 单次分片读取超时（毫秒），默认 45000ms；0 或负数表示不设超时 */
  inactivityTimeoutMs?: number;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

async function readProblemCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    const error = (body as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null) return undefined;
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

async function httpError(response: Response): Promise<ChatClientError> {
  const serverCode = await readProblemCode(response);
  if (response.status === 401 || serverCode === "SESSION_REQUIRED") {
    return new ChatClientError("SESSION_REQUIRED", response.status);
  }
  if (response.status === 429 || serverCode === "DAILY_QUOTA_EXCEEDED") {
    return new ChatClientError("DAILY_QUOTA_EXCEEDED", response.status);
  }
  if (response.status === 400 || response.status === 403 || serverCode === "INVALID_REQUEST") {
    return new ChatClientError("INVALID_REQUEST", response.status);
  }
  if (response.status === 502 || response.status === 504 || serverCode?.startsWith("PROVIDER_")) {
    return new ChatClientError("PROVIDER_ERROR", response.status);
  }
  return new ChatClientError("SERVICE_UNAVAILABLE", response.status);
}

function eventFields(record: string): { event?: string; data?: string; id?: number; isComment: boolean } {
  let event: string | undefined;
  let id: number | undefined;
  const data: string[] = [];
  let isComment = true;
  for (const line of record.split(/\r?\n/u)) {
    if (line.startsWith(":")) continue;
    isComment = false;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
    if (line.startsWith("id:")) {
      const value = Number(line.slice(3).trim());
      if (Number.isSafeInteger(value) && value > 0) id = value;
    }
  }
  return { event, data: data.length === 0 ? undefined : data.join("\n"), ...(id !== undefined ? { id } : {}), isComment };
}

/** 解析 run_note；不认识的种类忽略（较新的网关可能增加说明种类） */
function runNotePayload(payload: Record<string, unknown>): RunNoteRecord | undefined {
  const detail = payload.detail !== null && typeof payload.detail === "object" ? (payload.detail as Record<string, unknown>) : {};
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  if (payload.kind === "context_compacted") {
    return { kind: "context_compacted", foldedTurns: number(detail.foldedTurns), beforeTokens: number(detail.beforeTokens), afterTokens: number(detail.afterTokens) };
  }
  if (payload.kind === "context_overflow") {
    return { kind: "context_overflow", tokens: number(detail.tokens), budgetTokens: number(detail.budgetTokens) };
  }
  if (payload.kind === "verification_reminder") {
    if (detail.reason === "not_verified") {
      const files = Array.isArray(detail.files) ? detail.files.filter((file): file is string => typeof file === "string") : [];
      return { kind: "verification_reminder", reason: "not_verified", files };
    }
    if (detail.reason === "verification_failed" && typeof detail.command === "string") {
      return { kind: "verification_reminder", reason: "verification_failed", command: detail.command };
    }
  }
  return undefined;
}

/** 连接层面的中断（不是网关下发的错误事件）：运行仍在网关中，可以按序号重新连接 */
export const STREAM_DISCONNECTED = "STREAM_DISCONNECTED";

export function isStreamDisconnect(error: unknown): boolean {
  return error instanceof ChatClientError
    && (error.code === "NETWORK_ERROR" || error.detail === STREAM_DISCONNECTED || error.detail === "STREAM_INACTIVITY_TIMEOUT");
}

function objectPayload(data: string | undefined): Record<string, unknown> {
  if (data === undefined) throw new ChatClientError("STREAM_ERROR");
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof ChatClientError) throw error;
  }
  throw new ChatClientError("STREAM_ERROR");
}

/** 校验 sources 事件载荷：必须是数组且每项 title/url 均为字符串，否则视为流损坏 */
function sourcesPayload(payload: Record<string, unknown>): ChatSource[] {
  const sources = payload.sources;
  if (!Array.isArray(sources)) throw new ChatClientError("STREAM_ERROR");
  return sources.map((source): ChatSource => {
    if (typeof source !== "object" || source === null) throw new ChatClientError("STREAM_ERROR");
    const { title, url } = source as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string") {
      throw new ChatClientError("STREAM_ERROR");
    }
    return { title, url };
  });
}

const COMMAND_END_REASONS: ReadonlySet<string> = new Set(["exited", "timed_out", "cancelled", "spawn_failed", "blocked"]);

/** 校验命令执行记录；结构不完整时视为流损坏，避免把残缺记录当作验证证据 */
function commandPayload(value: unknown): CommandRecord | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) throw new ChatClientError("STREAM_ERROR");
  const record = value as Record<string, unknown>;
  if (
    typeof record.executionId !== "string" ||
    typeof record.command !== "string" ||
    typeof record.cwd !== "string" ||
    (record.exitCode !== undefined && typeof record.exitCode !== "number") ||
    typeof record.durationMs !== "number" ||
    typeof record.endReason !== "string" ||
    !COMMAND_END_REASONS.has(record.endReason) ||
    typeof record.exitConfirmed !== "boolean" ||
    typeof record.outputBytes !== "number" ||
    typeof record.truncated !== "boolean"
  ) {
    throw new ChatClientError("STREAM_ERROR");
  }
  return {
    executionId: record.executionId,
    command: record.command,
    cwd: record.cwd,
    ...(typeof record.exitCode === "number" ? { exitCode: record.exitCode } : {}),
    durationMs: record.durationMs,
    endReason: record.endReason as CommandEndReason,
    exitConfirmed: record.exitConfirmed,
    ...(record.orphansTerminated === true ? { orphansTerminated: true } : {}),
    outputBytes: record.outputBytes,
    truncated: record.truncated,
    ...(typeof record.logPath === "string" ? { logPath: record.logPath } : {}),
  };
}

function pendingOperationsPayload(value: unknown): PendingOperationRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ChatClientError("STREAM_ERROR");
  return value.map((item): PendingOperationRecord => {
    if (typeof item !== "object" || item === null) throw new ChatClientError("STREAM_ERROR");
    const { callId, name, detail } = item as Record<string, unknown>;
    if (typeof callId !== "string" || typeof name !== "string" || typeof detail !== "string") throw new ChatClientError("STREAM_ERROR");
    return { callId, name, detail };
  });
}

function isUsagePayload(value: unknown): value is TokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  const isOptionalInt = (v: unknown) =>
    v === undefined || (typeof v === "number" && Number.isSafeInteger(v));
  return (
    isOptionalInt(usage.promptTokens) &&
    isOptionalInt(usage.completionTokens) &&
    isOptionalInt(usage.totalTokens) &&
    isOptionalInt(usage.cacheReadTokens) &&
    isOptionalInt(usage.cacheWriteTokens)
  );
}

export async function streamChat(
  request: StreamChatRequest,
  options: StreamChatOptions,
): Promise<StreamChatResult> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  // 占位符代表 Key 保存在桌面网关的系统加密存储中，请求体不携带，由网关按厂商读取
  const payload =
    request.apiKey === KEYSTORE_MANAGED_API_KEY ? { ...request, apiKey: undefined } : request;
  let response: Response;
  try {
    response = await apiFetch(
      "/api/chat",
      {
        body: JSON.stringify(payload),
        credentials: apiCredentials(),
        headers: { accept: "text/event-stream", "content-type": "application/json" },
        method: "POST",
        signal: options.signal,
      },
      { fetcher },
    );
  } catch (error) {
    throw new ChatClientError(isAbort(error, options.signal) ? "ABORTED" : "NETWORK_ERROR");
  }

  if (!response.ok) throw await httpError(response);
  return readEventStream(response, options);
}

/**
 * 读取网关的 SSE 事件流。事件带序号时：序号不大于 afterSeq 的视为重复直接跳过，
 * 处理完每个事件后回报序号，调用方据此在断线后从最后处理的位置重新连接。
 */
async function readEventStream(response: Response, options: StreamChatOptions): Promise<StreamChatResult> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (response.body === null || !contentType.includes("text/event-stream")) {
    await response.body?.cancel();
    throw new ChatClientError("STREAM_ERROR", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished: StreamChatResult | undefined;
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS;
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const clearInactivityTimer = () => {
    if (inactivityTimer !== undefined) {
      clearTimeout(inactivityTimer);
      inactivityTimer = undefined;
    }
  };

  const resetInactivityTimer = () => {
    clearInactivityTimer();
    if (inactivityTimeoutMs > 0 && finished === undefined) {
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => undefined);
      }, inactivityTimeoutMs);
    }
  };

  const consume = (flush: boolean) => {
    while (finished === undefined) {
      const separator = /\r?\n\r?\n/u.exec(buffer);
      if (separator === null) break;
      const record = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const fields = eventFields(record);
      if (fields.isComment) {
        continue;
      }
      if (fields.id !== undefined && options.afterSeq !== undefined && fields.id <= options.afterSeq) {
        continue;
      }
      const payload = objectPayload(fields.data);
      if (fields.event === "gap") {
        options.onEventGap?.({
          from: typeof payload.from === "number" ? payload.from : 0,
          to: typeof payload.to === "number" ? payload.to : 0,
        });
      } else if (fields.event === "delta" && typeof payload.text === "string") {
        options.onDelta(payload.text);
      } else if (fields.event === "thought" && typeof payload.text === "string") {
        options.onThought?.(payload.text);
      } else if (fields.event === "sources") {
        const sources = sourcesPayload(payload);
        options.onSources?.(sources);
      } else if (fields.event === "tool_call") {
        if (typeof payload.id !== "string" || typeof payload.name !== "string") throw new ChatClientError("STREAM_ERROR");
        options.onToolCall?.({ id: payload.id, name: payload.name, arguments: payload.arguments });
      } else if (fields.event === "tool_result") {
        if (
          typeof payload.id !== "string" ||
          typeof payload.name !== "string" ||
          typeof payload.output !== "string" ||
          typeof payload.isError !== "boolean" ||
          typeof payload.durationMs !== "number"
        ) {
          throw new ChatClientError("STREAM_ERROR");
        }
        const command = commandPayload(payload.command);
        options.onToolResult?.({
          id: payload.id,
          name: payload.name,
          output: payload.output,
          isError: payload.isError,
          durationMs: payload.durationMs,
          ...(command !== undefined ? { command } : {}),
        });
      } else if (fields.event === "tool_output") {
        if (typeof payload.id !== "string" || typeof payload.text !== "string" || (payload.stream !== "stdout" && payload.stream !== "stderr")) {
          throw new ChatClientError("STREAM_ERROR");
        }
        options.onToolOutput?.({ id: payload.id, stream: payload.stream, text: payload.text });
      } else if (fields.event === "permission_request") {
        if (typeof payload.requestId !== "string" || typeof payload.toolName !== "string") throw new ChatClientError("STREAM_ERROR");
        options.onPermissionRequest?.({
          requestId: payload.requestId,
          toolName: payload.toolName,
          arguments: payload.arguments,
          ...(typeof payload.callId === "string" && payload.callId.length > 0 ? { callId: payload.callId } : {}),
        });
      } else if (fields.event === "permission_resolved") {
        if (typeof payload.requestId !== "string" || typeof payload.approved !== "boolean") throw new ChatClientError("STREAM_ERROR");
        const reason = payload.reason === "approved" || payload.reason === "denied" || payload.reason === "timeout" ? payload.reason : undefined;
        options.onPermissionResolved?.({ requestId: payload.requestId, approved: payload.approved, ...(reason !== undefined ? { reason } : {}) });
      } else if (fields.event === "run_status") {
        if (
          typeof payload.runId !== "string" ||
          (payload.status !== "running" && payload.status !== "cancelling" && payload.status !== "waiting_for_workspace")
        ) throw new ChatClientError("STREAM_ERROR");
        options.onRunStatus?.({ runId: payload.runId, status: payload.status, pending: pendingOperationsPayload(payload.pending) });
      } else if (fields.event === "run_note") {
        const note = runNotePayload(payload);
        if (note !== undefined) options.onRunNote?.(note);
      } else if (fields.event === "supplement_delivered") {
        if (typeof payload.runId !== "string" || !Array.isArray(payload.ids) || !payload.ids.every((id) => typeof id === "string")) {
          throw new ChatClientError("STREAM_ERROR");
        }
        options.onSupplementDelivered?.({ runId: payload.runId, ids: payload.ids as string[] });
      } else if (fields.event === "run_started") {
        const mode = payload.executionMode;
        if (
          typeof payload.runId !== "string" ||
          (payload.workspace !== null && typeof payload.workspace !== "string") ||
          (mode !== "readonly" && mode !== "confirm" && mode !== "full_auto") ||
          typeof payload.startedAt !== "number"
        ) {
          throw new ChatClientError("STREAM_ERROR");
        }
        options.onRunStarted?.({
          runId: payload.runId,
          ...(typeof payload.conversationId === "string" ? { conversationId: payload.conversationId } : {}),
          workspace: payload.workspace,
          executionMode: mode,
          startedAt: payload.startedAt,
        });
      } else if (fields.event === "turn") {
        if (typeof payload.index !== "number") throw new ChatClientError("STREAM_ERROR");
        const usage = isUsagePayload(payload.usage) ? payload.usage : undefined;
        options.onTurn?.(usage !== undefined ? { index: payload.index, usage } : { index: payload.index });
      } else if (fields.event === "done" && typeof payload.truncated === "boolean") {
        const usage = isUsagePayload(payload.usage) ? payload.usage : undefined;
        const unknownOperations = pendingOperationsPayload(payload.unknown);
        finished = {
          truncated: payload.truncated,
          ...(usage !== undefined ? { usage } : {}),
          ...(payload.reason === "loop_detected" ? { stopReason: "loop_detected" as const } : {}),
          ...(payload.reason === "cancelled" ? { stopReason: "cancelled" as const } : {}),
          ...(payload.reason === "context_overflow" ? { stopReason: "context_overflow" as const } : {}),
          ...(unknownOperations.length > 0 ? { unknownOperations } : {}),
        };
      } else if (fields.event === "notice" && typeof payload.code === "string") {
        options.onNotice?.(payload.code);
      } else if (fields.event === "error" && typeof payload.code === "string") {
        throw streamErrorEvent(payload.code, typeof payload.message === "string" ? payload.message : undefined);
      } else {
        throw new ChatClientError("STREAM_ERROR");
      }
      if (fields.id !== undefined) options.onEventSeq?.(fields.id);
    }

    if (flush && finished === undefined && buffer.trim().length > 0) {
      const fields = eventFields(buffer);
      if (!fields.isComment) {
        throw new ChatClientError("STREAM_ERROR");
      }
    }
  };

  try {
    resetInactivityTimer();
    while (finished === undefined) {
      const { done, value } = await reader.read();
      resetInactivityTimer();
      if (done) {
        clearInactivityTimer();
        buffer += decoder.decode();
        consume(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consume(false);
    }
  } catch (error) {
    clearInactivityTimer();
    await reader.cancel().catch(() => undefined);
    if (timedOut) {
      throw new ChatClientError("STREAM_ERROR", undefined, "STREAM_INACTIVITY_TIMEOUT");
    }
    if (error instanceof ChatClientError) throw error;
    if (isAbort(error, options.signal)) throw new ChatClientError("ABORTED");
    throw new ChatClientError("STREAM_ERROR", undefined, STREAM_DISCONNECTED);
  } finally {
    clearInactivityTimer();
  }

  if (timedOut) {
    throw new ChatClientError("STREAM_ERROR", undefined, "STREAM_INACTIVITY_TIMEOUT");
  }
  // 流在终止事件之前结束：连接被切断，运行可能仍在网关中
  if (finished === undefined) throw new ChatClientError("STREAM_ERROR", undefined, STREAM_DISCONNECTED);
  await reader.cancel().catch(() => undefined);
  return finished;
}

export type AgentRunState =
  | { kind: "active"; status: "running" | "cancelling"; lastSeq: number }
  | { kind: "finished"; status: "completed" | "failed" | "cancelled" | "interrupted"; reason?: string; lastSeq: number; retained: boolean }
  /** 网关没有这个运行的任何记录 */
  | { kind: "unknown" }
  /** 无法连接网关 */
  | { kind: "unreachable" };

function runStatePayload(value: unknown): AgentRunState | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const state = value as Record<string, unknown>;
  const lastSeq = typeof state.lastSeq === "number" ? state.lastSeq : 0;
  if (state.kind === "active") {
    const run = state.run as Record<string, unknown> | undefined;
    return { kind: "active", status: run?.status === "cancelling" ? "cancelling" : "running", lastSeq };
  }
  if (state.kind === "finished") {
    const status = state.status;
    if (status !== "completed" && status !== "failed" && status !== "cancelled" && status !== "interrupted") return undefined;
    return {
      kind: "finished",
      status,
      ...(typeof state.reason === "string" ? { reason: state.reason } : {}),
      lastSeq,
      retained: state.retained === true,
    };
  }
  return undefined;
}

export interface ActiveRunSummary {
  runId: string;
  conversationId?: string;
}

/** 网关中仍在执行的运行；无法连接网关时返回空列表 */
export async function listActiveAgentRuns(): Promise<ActiveRunSummary[]> {
  try {
    const res = await apiFetch("/api/agent/runs", { credentials: apiCredentials() });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const runs = body !== null && typeof body === "object" && "runs" in body && Array.isArray(body.runs) ? body.runs : [];
    return runs.flatMap((run: unknown) => {
      if (run === null || typeof run !== "object" || !("runId" in run) || typeof run.runId !== "string") return [];
      const conversationId = "conversationId" in run && typeof run.conversationId === "string" ? run.conversationId : undefined;
      return [{ runId: run.runId, ...(conversationId !== undefined ? { conversationId } : {}) }];
    });
  } catch {
    return [];
  }
}

/** 查询运行在网关中的状态：仍在执行、已结束（事件是否仍可回填）、被中断或未知 */
export async function getAgentRunState(runId: string): Promise<AgentRunState> {
  try {
    const res = await apiFetch(`/api/agent/runs/${encodeURIComponent(runId)}`, { credentials: apiCredentials() });
    if (res.status === 404) return { kind: "unknown" };
    if (!res.ok) return { kind: "unreachable" };
    const body: unknown = await res.json();
    const state = body !== null && typeof body === "object" && "state" in body ? runStatePayload(body.state) : undefined;
    return state ?? { kind: "unknown" };
  } catch {
    return { kind: "unreachable" };
  }
}

export type ResumeRunResult =
  | { kind: "resumed"; result: StreamChatResult }
  /** 事件日志已不在网关内存中：只能依据运行状态标记结局，不重放任何操作 */
  | { kind: "unavailable"; state: AgentRunState };

/** 重新连接运行的事件流：从 afterSeq 之后回填剩余事件并继续接收，直到运行结束 */
export async function resumeAgentRun(runId: string, afterSeq: number, options: StreamChatOptions): Promise<ResumeRunResult> {
  let response: Response;
  try {
    response = await apiFetch(
      `/api/agent/runs/${encodeURIComponent(runId)}/events?after=${afterSeq}`,
      { credentials: apiCredentials(), headers: { accept: "text/event-stream" }, signal: options.signal },
      { fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis) },
    );
  } catch (error) {
    throw new ChatClientError(isAbort(error, options.signal) ? "ABORTED" : "NETWORK_ERROR");
  }
  if (response.status === 404) {
    const body: unknown = await response.json().catch(() => undefined);
    const state = body !== null && typeof body === "object" && "state" in body ? runStatePayload(body.state) : undefined;
    return { kind: "unavailable", state: state ?? { kind: "unknown" } };
  }
  if (!response.ok) throw await httpError(response);
  return { kind: "resumed", result: await readEventStream(response, { ...options, afterSeq }) };
}

/** 桌面端 Agent 权限批准回传（与 /api/chat 同 origin 路由规则）；只对仍在执行的所属运行有效 */
export async function submitAgentApproval(payload: {
  runId: string;
  requestId: string;
  approved: boolean;
  sessionScope?: boolean;
}): Promise<boolean> {
  try {
    const res = await apiFetch("/api/agent/approval", {
      method: "POST",
      body: JSON.stringify(payload),
      credentials: apiCredentials(),
      headers: { "content-type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type CancelRunResult = "accepted" | "not_active" | "failed";

/**
 * 请求网关取消运行。返回 accepted 时运行进入“正在取消”：观察连接保持，
 * 命令终止并确认后才会收到 done（reason=cancelled）
 */
export async function cancelAgentRun(runId: string): Promise<CancelRunResult> {
  try {
    const res = await apiFetch(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: "{}",
      credentials: apiCredentials(),
      headers: { "content-type": "application/json" },
    });
    if (res.status === 202 || res.ok) return "accepted";
    return res.status === 404 ? "not_active" : "failed";
  } catch {
    return "failed";
  }
}

export type SupplementSubmitResult =
  | { status: "queued" }
  /** 运行已结束、已取消或正在收尾：补充没有被接受 */
  | { status: "rejected"; code: string }
  | { status: "failed" };

/** 运行中追加补充要求：排队等待下一次调用模型前送达，不中断当前任务 */
export async function submitAgentSupplement(runId: string, id: string, text: string): Promise<SupplementSubmitResult> {
  try {
    const res = await apiFetch(`/api/agent/runs/${encodeURIComponent(runId)}/supplements`, {
      method: "POST",
      body: JSON.stringify({ id, text }),
      credentials: apiCredentials(),
      headers: { "content-type": "application/json" },
    });
    if (res.status === 202 || res.ok) return { status: "queued" };
    if (res.status === 409 || res.status === 400) {
      const body: unknown = await res.json().catch(() => undefined);
      const code = body !== null && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "REJECTED";
      return { status: "rejected", code };
    }
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

/** 只停止运行中的某条命令（按发起它的工具调用），运行继续 */
export async function stopAgentToolCall(runId: string, callId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/agent/runs/${encodeURIComponent(runId)}/calls/${encodeURIComponent(callId)}/stop`, {
      method: "POST",
      body: "{}",
      credentials: apiCredentials(),
      headers: { "content-type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}
