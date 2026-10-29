import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, CommandRecord, Conversation } from "../domain/chat";
import { ChatClientError, type StreamChatOptions, type StreamChatRequest } from "../services/chat-client";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./use-chat-controller";

const client = vi.hoisted(() => ({
  cancelAgentRun: vi.fn<(runId: string) => Promise<"accepted" | "not_active" | "failed">>(async () => "accepted"),
  submitAgentApproval: vi.fn<(payload: unknown) => Promise<boolean>>(async () => true),
  stopAgentToolCall: vi.fn<(runId: string, callId: string) => Promise<boolean>>(async () => true),
}));

vi.mock("../services/app-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/app-platform")>()),
  isDesktopApp: () => true,
}));
vi.mock("../services/desktop-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/desktop-bridge")>()),
  setDesktopWorkspaceRoot: vi.fn(async (path: string) => ({ ok: true, path: path.trim() || null })),
  executeDesktopAgentTool: vi.fn(async () => ({ output: "", isError: false })),
}));
vi.mock("../services/reasoning-effort", () => ({ readReasoningEffort: () => undefined }));
vi.mock("../services/chat-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/chat-client")>()),
  cancelAgentRun: client.cancelAgentRun,
  submitAgentApproval: client.submitAgentApproval,
  stopAgentToolCall: client.stopAgentToolCall,
}));

const conversation: Conversation = { id: "c1", title: "新的对话", locale: "zh-CN", createdAt: 1, updatedAt: 1, workspace: "D:/demo" };

