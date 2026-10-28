import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation } from "../domain/chat";
import type { StreamChatOptions, StreamChatRequest, StreamChatResult } from "../services/chat-client";
import { projectManager } from "../services/project-manager";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./use-chat-controller";

const bridge = vi.hoisted(() => ({
  setDesktopWorkspaceRoot: vi.fn(async (path: string) => ({ ok: true as const, path: path.trim() || null })),
  executeDesktopAgentTool: vi.fn(async () => ({ output: "引用内容", isError: false })),
}));

vi.mock("../services/app-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/app-platform")>()),
  isDesktopApp: () => true,
}));
vi.mock("../services/desktop-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/desktop-bridge")>()),
  setDesktopWorkspaceRoot: bridge.setDesktopWorkspaceRoot,
  executeDesktopAgentTool: bridge.executeDesktopAgentTool,
}));
vi.mock("../services/reasoning-effort", () => ({ readReasoningEffort: () => undefined }));

const baseConversation: Conversation = { id: "conversation-1", title: "新的对话", locale: "zh-CN", createdAt: 10, updatedAt: 10 };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** 内存仓储：消息与会话归属都可回读，便于断言绑定后续请求的行为 */
function memoryRepository(conversation: Conversation, messages: ChatMessage[] = []) {
  let stored = { ...conversation };
  let storedMessages = [...messages];
  const gate = { putMessage: undefined as Promise<void> | undefined };
  const repository: ChatRepository = {
    createConversation: vi.fn(async () => stored),
    listConversations: vi.fn(async () => [stored]),
    getConversation: vi.fn(async () => stored),
    listMessages: vi.fn(async () => [...storedMessages]),
    putMessage: vi.fn(async (message: ChatMessage) => {
      if (gate.putMessage !== undefined) await gate.putMessage;
      storedMessages = [...storedMessages.filter((item) => item.id !== message.id), message].sort((a, b) => a.createdAt - b.createdAt);
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
    setConversationWorkspace: vi.fn(async (_id: string, workspace: string | null) => {
      if (typeof stored.workspace === "string" && stored.workspace !== workspace) throw new Error("会话已绑定其他项目");
      stored = { ...stored, workspace };
    }),
  };
  return { repository, gate, messages: () => storedMessages };
}

function recordingStream() {
  const requests: StreamChatRequest[] = [];
  const stream = vi.fn<StreamChatFunction>(async (request: StreamChatRequest, options: StreamChatOptions): Promise<StreamChatResult> => {
    requests.push(request);
    if (request.agent?.runId !== undefined) {
      options.onRunStarted?.({
        runId: request.agent.runId,
        workspace: request.agent.workspace ?? null,
        executionMode: request.agent.executionMode ?? "confirm",
        startedAt: 1,
      });
    }
    options.onDelta("完成");
    return { truncated: false };
  });
  return { stream, requests };
}

const history: ChatMessage[] = [
  { id: "u0", conversationId: baseConversation.id, role: "user", text: "旧问题", status: "complete", createdAt: 11 },
  { id: "a0", conversationId: baseConversation.id, role: "assistant", text: "旧回答", status: "complete", createdAt: 12 },
];

describe("任务与工作区归属", () => {
  beforeEach(async () => {
    localStorage.clear();
    bridge.setDesktopWorkspaceRoot.mockClear();
    bridge.executeDesktopAgentTool.mockClear();
    await projectManager.switchProject(null);
  });

  it("空白任务在提交时绑定当前项目，异步准备期间切换项目不改变运行目标", async () => {
    await projectManager.switchProject("D:/alpha");
    const { repository, gate } = memoryRepository(baseConversation);
    const { stream, requests } = recordingStream();
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false, runId: () => "run-1" }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    const release = deferred();
    gate.putMessage = release.promise;
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("修复 @src/app.ts 里的测试"); });
    // 用户在落盘与引用展开完成前切到另一个项目
    await act(async () => { await projectManager.switchProject("D:/beta"); });
    await act(async () => {
      release.resolve();
      await sending;
    });

    expect(repository.setConversationWorkspace).toHaveBeenCalledWith(baseConversation.id, "D:/alpha");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.agent).toMatchObject({ workspace: "D:/alpha", runId: "run-1", conversationId: baseConversation.id });
    // @ 引用从任务所属的项目读取
    expect(bridge.executeDesktopAgentTool).toHaveBeenCalledWith("read_file", { path: "src/app.ts" }, "D:/alpha");
    expect(result.current.activeConversation?.workspace).toBe("D:/alpha");
    expect(result.current.messages.at(-1)?.run).toMatchObject({ id: "run-1", workspace: "D:/alpha" });
  });

  it("没有项目记录的旧会话不采用当前项目，等待用户显式绑定", async () => {
    await projectManager.switchProject("D:/beta");
    const { repository } = memoryRepository(baseConversation, history);
    const { stream, requests } = recordingStream();
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("继续"));
    expect(requests[0]?.agent?.workspace).toBeUndefined();
    expect(repository.setConversationWorkspace).not.toHaveBeenCalled();
    expect(result.current.messages.at(-1)?.run?.workspace).toBeNull();

    await act(async () => { expect(await result.current.bindConversationWorkspace("D:/beta")).toBe(true); });
    await act(async () => result.current.send("再试一次"));
    expect(requests[1]?.agent?.workspace).toBe("D:/beta");
  });

  it("切回已绑定的任务时继续使用绑定项目，并把界面项目对齐过去", async () => {
    await projectManager.switchProject("D:/beta");
    const { repository } = memoryRepository({ ...baseConversation, workspace: "D:/alpha" }, history);
    const { stream, requests } = recordingStream();
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await waitFor(() => expect(projectManager.getState().activeProject).toBe("D:/alpha"));

    // 即使界面又切到别的项目，任务仍在自己的项目中执行
    await act(async () => { await projectManager.switchProject("D:/beta"); });
    await act(async () => result.current.send("继续"));
    expect(requests[0]?.agent?.workspace).toBe("D:/alpha");
    expect(repository.setConversationWorkspace).not.toHaveBeenCalled();
  });

  it("界面项目对齐失败时任务归属不变", async () => {
    await projectManager.switchProject("D:/beta");
    bridge.setDesktopWorkspaceRoot.mockImplementation(async (path: string) =>
      path === "D:/alpha" ? { ok: false as const, error: "目录不存在" } as never : { ok: true as const, path: path || null });
    const { repository } = memoryRepository({ ...baseConversation, workspace: "D:/alpha" }, history);
    const { stream, requests } = recordingStream();
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await waitFor(() => expect(projectManager.getState().switchError?.path).toBe("D:/alpha"));
    expect(projectManager.getState().activeProject).toBe("D:/beta");

    await act(async () => result.current.send("继续"));
    expect(requests[0]?.agent?.workspace).toBe("D:/alpha");
    bridge.setDesktopWorkspaceRoot.mockImplementation(async (path: string) => ({ ok: true as const, path: path.trim() || null }));
  });

  it("执行模式在提交时固定，准备期间切换模式不影响本次运行", async () => {
    await projectManager.switchProject("D:/alpha");
    const { repository, gate } = memoryRepository(baseConversation);
    const { stream, requests } = recordingStream();
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    act(() => result.current.setExecutionMode("readonly"));

    const release = deferred();
    gate.putMessage = release.promise;
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("只看看"); });
    act(() => result.current.setExecutionMode("full_auto"));
    await act(async () => {
      release.resolve();
      await sending;
    });
    expect(requests[0]?.agent?.executionMode).toBe("readonly");
    expect(result.current.messages.at(-1)?.run?.executionMode).toBe("readonly");
  });

  it("已绑定其他项目或正在运行的任务不能改绑", async () => {
    const { repository } = memoryRepository({ ...baseConversation, workspace: "D:/alpha" }, history);
    const { stream } = recordingStream();
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => { expect(await result.current.bindConversationWorkspace("D:/beta")).toBe(false); });
    expect(repository.setConversationWorkspace).not.toHaveBeenCalled();
    expect(result.current.activeConversation?.workspace).toBe("D:/alpha");
  });

  it("网关确认的规范工作区写入运行记录", async () => {
    await projectManager.switchProject("D:/alpha");
    const { repository, messages } = memoryRepository(baseConversation);
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      options.onRunStarted?.({ runId: request.agent!.runId!, workspace: "D:\\Alpha", executionMode: "confirm", startedAt: 1 });
      options.onDelta("完成");
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat: stream, autoAiTitle: false, runId: () => "run-9" }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => result.current.send("检查"));
    expect(result.current.messages.at(-1)?.run).toMatchObject({ id: "run-9", workspace: "D:\\Alpha" });
    expect(messages().at(-1)?.run).toMatchObject({ id: "run-9", workspace: "D:\\Alpha" });
  });
});
