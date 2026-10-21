import type { ChatMessage, ChatSource, Conversation, Locale, MessageContentSegment, StoredImage, TokenUsage, ToolStep } from "../domain/chat";

export type ChatPhase = "loading" | "idle" | "streaming" | "offline" | "error" | "compressing";

export interface ChatState {
  phase: ChatPhase;
  activeConversation?: Conversation;
  messages: ChatMessage[];
  locale: Locale;
  pendingImage?: StoredImage;
  errorCode?: string;
  /** 失败时上游给出的原因（如模型接口返回的错误信息），横幅据此说明失败原因而不是笼统地提示连不上 */
  errorDetail?: string;
  /** 跨会话共享的用户长期记忆（压缩时从对话中提炼，新对话也可见） */
  userMemory?: string;
  /**
   * 流式增量暂存槽位：delta/thought-delta 只写入这里（O(1)），不重建 messages 数组；
   * 终态动作（completed/stopped/failed）再把全文折叠回对应消息并清空槽位。
   */
  streaming?: { messageId: string; text?: string; thought?: string; contentSegments?: ReadonlyArray<MessageContentSegment> };
  /** 当前窗口之前是否还有更早历史（UI 窗口化上翻加载入口） */
  hasMoreHistory?: boolean;
  /** Agent 工具权限审批中卡片（同一时刻至多一个，等待用户批准/拒绝） */
  pendingPermission?: {
    messageId: string;
    requestId: string;
    toolName: string;
    argumentsJson: string;
  };
}

export type ChatAction =
  | {
      type: "loaded";
      conversation: Conversation;
      messages: ChatMessage[];
      locale: Locale;
      userMemory?: string;
      hasMoreHistory?: boolean;
    }
  | { type: "load-failed"; errorCode: string }
  | { type: "send-started"; user?: ChatMessage; assistant: ChatMessage }
  | { type: "delta"; messageId: string; text: string; contentSegments?: ReadonlyArray<MessageContentSegment> }
  | { type: "thought-delta"; messageId: string; text: string; contentSegments?: ReadonlyArray<MessageContentSegment> }
  | { type: "sources-received"; messageId: string; sources: ReadonlyArray<ChatSource> }
  | { type: "completed"; messageId: string; usage?: TokenUsage; latencyMs?: number; contentSegments?: ReadonlyArray<MessageContentSegment>; contentStartedAtMs?: number; loopStopped?: boolean }
  | { type: "stopped"; messageId: string; latencyMs?: number; contentSegments?: ReadonlyArray<MessageContentSegment> }
  | { type: "failed"; messageId: string; errorCode: string; errorDetail?: string; latencyMs?: number; contentSegments?: ReadonlyArray<MessageContentSegment> }
  | { type: "connectivity-changed"; online: boolean }
  | {
      type: "conversation-selected";
      conversation: Conversation;
      messages: ChatMessage[];
      hasMoreHistory?: boolean;
      /** 切回一个仍在后台运行的会话 */
      running?: boolean;
      pendingPermission?: ChatState["pendingPermission"];
    }
  | { type: "locale-changed"; locale: Locale }
  | { type: "pending-image-changed"; image?: StoredImage }
  | { type: "clear-error" }
  | { type: "compress-started" }
  | {
      type: "context-compressed";
      summary: string;
      compressedUpTo?: number;
      compressedUpToId?: string;
      userMemory?: string;
    }
  | { type: "user-memory-updated"; memory: string }
  | { type: "messages-reverted"; messages: ChatMessage[] }
  | { type: "load-earlier-loaded"; messages: ChatMessage[] }
  | {
      type: "tool-call";
      messageId: string;
      call: Omit<ToolStep, "result">;
      contentSegments?: ReadonlyArray<MessageContentSegment>;
    }
  | {
      type: "tool-result";
      messageId: string;
      callId: string;
      result: NonNullable<ToolStep["result"]>;
    }
  | {
      type: "permission-requested";
      messageId: string;
      requestId: string;
      toolName: string;
      argumentsJson: string;
    }
  | { type: "permission-resolved"; requestId: string; approved: boolean }
  | { type: "conversation-renamed"; conversationId: string; title: string };

export const initialChatState: ChatState = {
  locale: "zh-CN",
  messages: [],
  phase: "loading",
};

function updateMessage(
  messages: ChatMessage[],
  id: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((message) => (message.id === id ? update(message) : message));
}