function repository(): ChatRepository {
  let messages: ChatMessage[] = [];
  return {
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

const cancelledCommand: CommandRecord = {
  executionId: "exec-1", command: "npm test", cwd: "D:/demo", durationMs: 900,
  endReason: "cancelled", exitConfirmed: true, outputBytes: 12, truncated: false,
};

function startRun(request: StreamChatRequest, options: StreamChatOptions) {
  options.onRunStarted?.({ runId: request.agent!.runId!, workspace: "D:/demo", executionMode: "confirm", startedAt: 1 });
  options.onToolCall?.({ id: "t1", name: "run_command", arguments: { command: "npm test" } });
}

describe("取消与命令执行状态", () => {
  beforeEach(() => {
    client.cancelAgentRun.mockReset();
    client.cancelAgentRun.mockResolvedValue("accepted");
    client.submitAgentApproval.mockClear();
    client.stopAgentToolCall.mockClear();
  });

  it("停止后先进入正在取消，等网关确认命令终止后才结束为已取消", async () => {
    const backendCancelled = deferred();
    let aborted = false;
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      options.signal?.addEventListener("abort", () => { aborted = true; });
      startRun(request, options);
      options.onToolOutput?.({ id: "t1", stream: "stdout", text: "running 1/3\n" });
      await backendCancelled.promise;
      options.onToolResult?.({ id: "t1", name: "run_command", output: "[结果] 已取消", isError: true, durationMs: 900, command: cancelledCommand });
      return { truncated: false, stopReason: "cancelled" };
    });
    client.cancelAgentRun.mockImplementation(async () => {
      setTimeout(() => backendCancelled.resolve(), 50);
      return "accepted";
    });
    const { result } = renderHook(() => useChatController({ repository: repository(), streamChat: stream, autoAiTitle: false, runId: () => "run-1" }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("跑测试"); });
    await waitFor(() => expect(result.current.messages.at(-1)?.toolSteps?.[0]?.liveOutput).toContain("running 1/3"));

    let stopping: Promise<void> | undefined;
    act(() => { stopping = result.current.stop(); });
    await waitFor(() => expect(result.current.messages.at(-1)?.cancelRequested).toBe(true));
    expect(result.current.runningConversations.get("c1")).toBe("cancelling");
    expect(result.current.phase).toBe("streaming");
    expect(client.cancelAgentRun).toHaveBeenCalledWith("run-1");

    await act(async () => { await stopping; await sending; });
    const message = result.current.messages.at(-1);
    expect(aborted).toBe(false);
    expect(message).toMatchObject({ status: "stopped", cancellation: { confirmed: true } });
    expect(message?.cancelRequested).toBeUndefined();
    expect(message?.toolSteps?.[0]?.result?.command?.endReason).toBe("cancelled");
    expect(message?.toolSteps?.[0]?.liveOutput).toBeUndefined();
    expect(result.current.runningConversations.has("c1")).toBe(false);
  });

  it("取消接口不可用时断开连接，并如实标记未确认的操作", async () => {
    client.cancelAgentRun.mockResolvedValue("failed");
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      startRun(request, options);
      await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
      throw new ChatClientError("ABORTED");
    });
    const { result } = renderHook(() => useChatController({ repository: repository(), streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("跑测试"); });
    await waitFor(() => expect(result.current.messages.at(-1)?.toolSteps).toHaveLength(1));
    await act(async () => { await result.current.stop(); await sending; });
    expect(result.current.messages.at(-1)).toMatchObject({
      status: "stopped",
      cancellation: { confirmed: false, unknown: [{ callId: "t1", name: "run_command" }] },
    });
  });

  it("审批携带所属运行编号，取消后不再回填", async () => {
    const backendCancelled = deferred();
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      startRun(request, options);
      options.onPermissionRequest?.({ requestId: "run-2-t1", toolName: "run_command", arguments: { command: "npm test" }, callId: "t1" });
      await backendCancelled.promise;
      return { truncated: false, stopReason: "cancelled" };
    });
    client.cancelAgentRun.mockImplementation(async () => {
      backendCancelled.resolve();
      return "accepted";
    });
    const { result } = renderHook(() => useChatController({ repository: repository(), streamChat: stream, autoAiTitle: false, runId: () => "run-2" }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("跑测试"); });
    await waitFor(() => expect(result.current.pendingPermission?.callId).toBe("t1"));

    await act(async () => { expect(await result.current.approvePermission("run-2-t1", true)).toBe(true); });
    expect(client.submitAgentApproval).toHaveBeenCalledWith({ runId: "run-2", requestId: "run-2-t1", approved: true });

    await act(async () => { await result.current.stop(); await sending; });
    await act(async () => { expect(await result.current.approvePermission("run-2-t1", true)).toBe(false); });
    expect(client.submitAgentApproval).toHaveBeenCalledTimes(1);
  });

  it("命令增量输出只保留末尾，结果到达后以结构化记录取代", async () => {
    const finish = deferred();
    const command: CommandRecord = { ...cancelledCommand, endReason: "exited", exitCode: 1 };
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      startRun(request, options);
      options.onToolOutput?.({ id: "t1", stream: "stdout", text: "a".repeat(10_000) });
      options.onToolOutput?.({ id: "t1", stream: "stderr", text: "末尾的错误" });
      await finish.promise;
      options.onToolResult?.({ id: "t1", name: "run_command", output: "[结果] 失败：退出码 1", isError: true, durationMs: 900, command });
      options.onDelta("测试失败");
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository: repository(), streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("跑测试"); });
    await waitFor(() => expect(result.current.messages.at(-1)?.toolSteps?.[0]?.liveOutput?.endsWith("末尾的错误")).toBe(true));
    expect(result.current.messages.at(-1)?.toolSteps?.[0]?.liveOutput?.length).toBeLessThanOrEqual(8 * 1024);

    await act(async () => { await result.current.stopToolCall("t1"); });
    expect(client.stopAgentToolCall).toHaveBeenCalledWith(expect.any(String), "t1");

    await act(async () => { finish.resolve(); await sending; });
    const step = result.current.messages.at(-1)?.toolSteps?.[0];
    expect(step?.liveOutput).toBeUndefined();
    expect(step?.result).toMatchObject({ isError: true, command: { exitCode: 1, endReason: "exited" } });
  });
});
