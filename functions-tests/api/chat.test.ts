import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie, signSession } from "../../functions/_shared/session";
import { collectClientEvents } from "../../functions/_shared/stream";
import { onRequestPost } from "../../functions/api/chat";

const origin = "https://yachiyo.test";
const providerOrigin = "https://api.stepfun.com";
const providerPath = "/step_plan/v1/chat/completions";
const providerUrl = `${providerOrigin}${providerPath}`;
const providerFetch = vi.fn<typeof fetch>();
const upstreamPaths = [
  {
    name: "服务器密钥",
    credentials: {},
    authError: "PROVIDER_ERROR",
    quotaError: "PROVIDER_ERROR",
  },
  {
    name: "用户密钥",
    credentials: {
      provider: "openai",
      apiKey: "sk-" + "a".repeat(40),
      model: "gpt-5.6-luna",
    },
    authError: "PROVIDER_AUTH_FAILED",
    quotaError: "PROVIDER_QUOTA_EXCEEDED",
  },
] as const;

function providerSse(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

const bingUrlPrefix = "https://www.bing.com/search";

function bingRss(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel><title>上海天气 - Bing</title>',
    "<item><title>上海天气实况</title><link>https://weather.example.cn/shanghai</link><description>今日多云，24至30度。</description></item>",
    "</channel></rss>",
  ].join("");
}

/** 国际路（en-US 近 30 天）的模拟结果：带发布日期的权威新信息 */
function internationalBingRss(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel><title>Gemini - Bing</title>',
    "<item><title>Gemini 3.7 Flash</title><link>https://deepmind.google/models/gemini/flash/</link><description>Our most intelligent workhorse model.</description><pubDate>Thu, 20 Aug 2026 12:11:00 GMT</pubDate></item>",
    "</channel></rss>",
  ].join("");
}

function bingSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&mkt=zh-CN&setlang=zh-hans`;
}

/** 非流式搜索意图判断响应（OpenAI 兼容格式，与服务端 fallback 的 StepFun judge 一致） */
function judgeResponse(verdict: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: verdict } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 识别搜索意图判断请求：judge 请求非流式，accept 为 application/json */
function isJudgeInit(init?: RequestInit): boolean {
  return ((init?.headers ?? {}) as Record<string, string>).accept === "application/json";
}

async function toRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Request> {
  return input instanceof Request ? input : new Request(input, init);
}

async function chatRequest(
  body: unknown,
  sessionId: string,
  runtimeEnv: Env = env,
  deviceId = "device-abc123",
): Promise<Request> {
  const token = await signSession(
    { sid: sessionId, exp: Date.now() + 60_000, deviceId },
    runtimeEnv.SESSION_SIGNING_SECRET,
  );
  const cookie = sessionCookie(token).split(";", 1)[0];

  return new Request(`${origin}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function invoke(request: Request, runtimeEnv: Env = env): Promise<Response> {
  return onRequestPost({ request, env: runtimeEnv });
}

