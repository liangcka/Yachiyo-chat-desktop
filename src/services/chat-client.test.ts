import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYSTORE_MANAGED_API_KEY } from "../domain/llm";
import {
  ChatClientError,
  isRetryableChatErrorCode,
  isStreamDisconnect,
  resumeAgentRun,
  streamChat,
  type StreamChatRequest,
} from "./chat-client";

const sampleRequest: StreamChatRequest = {
  locale: "zh-CN",
  messages: [{ role: "user", text: "今天有点累" }],
};

function splitBytes(value: string, sizes: number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(value);
  const parts: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = sizes[index % sizes.length] ?? 1;
    parts.push(bytes.slice(offset, offset + size));
    offset += size;
    index += 1;
  }
  return parts;
}

function sseResponse(value: string, sizes = [1, 2, 5, 3]): Response {
  const chunks = splitBytes(value, sizes);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

function problem(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("streamChat", () => {
  let serverFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    serverFetch = vi.fn<typeof fetch>();
  });

  it("reports an agent loop stop carried by the done event", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: done\ndata: {"truncated":false,"reason":"loop_detected"}\n\n'),
    );
    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: () => undefined }),
    ).resolves.toEqual({ truncated: false, stopReason: "loop_detected" });
  });

  it("forwards notice events without ending the stream", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        'event: notice\ndata: {"code":"REASONING_EFFORT_REJECTED"}\n\n' +
          'event: delta\ndata: {"text":"好"}\n\n' +
          'event: done\ndata: {"truncated":false}\n\n',
      ),
    );
    const onNotice = vi.fn();
    const onDelta = vi.fn();
    await expect(streamChat(sampleRequest, { fetcher: serverFetch, onDelta, onNotice })).resolves.toEqual({ truncated: false });
    expect(onNotice).toHaveBeenCalledWith("REASONING_EFFORT_REJECTED");
    expect(onDelta).toHaveBeenCalledWith("好");
  });

  it("parses Unicode delta records split across arbitrary byte boundaries", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        'event: delta\r\ndata: {"text":"彩叶~"}\r\n\r\n' +
          'event: delta\ndata: {"text":"辛苦啦！"}\n\n' +
          'event: done\ndata: {"truncated":false}\n\n',
      ),
    );
    const chunks: string[] = [];

    await expect(
      streamChat(sampleRequest, {
        fetcher: serverFetch,
        onDelta: (text) => chunks.push(text),
      }),
    ).resolves.toEqual({ truncated: false });

    expect(chunks).toEqual(["彩叶~", "辛苦啦！"]);
    expect(serverFetch).toHaveBeenCalledWith("/api/chat", {
      body: JSON.stringify(sampleRequest),
      credentials: "same-origin",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      method: "POST",
      signal: undefined,
    });
  });

  it("serializes currentTime in request body when provided", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: done\ndata: {"truncated":false}\n\n'),
    );
    const requestWithTime: StreamChatRequest = {
      ...sampleRequest,
      currentTime: "2026-08-27 11:09:37 星期四",
    };

    await streamChat(requestWithTime, {
      fetcher: serverFetch,
      onDelta: () => undefined,
    });

    expect(serverFetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({
      body: JSON.stringify(requestWithTime),
    }));
  });

  it("omits the keystore placeholder so the desktop gateway reads its stored key", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: done\ndata: {"truncated":false}\n\n'),
    );

    await streamChat(
      { ...sampleRequest, provider: "claude", apiKey: KEYSTORE_MANAGED_API_KEY, model: "claude-sonnet-5-5" },
      { fetcher: serverFetch, onDelta: () => undefined },
    );

    const body = JSON.parse(serverFetch.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("apiKey");
    expect(body).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5" });
  });

  it.each([
    [problem("SESSION_REQUIRED", 401), "SESSION_REQUIRED"],
    [problem("DAILY_QUOTA_EXCEEDED", 429), "DAILY_QUOTA_EXCEEDED"],
    [problem("INVALID_REQUEST", 400), "INVALID_REQUEST"],
    [problem("PROVIDER_TIMEOUT", 504), "PROVIDER_ERROR"],
  ] as const)("maps HTTP failures to a stable client code", async (response, code) => {
    serverFetch.mockResolvedValue(response);

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code }));
  });

  it("maps a sanitized provider stream error", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: error\ndata: {"code":"PROVIDER_STREAM_ERROR"}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ChatClientError>>({ code: "PROVIDER_ERROR" }),
    );
  });

  it("maps the desktop gateway's missing-key event to a non-retryable code", async () => {
    serverFetch.mockResolvedValue(sseResponse('event: error\ndata: {"code":"API_KEY_MISSING"}\n\n'));

    const error = await streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ChatClientError);
    expect((error as ChatClientError).code).toBe("API_KEY_MISSING");
    expect((error as ChatClientError).retryable).toBe(false);
  });

  it("generalizes in-stream error events to any code and preserves the message as detail", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: error\ndata: {"code":"RATE_LIMITED","message":"请求过于频繁，请稍后再试"}\n\n'),
    );

    const error = await streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ChatClientError);
    const clientError = error as ChatClientError;
    expect(clientError.code).toBe("PROVIDER_ERROR");
    expect(clientError.retryable).toBe(true);
    expect(clientError.detail).toBe("RATE_LIMITED 请求过于频繁，请稍后再试");
  });

  it("keeps the sanitized provider stream error detail when a message is present", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: error\ndata: {"code":"PROVIDER_STREAM_ERROR","message":"上游超时"}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ChatClientError>>({
        code: "PROVIDER_ERROR",
        detail: "上游超时",
      }),
    );
  });

  it("exposes retryable only for transient codes", () => {
    for (const transient of ["NETWORK_ERROR", "PROVIDER_ERROR", "SERVICE_UNAVAILABLE", "STREAM_ERROR"]) {
      expect(isRetryableChatErrorCode(transient)).toBe(true);
    }
    for (const permanent of [
      "SESSION_REQUIRED",
      "DAILY_QUOTA_EXCEEDED",
      "INVALID_REQUEST",
      "ABORTED",
      undefined,
    ]) {
      expect(isRetryableChatErrorCode(permanent)).toBe(false);
    }
  });

  it("rejects malformed or incomplete streams", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: delta\ndata: {"text":42}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "STREAM_ERROR" }));
  });

  it("delivers a valid sources event before deltas exactly once", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        'event: sources\ndata: {"sources":[{"title":"必应搜索结果一","url":"https://www.bing.com/"},{"title":"必应搜索结果二","url":"https://cn.bing.com/"}]}\n\n' +
          'event: delta\ndata: {"text":"基于搜索的回复"}\n\n' +
          'event: done\ndata: {"truncated":false}\n\n',
      ),
    );
    const calls: string[] = [];
    const onSources = vi.fn((sources: Array<{ title: string; url: string }>) => {
      calls.push("sources");
      expect(sources).toEqual([
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ]);
    });

    await expect(
      streamChat(sampleRequest, {
        fetcher: serverFetch,
        onDelta: (text) => calls.push(`delta:${text}`),
        onSources,
      }),
    ).resolves.toEqual({ truncated: false });

    expect(onSources).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["sources", "delta:基于搜索的回复"]);
  });

  it.each([
    'event: sources\ndata: {"sources":{"title":"对象而非数组","url":"https://www.bing.com/"}}\n\n',
    'event: sources\ndata: {"sources":[{"title":42,"url":"https://www.bing.com/"}]}\n\n',
    'event: sources\ndata: {"sources":[{"title":"缺少 url"}]}\n\n',
    'event: sources\ndata: {"sources":[null]}\n\n',
    'event: sources\ndata: {"other":[]}\n\n',
  ])("rejects malformed sources payloads (%s)", async (stream) => {
    serverFetch.mockResolvedValue(sseResponse(stream + 'event: done\ndata: {"truncated":false}\n\n'));

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn(), onSources: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "STREAM_ERROR" }));
  });

  it("validates sources payloads even when no onSources callback is provided", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: sources\ndata: {"sources":"invalid"}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "STREAM_ERROR" }));
  });

  it("forwards webSearch flag in the request body", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: done\ndata: {"truncated":false}\n\n'),
    );

    await streamChat(
      { ...sampleRequest, webSearch: true },
      { fetcher: serverFetch, onDelta: vi.fn() },
    );

    expect(serverFetch).toHaveBeenCalledWith("/api/chat", {
      body: JSON.stringify({ ...sampleRequest, webSearch: true }),
      credentials: "same-origin",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      method: "POST",
      signal: undefined,
    });
  });

  it("distinguishes offline and aborted requests", async () => {
    serverFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "NETWORK_ERROR" }));

    const controller = new AbortController();
    controller.abort();
    serverFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(
      streamChat(sampleRequest, {
        fetcher: serverFetch,
        onDelta: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "ABORTED" }));
  });

  it("handles thought events and returns usage on completion", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        'event: thought\r\ndata: {"text":"思考..."}\r\n\r\n' +
          'event: delta\ndata: {"text":"回复"}\n\n' +
          'event: done\ndata: {"truncated":false,"usage":{"promptTokens":10,"completionTokens":5,"totalTokens":15}}\n\n',
      ),
    );
    const deltas: string[] = [];
    const thoughts: string[] = [];

    const result = await streamChat(sampleRequest, {
      fetcher: serverFetch,
      onDelta: (text) => deltas.push(text),
      onThought: (text) => thoughts.push(text),
    });

    expect(deltas).toEqual(["回复"]);
    expect(thoughts).toEqual(["思考..."]);
    expect(result).toEqual({
      truncated: false,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it("aborts and throws STREAM_ERROR when stream reading exceeds inactivity timeout", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('event: delta\ndata: {"text":"第一句"}\n\n'));
      },
    });
    serverFetch.mockResolvedValue(
      new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    );

    const deltas: string[] = [];
    const promise = streamChat(sampleRequest, {
      fetcher: serverFetch,
      inactivityTimeoutMs: 40,
      onDelta: (text) => deltas.push(text),
    });

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<ChatClientError>>({
        code: "STREAM_ERROR",
        retryable: true,
      }),
    );
    expect(deltas).toEqual(["第一句"]);
  });

  it("safely ignores SSE comment lines such as : ping and continues streaming", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        ': ping\r\n\r\n' +
          'event: delta\ndata: {"text":"你好"}\n\n' +
          ': ping\n\n' +
          'event: done\ndata: {"truncated":false}\n\n',
      ),
    );
    const deltas: string[] = [];

    const result = await streamChat(sampleRequest, {
      fetcher: serverFetch,
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["你好"]);
    expect(result).toEqual({ truncated: false });
  });
});

