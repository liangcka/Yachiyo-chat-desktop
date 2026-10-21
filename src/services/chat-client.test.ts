import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYSTORE_MANAGED_API_KEY } from "../domain/llm";
import { ChatClientError, isRetryableChatErrorCode, streamChat, type StreamChatRequest } from "./chat-client";

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
});