beforeEach(async () => {
  const keys = await env.RATE_LIMIT_KV.list();
  await Promise.all(keys.keys.map(({ name }) => env.RATE_LIMIT_KV.delete(name)));
  providerFetch.mockReset();
  providerFetch.mockRejectedValue(new Error("Unexpected outbound request"));
  vi.stubGlobal("fetch", providerFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("POST /api/chat", () => {
  it("requires a valid signed device session", async () => {
    const response = await invoke(
      new Request(`${origin}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ locale: "zh-CN", messages: [{ role: "user", text: "你好" }] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "SESSION_REQUIRED" } });
  });

  it("passes the origin check for the native app origin", async () => {
    const response = await invoke(
      new Request(`${origin}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://localhost" },
        body: JSON.stringify({ locale: "zh-CN", messages: [{ role: "user", text: "你好" }] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "SESSION_REQUIRED" } });
  });

  it("sends text with low effort and exposes only sanitized SSE", async () => {
    let outbound: Record<string, unknown> | undefined;
    let upstreamRequest: Request | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      upstreamRequest = input instanceof Request ? input : new Request(input, init);
      outbound = JSON.parse(await upstreamRequest.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~今天也辛苦啦！"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "今天有点累" }] },
        "text-session",
      ),
    );
    const clientText = await response.text();
    const events = await collectClientEvents(new Response(clientText).body!);

    expect(response.status).toBe(200);
    expect(upstreamRequest?.url).toBe(providerUrl);
    expect(upstreamRequest?.method).toBe("POST");
    expect(upstreamRequest?.headers.get("authorization")).toBe(
      `Bearer ${env.STEPFUN_API_KEY}`,
    );
    expect(outbound).toMatchObject({
      model: "step-3.7-flash",
      reasoning_effort: "low",
      stream: true,
    });
    expect(JSON.stringify(outbound)).toContain("月见八千代");
    expect(events).toEqual([
      { type: "delta", text: "彩叶~今天也辛苦啦！" },
      { type: "done", truncated: false },
    ]);
    expect(clientText).not.toContain(env.STEPFUN_API_KEY);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("sends the last user image with medium effort", async () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    let outbound: Record<string, unknown> | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe(providerUrl);
      outbound = JSON.parse(await request.text()) as Record<string, unknown>;
      return new Response(providerSse("看见啦~"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "这是什么？", imageDataUrl }],
        },
        "image-session",
      ),
    );
    await response.text();

    expect(outbound).toMatchObject({ reasoning_effort: "medium" });
    expect(JSON.stringify(outbound)).toContain(imageDataUrl);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("never returns an upstream error body or provider credential", async () => {
    providerFetch.mockImplementationOnce(async (input) => {
      expect(String(input)).toBe(providerUrl);
      return new Response(`provider-debug ${env.STEPFUN_API_KEY}`, { status: 500 });
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "你好" }] },
        "error-session",
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ error: { code: "PROVIDER_ERROR" } });
    expect(text).not.toContain("provider-debug");
    expect(text).not.toContain(env.STEPFUN_API_KEY);
  });

  it("rejects a consumed daily quota before contacting StepFun", async () => {
    const deviceId = "device-abc123";
    const date = new Date().toISOString().slice(0, 10);
    await env.RATE_LIMIT_KV.put(`quota:${date}:${deviceId}`, env.DAILY_REQUEST_LIMIT);

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "再聊一句" }] },
        "quota-session",
        env,
        deviceId,
      ),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "DAILY_QUOTA_EXCEEDED" } });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("exempts title mode from consuming daily quota", async () => {
    const deviceId = "device-quota-exemption";
    const date = new Date().toISOString().slice(0, 10);
    await env.RATE_LIMIT_KV.put(`quota:${date}:${deviceId}`, env.DAILY_REQUEST_LIMIT);

    providerFetch.mockImplementationOnce(async () => {
      return new Response(providerSse("量子力学探索"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "生成标题" }], mode: "title" },
        "quota-session",
        env,
        deviceId,
      ),
    );

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalled();
  });

  it("uses the same localized SSE contract in explicit mock mode", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const response = await invoke(
      await chatRequest(
        { locale: "ja-JP", messages: [{ role: "user", text: "こんばんは" }] },
        "mock-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);

    expect(response.status).toBe(200);
    expect(events.some((event) => event.type === "delta" && event.text.includes("彩葉"))).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({
      type: "done",
      truncated: false,
      usage: { promptTokens: 35, completionTokens: 28, totalTokens: 63 },
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("outputs localized title in mock mode when mode is title", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "生成标题" }], mode: "title" },
        "mock-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);
    expect(response.status).toBe(200);
    const deltas = events.filter((event) => event.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(deltas).toBe("日常闲聊与问候");
  });

  it("uses an explicit Step Plan key instead of the canned mock response", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const apiKey = "sk-step-plan-abcdefghijklmnopqrstuvwxyz012345";
    let upstreamRequest: Request | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      upstreamRequest = input instanceof Request ? input : new Request(input, init);
      return new Response(providerSse("这是 Step Plan 的真实流式回答"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "这次不要固定回复" }],
          provider: "stepfun",
          apiKey,
          model: "step-3.7-flash",
        },
        "mock-step-plan-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);

    expect(upstreamRequest?.url).toBe(providerUrl);
    expect(upstreamRequest?.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(events).toEqual([
      { type: "delta", text: "这是 Step Plan 的真实流式回答" },
      { type: "done", truncated: false },
    ]);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it.each(upstreamPaths)("$name：收到流响应头后仍执行上游期限", async ({ credentials }) => {
    vi.useFakeTimers();
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    let providerSignal: AbortSignal | null = null;
    providerFetch.mockImplementationOnce(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      providerSignal = providerRequest.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            upstreamController = controller;
          },
          cancel,
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "hello" }], ...credentials },
        "stream-timeout-session",
      ),
    );
    const eventsPromise = collectClientEvents(response.body!);

    await vi.advanceTimersByTimeAsync(30_000);
    const timedOut = providerSignal!.aborted === true;
    if (!timedOut) {
      upstreamController.close();
    }
    const events = await eventsPromise;
    vi.useRealTimers();

    expect(timedOut).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
  });

  describe.each(upstreamPaths)("$name：上游响应契约", ({ credentials, authError, quotaError }) => {
    it.each([
      { status: 401, expected: authError },
      { status: 403, expected: authError },
      { status: 402, expected: quotaError },
      { status: 429, expected: quotaError },
      { status: 500, expected: "PROVIDER_ERROR" },
      { status: 200, expected: "PROVIDER_ERROR" },
    ])("状态 $status 的无效响应取消正文并返回 $expected", async ({ status, expected }) => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      providerFetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
        status,
        headers: { "content-type": "application/json" },
      }));

      const response = await invoke(await chatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "你好" }],
        ...credentials,
      }, "upstream-error-session"));

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: { code: expected } });
      expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("连接失败返回统一错误并清理期限", async () => {
      vi.useFakeTimers();
      providerFetch.mockRejectedValueOnce(new TypeError("provider unavailable"));

      const response = await invoke(await chatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "你好" }],
        ...credentials,
      }, "upstream-unavailable-session"));

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: { code: "PROVIDER_UNAVAILABLE" } });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("等待响应头超过期限时中止请求并返回超时错误", async () => {
      vi.useFakeTimers();
      let notifyStarted!: () => void;
      const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
      providerFetch.mockImplementationOnce((input, init) => {
        const signal = new Request(input, init).signal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          notifyStarted();
        });
      });

      const responsePromise = invoke(await chatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "你好" }],
        ...credentials,
      }, "upstream-connect-timeout-session"));
      await started;
      await vi.advanceTimersByTimeAsync(30_000);
      const response = await responsePromise;

      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: { code: "PROVIDER_TIMEOUT" } });
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      { mode: "title", webSearch: true, maximum: 50 },
      { mode: "chat", webSearch: false, maximum: 200 },
      { mode: "summary", webSearch: false, maximum: 1000 },
      { mode: "chat", webSearch: true, maximum: 1000 },
    ])("$mode 模式、联网 $webSearch 时输出上限为 $maximum 字符", async ({ mode, webSearch, maximum }) => {
      vi.useFakeTimers();
      providerFetch.mockImplementation(async (_input, init) => isJudgeInit(init)
        ? judgeResponse("NO")
        : new Response(providerSse("🌙".repeat(1_200)), {
          headers: { "content-type": "text/event-stream" },
        }));

      const response = await invoke(await chatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "你好" }],
        ...credentials,
        mode,
        webSearch,
      }, "upstream-character-limit-session"));
      const events = await collectClientEvents(response.body!);
      const text = events.map((event) => event.type === "delta" ? event.text : "").join("");

      expect([...text]).toHaveLength(maximum);
      expect(events.at(-1)).toEqual({ type: "done", truncated: true });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("searches Bing first and streams sources before deltas when webSearch is on", async () => {
    const fetchUrls: string[] = [];
    let providerBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return judgeResponse("YES");
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      providerBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~查到啦 [1]"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气怎么样" }],
          webSearch: true,
        },
        "web-search-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    // 模型 judge YES → 必应搜索 → Top 结果页面抓取（mock 非 HTML 降级）→ 主调用
    expect(fetchUrls).toEqual([
      providerUrl,
      bingSearchUrl("上海天气"),
      "https://weather.example.cn/shanghai",
      providerUrl,
    ]);
    expect(JSON.stringify(providerBody)).toContain("<web_search_results>");
    expect(JSON.stringify(providerBody)).toContain("上海天气实况");
    expect(events[0]).toEqual({
      type: "sources",
      sources: [{ title: "上海天气实况", url: "https://weather.example.cn/shanghai" }],
    });
    expect(events[1]).toEqual({ type: "delta", text: "彩叶~查到啦 [1]" });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("runs dual-market search and injects dated sources when smartSearch is on", async () => {
    const fetchUrls: string[] = [];
    let providerBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return judgeResponse("YES");
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        if (request.url.includes("mkt=en-US")) {
          return new Response(internationalBingRss(), {
            status: 200,
            headers: { "content-type": "text/xml" },
          });
        }
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      providerBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~最新的是3.7 flash哦 [2]"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "Gemini最新模型是什么" }],
          webSearch: true,
          smartSearch: true,
        },
        "smart-search-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    // 模型 judge YES → 双路必应（本地市场 + en-US 近 30 天过滤，原文含"最新"时查询词追加当前年份）
    // → 合并 Top 结果页面抓取（mock 非 HTML 降级）→ 主调用
    const year = new Date().getUTCFullYear();
    const smartQuery = `Gemini模型 ${year}`;
    expect(fetchUrls).toEqual([
      providerUrl,
      bingSearchUrl(smartQuery),
      `https://www.bing.com/search?q=${encodeURIComponent(smartQuery)}&format=rss&mkt=en-US&setlang=en&qft=${encodeURIComponent('interval="30"')}`,
      "https://weather.example.cn/shanghai",
      "https://deepmind.google/models/gemini/flash/",
      providerUrl,
    ]);

    // prompt 注入两路合并结果，且智能模式带发布日期
    const systemContent = JSON.stringify(providerBody);
    expect(systemContent).toContain("上海天气实况");
    expect(systemContent).toContain("Gemini 3.7 Flash");
    expect(systemContent).toContain("发布于2026-08-20");
    expect(systemContent).toContain("优先采信发布日期更新");

    // sources 事件：本地路在前、国际路在后
    expect(events[0]).toEqual({
      type: "sources",
      sources: [
        { title: "上海天气实况", url: "https://weather.example.cn/shanghai" },
        { title: "Gemini 3.7 Flash", url: "https://deepmind.google/models/gemini/flash/" },
      ],
    });
    expect(events[1]).toEqual({ type: "delta", text: "彩叶~最新的是3.7 flash哦 [2]" });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("continues the conversation without sources when Bing fails", async () => {
    const fetchUrls: string[] = [];
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return judgeResponse("YES");
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response("denied", { status: 503 });
      }
      return new Response(providerSse("彩叶~我们聊聊别的吧"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气怎么样" }],
          webSearch: true,
        },
        "bing-fail-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    expect(fetchUrls).toEqual([providerUrl, bingSearchUrl("上海天气"), providerUrl]);
    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(events).toEqual([
      { type: "delta", text: "彩叶~我们聊聊别的吧" },
      { type: "done", truncated: false },
    ]);
  });

  it("skips the search when the model judge says NO", async () => {
    const fetchUrls: string[] = [];
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return judgeResponse("NO");
      }
      return new Response(providerSse("彩叶~陪你聊天"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          // 规则门控会放行（含时效词），但模型结合语境判断为闲聊陪伴 → NO
          messages: [{ role: "user", text: "今天陪我聊聊最近的烦恼吧" }],
          webSearch: true,
        },
        "judge-no-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    // 仅 judge 请求 + 主调用，无必应搜索与页面抓取
    expect(fetchUrls).toEqual([providerUrl, providerUrl]);
    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(events[0]).toEqual({ type: "delta", text: "彩叶~陪你聊天" });
  });

  it("falls back to rule gating when the judge request fails", async () => {
    const fetchUrls: string[] = [];
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return new Response("error", { status: 500 });
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      return new Response(providerSse("彩叶~查到啦"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    // judge 失败 → 回退规则门控：时效性提问仍会搜索
    const searchResponse = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气怎么样" }],
          webSearch: true,
        },
        "judge-fallback-search-session",
      ),
    );
    const searchEvents = await collectClientEvents(searchResponse.body!);
    expect(fetchUrls).toEqual([
      providerUrl,
      bingSearchUrl("上海天气"),
      "https://weather.example.cn/shanghai",
      providerUrl,
    ]);
    expect(searchEvents[0]?.type).toBe("sources");

    // judge 失败 → 回退规则门控：纯问候仍不搜索
    const chattyResponse = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "你好" }],
          webSearch: true,
        },
        "judge-fallback-skip-session",
      ),
    );
    const chattyEvents = await collectClientEvents(chattyResponse.body!);
    expect(chattyEvents.some((event) => event.type === "sources")).toBe(false);
  });

  it("skips the search step for summary mode and image-only messages", async () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const fetchUrls: string[] = [];
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      return new Response(providerSse("好的"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const summaryResponse = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [
            { role: "user", text: "你好" },
            { role: "assistant", text: "彩叶~" },
            { role: "user", text: "继续" },
          ],
          mode: "summary",
          webSearch: true,
        },
        "summary-skip-session",
      ),
    );
    const summaryEvents = await collectClientEvents(summaryResponse.body!);
    expect(summaryEvents.some((event) => event.type === "sources")).toBe(false);

    const imageResponse = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "", imageDataUrl }],
          webSearch: true,
        },
        "image-skip-session",
      ),
    );
    const imageEvents = await collectClientEvents(imageResponse.body!);

    expect(imageEvents.some((event) => event.type === "sources")).toBe(false);
    expect(fetchUrls).toEqual([providerUrl, providerUrl]);
  });

  it("relaxes the streaming cap to 1000 Unicode characters while online", async () => {
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      if (isJudgeInit(init)) {
        return judgeResponse("YES");
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      return new Response(providerSse("八".repeat(1_200)), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "讲个长故事" }],
          webSearch: true,
        },
        "online-cap-session",
      ),
    );
    const events = await collectClientEvents(response.body!);
    const text = events
      .filter((event) => event.type === "delta")
      .map((event) => (event.type === "delta" ? event.text : ""))
      .join("");

    expect([...text]).toHaveLength(1000);
    expect(events.at(-1)).toEqual({ type: "done", truncated: true });
  });

  it("injects search results into a user-key provider request as well", async () => {
    const openaiUrl = "https://api.openai.com/v1/chat/completions";
    const fetchUrls: string[] = [];
    let openaiBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return judgeResponse("YES");
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      openaiBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~帮你查过啦"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气" }],
          provider: "openai",
          apiKey: "sk-" + "a".repeat(40),
          model: "gpt-5.6-luna",
          webSearch: true,
        },
        "user-key-search-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    // judge 请求也走用户所选 provider（同端点、用户 key）
    expect(fetchUrls).toEqual([
      openaiUrl,
      bingSearchUrl("上海天气"),
      "https://weather.example.cn/shanghai",
      openaiUrl,
    ]);
    expect(JSON.stringify(openaiBody)).toContain("<web_search_results>");
    expect(events[0]?.type).toBe("sources");
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("routes non-whitelisted models to a custom base URL including the judge request", async () => {
    const customBase = "https://ark.cn-beijing.volces.com/api/v3";
    const customUrl = `${customBase}/chat/completions`;
    const apiKey = "sk-" + "a".repeat(40);
    const fetchUrls: string[] = [];
    let upstreamBody: Record<string, unknown> | undefined;
    let upstreamAuth: string | null | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (isJudgeInit(init)) {
        return judgeResponse("YES");
      }
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      upstreamAuth = request.headers.get("authorization");
      upstreamBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~火山引擎的回答"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气" }],
          provider: "openai",
          apiKey,
          model: "doubao-pro-32k",
          baseUrl: customBase,
          webSearch: true,
        },
        "custom-baseurl-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    // 主调用与 judge 均命中自定义端点，模型名不再受白名单约束
    expect(fetchUrls).toEqual([
      customUrl,
      bingSearchUrl("上海天气"),
      "https://weather.example.cn/shanghai",
      customUrl,
    ]);
    expect(upstreamBody).toMatchObject({ model: "doubao-pro-32k" });
    expect(upstreamAuth).toBe(`Bearer ${apiKey}`);
    expect(events[0]?.type).toBe("sources");
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("routes a custom model in Anthropic Messages format to the completed endpoint", async () => {
    const apiKey = "sk-" + "a".repeat(40);
    let upstreamUrl: string | undefined;
    let upstreamHeaders: Headers | undefined;
    let upstreamBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      const request = await toRequest(input, init);
      upstreamUrl = request.url;
      upstreamHeaders = request.headers;
      upstreamBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      const sse = [
        { type: "message_start", message: { usage: { input_tokens: 12 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "彩叶~" } },
        { type: "message_delta", usage: { output_tokens: 3 } },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "你好" }],
          mode: "title",
          provider: "openai",
          apiKey,
          model: "my-claude",
          baseUrl: "https://relay.example.com/v1",
          customModel: { apiFormat: "anthropic_messages", maxOutputTokens: 600, temperature: 0.5 },
        },
        "custom-anthropic-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    expect(upstreamUrl).toBe("https://relay.example.com/v1/messages");
    expect(upstreamHeaders?.get("x-api-key")).toBe(apiKey);
    expect(upstreamHeaders?.get("anthropic-version")).toBe("2023-06-01");
    expect(upstreamBody).toMatchObject({ model: "my-claude", max_tokens: 600, temperature: 0.5, stream: true });
    expect(events).toContainEqual({ type: "delta", text: "彩叶~" });
  });

  it("rejects custom model options without a custom base URL", async () => {
    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "你好" }],
          provider: "openai",
          apiKey: "sk-" + "a".repeat(40),
          model: "gpt-6-luna",
          customModel: { apiFormat: "responses" },
        },
        "custom-without-base-session",
      ),
    );

    expect(response.status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects a custom base URL for providers without an OpenAI-compatible adapter", async () => {
    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "你好" }],
          provider: "claude",
          apiKey: "sk-ant-" + "a".repeat(40),
          model: "claude-sonnet-5",
          baseUrl: "https://example.com/v1",
        },
        "claude-baseurl-session",
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("prepends two fixed mock sources in mock mode with webSearch", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "你好" }],
          webSearch: true,
        },
        "mock-sources-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);

    expect(events[0]).toEqual({
      type: "sources",
      sources: [
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: "done",
      truncated: false,
      usage: { promptTokens: 35, completionTokens: 28, totalTokens: 63 },
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
