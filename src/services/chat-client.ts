import type { ChatSource, Locale, TokenUsage } from "../domain/chat";
import { KEYSTORE_MANAGED_API_KEY, type ProviderId } from "../domain/llm";
import { apiCredentials } from "./app-platform";
import { apiFetch } from "./api-origins";

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
  /** 开启后服务端先执行联网搜索并下发 sources 事件（仅普通聊天，summary 不携带） */
  webSearch?: boolean;
  /** 智能搜索：联网搜索开启时启用双市场并行检索（结果更多、带发布日期） */
  smartSearch?: boolean;
  /** Agent 模式：开启后服务端启用多轮工具调用循环 */
  agent?: { enabled: true; executionMode?: "readonly" | "confirm" | "full_auto"; auto?: boolean; maxTurns?: number; workspace?: string };
}

export interface StreamChatResult {
  truncated: boolean;
  usage?: TokenUsage;
  /** 桌面 Agent 检测到没有进展的循环而提前结束 */
  stopReason?: "loop_detected";
}

export type ChatClientErrorCode =
  | "SESSION_REQUIRED"
  | "DAILY_QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "WORKSPACE_REQUIRED"
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
  if (code === "PROVIDER_STREAM_ERROR") return new ChatClientError("PROVIDER_ERROR", undefined, detail);
  return new ChatClientError("PROVIDER_ERROR", undefined, `${code}${detail === undefined ? "" : ` ${detail}`}`);
}

export const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 45_000;

export interface StreamChatOptions {
  onDelta: (text: string) => void;
  /** 深度思考/思维链流式增量回调 */
  onThought?: (text: string) => void;
  /** sources 事件（先于首个 delta 到达）合法时回调一次 */
  onSources?: (sources: ChatSource[]) => void;
  /** Agent 工具调用下发（载荷校验失败视为流损坏） */
  onToolCall?: (call: { id: string; name: string; arguments: unknown }) => void;
  /** Agent 工具执行结果回传 */
  onToolResult?: (result: { id: string; name: string; output: string; isError: boolean; durationMs: number }) => void;
  /** Agent 工具权限审批请求（等待 UI 通过 submitAgentApproval 回传决定） */
  onPermissionRequest?: (request: { requestId: string; toolName: string; arguments: unknown }) => void;
  /** 权限审批决议下发（批准或拒绝/超时） */
  onPermissionResolved?: (resolved: { requestId: string; approved: boolean }) => void;
  /** Agent 单轮（模型调用 + 工具执行）完成，usage 存在时携带该轮用量 */
  onTurn?: (turn: { index: number; usage?: TokenUsage }) => void;
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

function eventFields(record: string): { event?: string; data?: string; isComment: boolean } {
  let event: string | undefined;
  const data: string[] = [];
  let isComment = true;
  for (const line of record.split(/\r?\n/u)) {
    if (line.startsWith(":")) continue;
    isComment = false;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
  }
  return { event, data: data.length === 0 ? undefined : data.join("\n"), isComment };
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

function isUsagePayload(value: unknown): value is TokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  const isOptionalInt = (v: unknown) =>
    v === undefined || (typeof v === "number" && Number.isSafeInteger(v));
  return (
    isOptionalInt(usage.promptTokens) &&
    isOptionalInt(usage.completionTokens) &&
    isOptionalInt(usage.totalTokens)
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
      const payload = objectPayload(fields.data);
      if (fields.event === "delta" && typeof payload.text === "string") {
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
        options.onToolResult?.({
          id: payload.id,
          name: payload.name,
          output: payload.output,
          isError: payload.isError,
          durationMs: payload.durationMs,
        });
      } else if (fields.event === "permission_request") {
        if (typeof payload.requestId !== "string" || typeof payload.toolName !== "string") throw new ChatClientError("STREAM_ERROR");
        options.onPermissionRequest?.({ requestId: payload.requestId, toolName: payload.toolName, arguments: payload.arguments });
      } else if (fields.event === "permission_resolved") {
        if (typeof payload.requestId !== "string" || typeof payload.approved !== "boolean") throw new ChatClientError("STREAM_ERROR");
        options.onPermissionResolved?.({ requestId: payload.requestId, approved: payload.approved });
      } else if (fields.event === "turn") {
        if (typeof payload.index !== "number") throw new ChatClientError("STREAM_ERROR");
        const usage = isUsagePayload(payload.usage) ? payload.usage : undefined;
        options.onTurn?.(usage !== undefined ? { index: payload.index, usage } : { index: payload.index });
      } else if (fields.event === "done" && typeof payload.truncated === "boolean") {
        const usage = isUsagePayload(payload.usage) ? payload.usage : undefined;
        finished = {
          truncated: payload.truncated,
          ...(usage !== undefined ? { usage } : {}),
          ...(payload.reason === "loop_detected" ? { stopReason: "loop_detected" as const } : {}),
        };
      } else if (fields.event === "error" && typeof payload.code === "string") {
        throw streamErrorEvent(payload.code, typeof payload.message === "string" ? payload.message : undefined);
      } else {
        throw new ChatClientError("STREAM_ERROR");
      }
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
    throw new ChatClientError(isAbort(error, options.signal) ? "ABORTED" : "STREAM_ERROR");
  } finally {
    clearInactivityTimer();
  }

  if (timedOut) {
    throw new ChatClientError("STREAM_ERROR", undefined, "STREAM_INACTIVITY_TIMEOUT");
  }
  if (finished === undefined) throw new ChatClientError("STREAM_ERROR");
  await reader.cancel().catch(() => undefined);
  return finished;
}

/** 桌面端 Agent 权限批准回传（与 /api/chat 同 origin 路由规则） */
export async function submitAgentApproval(payload: {
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
