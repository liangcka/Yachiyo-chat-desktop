import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation } from "../domain/chat";
import type { StreamChatOptions, StreamChatRequest, SupplementSubmitResult } from "../services/chat-client";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./use-chat-controller";

const client = vi.hoisted(() => ({
  submitAgentSupplement: vi.fn<(runId: string, id: string, text: string) => Promise<SupplementSubmitResult>>(async () => ({ status: "queued" })),
}));

vi.mock("../services/app-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/app-platform")>()),
  isDesktopApp: () => true,
}));
vi.mock("../services/desktop-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/desktop-bridge")>()),
  setDesktopWorkspaceRoot: vi.fn(async (path: string) => ({ ok: true, path: path.trim() || null })),
}));
vi.mock("../services/reasoning-effort", () => ({ readReasoningEffort: () => undefined }));
vi.mock("../services/chat-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/chat-client")>()),
  submitAgentSupplement: client.submitAgentSupplement,
}));

const conversation: Conversation = { id: "c1", title: "新的对话", locale: "zh-CN", createdAt: 1, updatedAt: 1, workspace: "D:/demo" };

function repository(): ChatRepository & { stored: () => ChatMessage[] } {
  let messages: ChatMessage[] = [];
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

function started(request: StreamChatRequest, options: StreamChatOptions): void {
  options.onRunStarted?.({ runId: request.agent!.runId!, workspace: "D:/demo", executionMode: "confirm", startedAt: 1 });
}

describe("运行中的补充要求", () => {
  beforeEach(() => {
    client.submitAgentSupplement.mockReset();
    client.submitAgentSupplement.mockResolvedValue({ status: "queued" });
  });

  it("补充先排队，网关送达后标记已送达；下一次请求把它并入触发运行的用户消息", async () => {
    const gate = deferred();
    const requests: StreamChatRequest[] = [];
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      requests.push(request);
      if (requests.length === 1) {
        started(request, options);
        await gate.promise;
        const id = client.submitAgentSupplement.mock.calls[0]![1];
        options.onSupplementDelivered?.({ runId: "run-1", ids: [id] });
        options.onDelta("好的，也改了日志级别。");
      } else {
        options.onDelta("收到");
      }
      return { truncated: false };
    });
    const repo = repository();
    const { result } = renderHook(() => useChatController({ repository: repo, streamChat: stream, autoAiTitle: false, runId: () => "run-1" }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("修复测试"); });
    await waitFor(() => expect(result.current.messages.at(-1)?.run?.id).toBe("run-1"));
    await waitFor(() => expect(result.current.phase).toBe("streaming"));

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.supplement("  顺便把日志级别改成 debug  "); });
    expect(outcome).toBe("queued");
    expect(client.submitAgentSupplement).toHaveBeenCalledWith("run-1", expect.any(String), "顺便把日志级别改成 debug");
    expect(result.current.messages.at(-1)?.supplements).toEqual([expect.objectContaining({ text: "顺便把日志级别改成 debug", state: "queued" })]);

    await act(async () => { gate.resolve(); await sending; });
    expect(result.current.messages.at(-1)?.supplements?.[0]?.state).toBe("delivered");
    expect(repo.stored().at(-1)?.supplements?.[0]?.state).toBe("delivered");

    await act(async () => { await result.current.send("谢谢"); });
    const history = requests[1]!.messages;
    const firstUser = history.find((message) => message.role === "user" && message.text.startsWith("修复测试"));
    expect(firstUser?.text).toContain("[任务进行中补充的要求]\n顺便把日志级别改成 debug");
  });

  it("运行结束前没有送达或被网关拒绝的补充标记为未送达，不会伪装成已送达", async () => {
    const gate = deferred();
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      started(request, options);
      await gate.promise;
      options.onDelta("完成");
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository: repository(), streamChat: stream, autoAiTitle: false, runId: () => "run-2" }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("跑测试"); });
    await waitFor(() => expect(result.current.phase).toBe("streaming"));
    await waitFor(() => expect(result.current.messages.at(-1)?.run?.id).toBe("run-2"));

    await act(async () => { await result.current.supplement("加一个用例"); });
    client.submitAgentSupplement.mockResolvedValueOnce({ status: "rejected", code: "RUN_FINISHING" });
    let rejected: string | undefined;
    await act(async () => { rejected = await result.current.supplement("再检查一下 lint"); });
    expect(rejected).toBe("undelivered");
    expect(result.current.messages.at(-1)?.supplements?.map((item) => item.state)).toEqual(["queued", "undelivered"]);

    await act(async () => { gate.resolve(); await sending; });
    expect(result.current.messages.at(-1)?.supplements?.map((item) => item.state)).toEqual(["undelivered", "undelivered"]);
  });

  it("没有进行中的 Agent 运行时不接受补充", async () => {
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("好");
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository: repository(), streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.supplement("补充"); });
    expect(outcome).toBe("unavailable");
    expect(client.submitAgentSupplement).not.toHaveBeenCalled();
  });
});