/** 终态折叠：把流式槽位中累积的正文/思考一次性写回目标消息（仅当槽位属于该消息且有内容时） */
function foldStreamedContent(state: ChatState, messageId: string): { message?: ChatMessage } & Record<"streaming", undefined> {
  const streaming = state.streaming;
  if (
    streaming === undefined ||
    streaming.messageId !== messageId ||
    (streaming.text === undefined && streaming.thought === undefined)
  ) {
    return { streaming: undefined };
  }
  const target = state.messages.find((message) => message.id === messageId);
  if (target === undefined) return { streaming: undefined };
  return {
    message: {
      ...target,
      ...(streaming.text !== undefined ? { text: target.text + streaming.text } : {}),
      thought: ((target.thought ?? "") + (streaming.thought ?? "")) || undefined,
      ...(streaming.contentSegments !== undefined ? { contentSegments: streaming.contentSegments } : {}),
    },
    streaming: undefined,
  };
}

/** 把折叠结果作为字段覆盖并入终态消息更新 */
function streamedFields(folded: { message?: ChatMessage }): Partial<ChatMessage> {
  return folded.message !== undefined
    ? { text: folded.message.text, thought: folded.message.thought,
        ...(folded.message.contentSegments !== undefined ? { contentSegments: folded.message.contentSegments } : {}) }
    : {};
}