describe("agent 事件解析", () => {
  let serverFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    serverFetch = vi.fn<typeof fetch>();
  });

  function sse(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  it("解析 tool_call / tool_result / turn 事件", async () => {
    const events: unknown[] = [];
    serverFetch.mockResolvedValue(
      sseResponse(
        sse("turn", { index: 1 }) +
          sse("tool_call", { id: "call-1", name: "read_file", arguments: { path: "a.ts" } }) +
          sse("tool_result", { id: "call-1", name: "read_file", output: "hi", isError: false, durationMs: 12 }) +
          sse("done", { truncated: false }),
      ),
    );

    await streamChat(
      { locale: "zh-CN", messages: [{ role: "user", text: "hi" }], agent: { enabled: true } },
      {
        fetcher: serverFetch,
        onDelta: () => undefined,
        onToolCall: (call) => events.push({ kind: "tool_call", call }),
        onToolResult: (result) => events.push({ kind: "tool_result", result }),
        onTurn: (turn) => events.push({ kind: "turn", turn }),
      },
    );

    expect(events).toEqual([
      { kind: "turn", turn: { index: 1 } },
      { kind: "tool_call", call: { id: "call-1", name: "read_file", arguments: { path: "a.ts" } } },
      { kind: "tool_result", result: { id: "call-1", name: "read_file", output: "hi", isError: false, durationMs: 12 } },
    ]);
  });

  it("畸形 tool_call 载荷抛 STREAM_ERROR", async () => {
    serverFetch.mockResolvedValue(sseResponse('event: tool_call\ndata: {"id":1}\n\n'));

    await expect(
      streamChat(
        { locale: "zh-CN", messages: [{ role: "user", text: "hi" }] },
        { fetcher: serverFetch, onDelta: () => undefined, onToolCall: () => undefined },
      ),
    ).rejects.toMatchObject({ code: "STREAM_ERROR" });
  });

  it("支持在 agent 请求中携带 workspace 路径", async () => {
    serverFetch.mockResolvedValue(sseResponse('event: done\ndata: {"truncated":false}\n\n'));

    await streamChat(
      {
        locale: "zh-CN",
        messages: [{ role: "user", text: "这是什么" }],
        agent: { enabled: true, workspace: "D:\\test\\project" },
      },
      { fetcher: serverFetch, onDelta: () => undefined },
    );

    expect(serverFetch).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        body: expect.stringContaining('"workspace":"D:\\\\test\\\\project"'),
      }),
    );
  });

  it("解析运行身份、命令增量输出、结构化命令记录与取消收尾", async () => {
    const command = {
      executionId: "exec-1", command: "npm test", cwd: "D:/demo", exitCode: 1, durationMs: 3200,
      endReason: "exited", exitConfirmed: true, outputBytes: 42, truncated: false,
    };
    serverFetch.mockResolvedValue(
      sseResponse(
        sse("run_started", { runId: "run-1", conversationId: "c1", workspace: "D:/demo", executionMode: "confirm", provider: "openai", model: "m", startedAt: 5 }) +
          sse("tool_call", { id: "t1", name: "run_command", arguments: { command: "npm test" } }) +
          sse("tool_output", { id: "t1", stream: "stdout", text: "running…\n" }) +
          sse("tool_result", { id: "t1", name: "run_command", output: "[结果] 失败：退出码 1", isError: true, durationMs: 3200, command }) +
          sse("permission_request", { requestId: "run-1-t2", toolName: "write_file", arguments: {}, callId: "t2" }) +
          sse("permission_resolved", { requestId: "run-1-t2", approved: false, reason: "timeout" }) +
          sse("run_status", { runId: "run-1", status: "cancelling", pending: [{ callId: "m1", name: "mcp__x__y", detail: "等待返回" }] }) +
          sse("done", { truncated: false, reason: "cancelled", unknown: [{ callId: "m1", name: "mcp__x__y", detail: "未返回" }] }),
      ),
    );
    const events: unknown[] = [];
    const result = await streamChat(
      { locale: "zh-CN", messages: [{ role: "user", text: "hi" }], agent: { enabled: true, runId: "run-1" } },
      {
        fetcher: serverFetch,
        onDelta: () => undefined,
        onRunStarted: (run) => events.push({ kind: "run", run }),
        onToolOutput: (output) => events.push({ kind: "output", output }),
        onToolResult: (toolResult) => events.push({ kind: "result", toolResult }),
        onPermissionRequest: (request) => events.push({ kind: "permission", request }),
        onPermissionResolved: (resolved) => events.push({ kind: "resolved", resolved }),
        onRunStatus: (status) => events.push({ kind: "status", status }),
      },
    );
    expect(result).toEqual({ truncated: false, stopReason: "cancelled", unknownOperations: [{ callId: "m1", name: "mcp__x__y", detail: "未返回" }] });
    expect(events).toEqual([
      { kind: "run", run: { runId: "run-1", conversationId: "c1", workspace: "D:/demo", executionMode: "confirm", startedAt: 5 } },
      { kind: "output", output: { id: "t1", stream: "stdout", text: "running…\n" } },
      { kind: "result", toolResult: { id: "t1", name: "run_command", output: "[结果] 失败：退出码 1", isError: true, durationMs: 3200, command } },
      { kind: "permission", request: { requestId: "run-1-t2", toolName: "write_file", arguments: {}, callId: "t2" } },
      { kind: "resolved", resolved: { requestId: "run-1-t2", approved: false, reason: "timeout" } },
      { kind: "status", status: { runId: "run-1", status: "cancelling", pending: [{ callId: "m1", name: "mcp__x__y", detail: "等待返回" }] } },
    ]);
  });

  it("同一项目的其他任务正在写入时，解析等待状态而不是判为流损坏", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        sse("run_status", { runId: "run-2", status: "waiting_for_workspace", pending: [{ callId: "w1", name: "write_file", detail: "等待同一项目中的其他任务完成写入" }] }) +
          sse("run_status", { runId: "run-2", status: "running", pending: [] }) +
          sse("done", { truncated: false }),
      ),
    );
    const statuses: unknown[] = [];
    await streamChat(
      { locale: "zh-CN", messages: [{ role: "user", text: "hi" }], agent: { enabled: true, runId: "run-2" } },
      { fetcher: serverFetch, onDelta: () => undefined, onRunStatus: (status) => statuses.push(status) },
    );
    expect(statuses).toEqual([
      { runId: "run-2", status: "waiting_for_workspace", pending: [{ callId: "w1", name: "write_file", detail: "等待同一项目中的其他任务完成写入" }] },
      { runId: "run-2", status: "running", pending: [] },
    ]);
  });

  it("残缺的命令执行记录视为流损坏，不能作为验证证据", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(sse("tool_result", { id: "t1", name: "run_command", output: "ok", isError: false, durationMs: 1, command: { executionId: "e", exitCode: 0 } })),
    );
    await expect(
      streamChat({ locale: "zh-CN", messages: [{ role: "user", text: "hi" }] }, { fetcher: serverFetch, onDelta: () => undefined }),
    ).rejects.toMatchObject({ code: "STREAM_ERROR" });
  });

  it("事件序号：处理后回报序号，重复事件跳过，缺口单独通知", async () => {
    const seqs: number[] = [];
    const text: string[] = [];
    const gaps: unknown[] = [];
    serverFetch.mockResolvedValue(sseResponse(
      `event: gap\ndata: {"from":3,"to":4}\n\n`
        + `id: 2\n${sse("delta", { text: "重复" })}`
        + `id: 5\n${sse("delta", { text: "新的" })}`
        + `id: 6\n${sse("done", { truncated: false })}`,
    ));
    const result = await resumeAgentRun("run-1", 2, {
      fetcher: serverFetch,
      onDelta: (delta) => text.push(delta),
      onEventSeq: (seq) => seqs.push(seq),
      onEventGap: (gap) => gaps.push(gap),
    });
    expect(result).toEqual({ kind: "resumed", result: { truncated: false } });
    expect(String(serverFetch.mock.calls[0]![0])).toContain("/api/agent/runs/run-1/events?after=2");
    expect(text).toEqual(["新的"]);
    expect(seqs).toEqual([5, 6]);
    expect(gaps).toEqual([{ from: 3, to: 4 }]);
  });

  it("事件日志不可用时返回运行状态，不重放", async () => {
    serverFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: "RUN_EVENTS_UNAVAILABLE", state: { kind: "finished", status: "interrupted", lastSeq: 9, retained: false } }),
      { status: 404, headers: { "content-type": "application/json" } },
    ));
    const result = await resumeAgentRun("run-1", 3, { fetcher: serverFetch, onDelta: () => undefined });
    expect(result).toEqual({ kind: "unavailable", state: { kind: "finished", status: "interrupted", lastSeq: 9, retained: false } });
  });

  it("连接在终止事件之前结束视为断线，可按序号重连；网关下发的错误不是断线", async () => {
    serverFetch.mockResolvedValueOnce(sseResponse(`id: 1\n${sse("delta", { text: "一半" })}`));
    const disconnected = await streamChat(sampleRequest, { fetcher: serverFetch, onDelta: () => undefined }).catch((error: unknown) => error);
    expect(isStreamDisconnect(disconnected)).toBe(true);

    serverFetch.mockResolvedValueOnce(sseResponse(sse("error", { code: "PROVIDER_STREAM_ERROR" })));
    const failed = await streamChat(sampleRequest, { fetcher: serverFetch, onDelta: () => undefined }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(ChatClientError);
    expect(isStreamDisconnect(failed)).toBe(false);
  });

  it("解析运行提示与上下文超限的结束原因，不认识的提示忽略", async () => {
    const notes: unknown[] = [];
    serverFetch.mockResolvedValue(sseResponse(
      sse("run_note", { kind: "context_compacted", detail: { foldedTurns: 2, beforeTokens: 9000, afterTokens: 4000, budgetTokens: 5000 } })
        + sse("run_note", { kind: "verification_reminder", detail: { reason: "not_verified", files: ["src/a.ts"] } })
        + sse("run_note", { kind: "verification_reminder", detail: { reason: "verification_failed", command: "npm test" } })
        + sse("run_note", { kind: "future_kind", detail: {} })
        + sse("run_note", { kind: "context_overflow", detail: { tokens: 7000, budgetTokens: 5000 } })
        + sse("done", { truncated: false, reason: "context_overflow" }),
    ));
    const result = await streamChat(sampleRequest, { fetcher: serverFetch, onDelta: () => undefined, onRunNote: (note) => notes.push(note) });
    expect(result.stopReason).toBe("context_overflow");
    expect(notes).toEqual([
      { kind: "context_compacted", foldedTurns: 2, beforeTokens: 9000, afterTokens: 4000 },
      { kind: "verification_reminder", reason: "not_verified", files: ["src/a.ts"] },
      { kind: "verification_reminder", reason: "verification_failed", command: "npm test" },
      { kind: "context_overflow", tokens: 7000, budgetTokens: 5000 },
    ]);
  });
});

