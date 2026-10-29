import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation } from "../domain/chat";
import { ChatClientError, STREAM_DISCONNECTED, type AgentRunState, type ResumeRunResult, type StreamChatOptions } from "../services/chat-client";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./use-chat-controller";

vi.mock("../services/app-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/app-platform")>()),
  isDesktopApp: () => true,
}));
vi.mock("../services/desktop-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/desktop-bridge")>()),
  setDesktopWorkspaceRoot: vi.fn(async (path: string) => ({ ok: true, path: path.trim() || null })),
}));
vi.mock("../services/reasoning-effort", () => ({ readReasoningEffort: () => undefined }));

const conversation: Conversation = { id: "c1", title: "修复测试", locale: "zh-CN", createdAt: 1, updatedAt: 10, workspace: "D:/demo" };
const run = { id: "run-1", workspace: "D:/demo", executionMode: "confirm" as const, startedAt: 5 };

function repository(initial: ChatMessage[] = []): ChatRepository & { stored: () => ChatMessage[] } {
  let messages = [...initial];
  return {
    stored: () => messages,
    createConversation: vi.fn(async () => conversation),
    listConversations: vi.fn(async () => [conversation]),
    getConversation: vi.fn(async () => conversation),
    listMessages: vi.fn(async () => [...messages]),
    putMessage: vi.fn(async (message: ChatMessage) => {
      messages = [...messages.filter((item) => item.id !== message.id), message].sort((a, b) => a.createdAt - b.createdAt);
    }),
    saveBranchState: vi.fn(async () => undefined),
    updateConversationSummary: vi.fn(async () => undefined),
    getUserMemory: vi.fn(async () => ""),
    updateUserMemory: vi.fn(async () => undefined),
    replaceMessages: vi.fn(async () => undefined),
    deleteMessagesFrom: vi.fn(async () => undefined),
    putImage: vi.fn(async () => undefined),
    getImage: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    getLocale: vi.fn(async () => "zh-CN" as const),
    setConversationLocale: vi.fn(async () => undefined),
    renameConversation: vi.fn(async () => undefined),
    setConversationWorkspace: vi.fn(async () => undefined),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const disconnect = () => new ChatClientError("STREAM_ERROR", undefined, STREAM_DISCONNECTED);

/** 新运行的首个连接：运行开始、输出一半后断线 */
const halfThenDisconnect = vi.fn<StreamChatFunction>(async (_request, options) => {
  options.onRunStarted?.({ runId: "run-1", workspace: "D:/demo", executionMode: "confirm", startedAt: 5 });
  options.onEventSeq?.(1);
  options.onDelta("前半");
  options.onEventSeq?.(2);
  throw disconnect();
});

const user: ChatMessage = { id: "u1", conversationId: "c1", role: "user", status: "complete", text: "修复测试", createdAt: 6 };
const stale: ChatMessage = {
  id: "a1", conversationId: "c1", role: "assistant", status: "streaming", text: "旧的部分输出", createdAt: 7, run, runEventSeq: 4,
  toolSteps: [{ id: "w1", name: "write_file", argumentsJson: JSON.stringify({ path: "src/a.ts" }) }],
};

describe("断线重连与恢复", () => {
  it("连接中断后按最后处理的序号重新连接，回填剩余事件且不重复", async () => {
    const gate = deferred();
    const resumeRun = vi.fn(async (_runId: string, _afterSeq: number, options: StreamChatOptions): Promise<ResumeRunResult> => {
      await gate.promise;
      options.onDelta("后半");
      options.onEventSeq?.(3);
      return { kind: "resumed", result: { truncated: false } };
    });
    const repo = repository();
    const { result } = renderHook(() => useChatController({
      repository: repo, streamChat: halfThenDisconnect, resumeRun, listActiveRuns: async () => [], reconnectDelaysMs: [0], autoAiTitle: false, runId: () => "run-1",
    }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("修复测试"); });

    await waitFor(() => expect(result.current.messages.at(-1)?.reconnecting).toBe(true));
    expect(result.current.phase).toBe("streaming");
    expect(resumeRun).toHaveBeenCalledWith("run-1", 2, expect.anything());

    await act(async () => { gate.resolve(); await sending; });
    const message = result.current.messages.at(-1)!;
    expect(message).toMatchObject({ status: "complete", text: "前半后半" });
    expect(message.reconnecting).toBeUndefined();
    expect(message.recovery).toBeUndefined();
    expect(repo.stored().at(-1)).toMatchObject({ status: "complete", runEventSeq: 3 });
  });

  it("重连时事件日志已不可用：按网关记录的结局收尾，标记被中断", async () => {
    const resumeRun = vi.fn(async (): Promise<ResumeRunResult> => ({ kind: "unavailable", state: { kind: "finished", status: "interrupted", lastSeq: 2, retained: false } }));
    const { result } = renderHook(() => useChatController({
      repository: repository(), streamChat: halfThenDisconnect, resumeRun, listActiveRuns: async () => [], reconnectDelaysMs: [0], autoAiTitle: false, runId: () => "run-1",
    }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => { await result.current.send("修复测试"); });
    expect(result.current.messages.at(-1)).toMatchObject({ status: "stopped", text: "前半", recovery: { status: "interrupted" } });
  });

  it("多次重连都连不上网关：结果标记为未知，不伪装成完成或失败", async () => {
    const resumeRun = vi.fn(async (): Promise<ResumeRunResult> => { throw new ChatClientError("NETWORK_ERROR"); });
    const { result } = renderHook(() => useChatController({
      repository: repository(), streamChat: halfThenDisconnect, resumeRun, listActiveRuns: async () => [], reconnectDelaysMs: [0, 0, 0], autoAiTitle: false, runId: () => "run-1",
    }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => { await result.current.send("修复测试"); });
    expect(resumeRun).toHaveBeenCalledTimes(3);
    expect(result.current.messages.at(-1)).toMatchObject({ status: "stopped", recovery: { status: "unknown" } });
  });

  it("启动时残留的运行仍在网关中：从头回放事件重建消息，包括仍在等待的审批", async () => {
    const approval = deferred();
    const getRunState = vi.fn(async (): Promise<AgentRunState> => ({ kind: "active", status: "running", lastSeq: 6 }));
    const resumeRun = vi.fn(async (_runId: string, afterSeq: number, options: StreamChatOptions): Promise<ResumeRunResult> => {
      expect(afterSeq).toBe(0);
      options.onRunStarted?.({ runId: "run-1", workspace: "D:/demo", executionMode: "confirm", startedAt: 5 });
      options.onToolCall?.({ id: "w1", name: "write_file", arguments: { path: "src/a.ts" } });
      options.onPermissionRequest?.({ requestId: "run-1-w1", toolName: "write_file", arguments: { path: "src/a.ts" }, callId: "w1" });
      await approval.promise;
      options.onPermissionResolved?.({ requestId: "run-1-w1", approved: true });
      options.onToolResult?.({ id: "w1", name: "write_file", output: "ok", isError: false, durationMs: 1 });
      options.onDelta("改好了");
      options.onEventSeq?.(9);
      return { kind: "resumed", result: { truncated: false } };
    });
    const repo = repository([user, stale]);
    const { result } = renderHook(() => useChatController({
      repository: repo, getRunState, resumeRun, listActiveRuns: async () => [], autoAiTitle: false,
    }));
    await waitFor(() => expect(result.current.pendingPermission?.requestId).toBe("run-1-w1"));
    expect(result.current.phase).toBe("streaming");
    expect(result.current.runningConversations.get("c1")).toBe("approval");
    expect(result.current.messages.at(-1)?.text).toBe("");

    await act(async () => { approval.resolve(); });
    await waitFor(() => expect(result.current.messages.at(-1)?.status).toBe("complete"));
    expect(result.current.messages.at(-1)).toMatchObject({ text: "改好了" });
    expect(result.current.messages.at(-1)?.toolSteps).toEqual([expect.objectContaining({ id: "w1", result: expect.objectContaining({ isError: false }) })]);
    await waitFor(() => expect(repo.stored().at(-1)).toMatchObject({ status: "complete", text: "改好了", runEventSeq: 9 }));
  });

  it("启动时残留的运行已结束且事件不可回填：依据运行记录标记结局，未确认的写入不重放", async () => {
    for (const [state, status, recovery] of [
      [{ kind: "finished", status: "completed", lastSeq: 9, retained: false }, "complete", "completed"],
      [{ kind: "finished", status: "interrupted", lastSeq: 4, retained: false }, "stopped", "interrupted"],
      [{ kind: "unknown" }, "stopped", "unknown"],
    ] as const) {
      const resumeRun = vi.fn();
      const repo = repository([user, stale]);
      const { result, unmount } = renderHook(() => useChatController({
        repository: repo, getRunState: async () => state as AgentRunState, resumeRun, listActiveRuns: async () => [], autoAiTitle: false,
      }));
      await waitFor(() => expect(result.current.messages.at(-1)?.recovery?.status).toBe(recovery));
      expect(result.current.messages.at(-1)).toMatchObject({ status, text: "旧的部分输出" });
      expect(result.current.phase).toBe("idle");
      expect(resumeRun).not.toHaveBeenCalled();
      await waitFor(() => expect(repo.stored().at(-1)).toMatchObject({ status, recovery: { status: recovery } }));
      unmount();
    }
  });
});

describe("长任务的上下文与执行反馈", () => {
  it("请求带上模型窗口；运行提示随消息保存，上下文超限停止时按完成落盘而不是当作失败", async () => {
    const requests: Parameters<StreamChatFunction>[0][] = [];
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      requests.push(request);
      options.onRunStarted?.({ runId: "run-1", workspace: "D:/demo", executionMode: "confirm", startedAt: 5 });
      options.onRunNote?.({ kind: "context_compacted", foldedTurns: 3, beforeTokens: 90_000, afterTokens: 40_000 });
      options.onRunNote?.({ kind: "context_overflow", tokens: 70_000, budgetTokens: 60_000 });
      return { truncated: false, stopReason: "context_overflow" };
    });
    const repo = repository();
    const { result } = renderHook(() => useChatController({
      repository: repo,
      streamChat: stream,
      listActiveRuns: async () => [],
      autoAiTitle: false,
      runId: () => "run-1",
      activeLlmConfig: { provider: "openai", apiKey: "k", model: "m", baseUrl: "https://example.test/v1", custom: { apiFormat: "chat_completions", contextWindow: 80_000 } },
    }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => { await result.current.send("重构日志模块"); });

    expect(requests[0]!.agent?.contextWindow).toBe(80_000);
    const message = result.current.messages.at(-1)!;
    expect(message.status).toBe("complete");
    expect(message.runNotes).toEqual([
      { kind: "context_compacted", foldedTurns: 3, beforeTokens: 90_000, afterTokens: 40_000 },
      { kind: "context_overflow", tokens: 70_000, budgetTokens: 60_000 },
    ]);
    await waitFor(() => expect(repo.stored().at(-1)?.runNotes).toHaveLength(2));
  });
});