/** 流式增量写入槽位（O(1)）；槽位缺失时惰性创建（要求目标消息存在），归属不符则忽略 */
function appendStreamDelta(
  state: ChatState,
  messageId: string,
  field: "text" | "thought",
  text: string,
  contentSegments?: ReadonlyArray<MessageContentSegment>,
): ChatState {
  const streaming = state.streaming;
  if (streaming !== undefined && streaming.messageId !== messageId) return state;
  if (
    streaming === undefined &&
    !state.messages.some((message) => message.id === messageId && message.status === "streaming")
  ) {
    return state;
  }
  const base = streaming ?? { messageId };
  const accumulated = (field === "text" ? base.text : base.thought) ?? "";
  return {
    ...state,
    streaming:
      field === "text"
        ? { ...base, text: accumulated + text, contentSegments }
        : { ...base, thought: accumulated + text, contentSegments },
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "loaded":
      return {
        activeConversation: action.conversation,
        locale: action.locale,
        messages: action.messages,
        phase: "idle",
        streaming: undefined,
        userMemory: action.userMemory,
        hasMoreHistory: action.hasMoreHistory,
      };
    case "load-failed":
      return { ...state, errorCode: action.errorCode, errorDetail: undefined, phase: "error" };
    case "send-started":
      return {
        ...state,
        errorCode: undefined,
        errorDetail: undefined,
        messages: [...state.messages, ...(action.user === undefined ? [] : [action.user]), action.assistant],
        pendingImage: undefined,
        pendingPermission: undefined,
        phase: "streaming",
        streaming: undefined,
      };
    case "delta":
      return appendStreamDelta(state, action.messageId, "text", action.text, action.contentSegments);
    case "thought-delta":
      return appendStreamDelta(state, action.messageId, "thought", action.text, action.contentSegments);
    case "sources-received":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          sources: action.sources,
        })),
      };
    case "completed": {
      const folded = foldStreamedContent(state, action.messageId);
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...streamedFields(folded),
          ...(action.contentSegments !== undefined ? { contentSegments: action.contentSegments } : {}),
          status: "complete" as const,
          ...(action.contentStartedAtMs !== undefined ? { contentStartedAtMs: action.contentStartedAtMs } : {}),
          ...(action.usage !== undefined ? { usage: action.usage } : {}),
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
          ...(action.loopStopped === true ? { loopStopped: true } : {}),
        })),
        streaming: folded.streaming,
        phase: state.phase === "offline" ? "offline" : "idle",
      };
    }
    case "stopped": {
      const folded = foldStreamedContent(state, action.messageId);
      return {
        ...state,
        // 流程终止后 Rust 侧 gate 已取消 pending，前端同步丢弃权限卡片避免残留死卡
        pendingPermission: undefined,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...streamedFields(folded),
          ...(action.contentSegments !== undefined ? { contentSegments: action.contentSegments } : {}),
          status: "stopped" as const,
          interrupted: true,
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
        })),
        streaming: folded.streaming,
        phase: state.phase === "offline" ? "offline" : "idle",
      };
    }
    case "failed": {
      const folded = foldStreamedContent(state, action.messageId);
      return {
        ...state,
        errorCode: action.errorCode,
        errorDetail: action.errorDetail,
        // 运行失败即终态，权限审批不可能再有回填，卡片随之失效须清除
        pendingPermission: undefined,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...streamedFields(folded),
          ...(action.contentSegments !== undefined ? { contentSegments: action.contentSegments } : {}),
          status: "failed" as const,
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
        })),
        streaming: folded.streaming,
        phase: "error",
      };
    }
    case "connectivity-changed":
      if (!action.online) return { ...state, phase: "offline" };
      if (state.phase !== "offline") return state;
      return state.errorCode === undefined
        ? { ...state, phase: "idle" }
        : { ...state, phase: "error" };
    case "conversation-selected":
      return {
        activeConversation: action.conversation,
        errorCode: undefined,
        errorDetail: undefined,
        locale: action.conversation.locale,
        messages: action.messages,
        pendingImage: undefined,
        pendingPermission: action.pendingPermission,
        phase: action.running === true ? "streaming" : "idle",
        streaming: undefined,
        hasMoreHistory: action.hasMoreHistory,
        // 长期记忆跨会话共享，切换会话时必须保留，否则新会话的请求会丢掉记忆前缀
        userMemory: state.userMemory,
      };
    case "conversation-renamed":
      if (
        state.activeConversation === undefined ||
        state.activeConversation.id !== action.conversationId
      ) {
        return state;
      }
      return {
        ...state,
        activeConversation: {
          ...state.activeConversation,
          title: action.title,
        },
      };
    case "locale-changed":
      return {
        ...state,
        activeConversation:
          state.activeConversation === undefined
            ? undefined
            : { ...state.activeConversation, locale: action.locale },
        locale: action.locale,
      };
    case "pending-image-changed":
      return { ...state, pendingImage: action.image };
    case "clear-error":
      return {
        ...state,
        errorCode: undefined,
        errorDetail: undefined,
        phase: state.phase === "error" || state.phase === "compressing" ? "idle" : state.phase,
      };
    case "compress-started":
      return { ...state, phase: "compressing", errorCode: undefined, errorDetail: undefined };
    case "context-compressed":
      return {
        ...state,
        activeConversation:
          state.activeConversation === undefined
            ? undefined
            : {
                ...state.activeConversation,
                summary: action.summary,
                ...(action.compressedUpTo !== undefined
                  ? { compressedUpTo: action.compressedUpTo }
                  : {}),
                ...(action.compressedUpToId !== undefined
                  ? { compressedUpToId: action.compressedUpToId }
                  : {}),
              },
        phase: "idle",
        ...(action.userMemory !== undefined ? { userMemory: action.userMemory } : {}),
      };
    case "user-memory-updated":
      return { ...state, userMemory: action.memory };
    case "messages-reverted":
      return {
        ...state,
        errorCode: undefined,
        errorDetail: undefined,
        messages: action.messages,
        phase: state.phase === "offline" ? "offline" : "idle",
        streaming: undefined,
      };
    case "load-earlier-loaded":
      // 前插更早历史；若流式槽位仍指向旧窗口消息则一并清掉（防御性，正常不会发生）
      if (action.messages.length === 0) return state;
      return {
        ...state,
        messages: [...action.messages, ...state.messages],
        streaming:
          state.streaming !== undefined &&
          !state.messages.some((message) => message.id === state.streaming?.messageId)
            ? undefined
            : state.streaming,
      };
    case "tool-call":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        streaming: state.streaming?.messageId === action.messageId
          ? { ...state.streaming, contentSegments: action.contentSegments }
          : state.streaming,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...(action.contentSegments !== undefined ? { contentSegments: action.contentSegments } : {}),
          toolSteps: [
            ...(message.toolSteps ?? []),
            { ...action.call },
          ],
        })),
      };
    case "tool-result":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          toolSteps: (message.toolSteps ?? []).map((step) =>
            step.id === action.callId ? { ...step, result: action.result } : step,
          ),
        })),
      };
    case "permission-requested":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        pendingPermission: {
          messageId: action.messageId,
          requestId: action.requestId,
          toolName: action.toolName,
          argumentsJson: action.argumentsJson,
        },
      };
    case "permission-resolved":
      return state.pendingPermission?.requestId === action.requestId
        ? { ...state, pendingPermission: undefined }
        : state;
  }
}
