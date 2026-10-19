import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import type { EnrichedChatRequest } from "../../../functions/_shared/web-search";
import {
  buildOpenAICompatAdapter,
  buildOpenAICompatBody,
  createOpenAIDeltaExtractor,
  createThinkTagSplitter,
  extractOpenAIDeltaText,
  extractOpenAIJudgeText,
} from "../../../functions/_shared/providers/openai-compat";

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildOpenAICompatBody", () => {
  it("maps history to OpenAI chat completions format with system prompt", () => {
    const body = buildOpenAICompatBody(textRequest, "gpt-5.6-luna", { supportsImage: true }) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      stream: boolean;
      max_tokens: number;
      reasoning_effort?: string;
    };

    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(8192);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.messages[0]?.role).toBe("system");
    expect(typeof body.messages[0]?.content).toBe("string");
    expect(body.messages.slice(1)).toEqual([
      { role: "assistant", content: "彩叶~" },
      { role: "user", content: "今天有点累" },
    ]);
  });

  it("sets reasoning_effort low for reasoning-capable providers and lifts it for images", () => {
    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const textBody = buildOpenAICompatBody(textRequest, "step-3.7-flash", { supportsImage: true, reasoningEffort: true }) as {
      reasoning_effort?: string;
    };
    expect(textBody.reasoning_effort).toBe("low");

    const imageRequest: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl }],
    };
    const imageBody = buildOpenAICompatBody(imageRequest, "step-3.7-flash", { supportsImage: true, reasoningEffort: true }) as {
      reasoning_effort?: string;
    };
    expect(imageBody.reasoning_effort).toBe("medium");
  });

  it("keeps a smaller token budget for summary mode", () => {
    const body = buildOpenAICompatBody({ ...textRequest, mode: "summary" }, "gpt-5.6-luna", { supportsImage: true }) as {
      max_tokens: number;
    };
    expect(body.max_tokens).toBe(4096);
  });

  it("emits image content parts when the provider supports images", () => {
    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const request: ClientChatRequest = {
      locale: "ja-JP",
      messages: [{ role: "user", text: "これは何？", imageDataUrl }],
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", { supportsImage: true }) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "これは何？" },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    });
  });

  it("drops the image part when the provider does not support images", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
    };
    const body = buildOpenAICompatBody(request, "deepseek-flash", { supportsImage: false }) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[1]).toEqual({ role: "user", content: "看图" });
  });

  it("injects web search results and the 1000-character rule into the system prompt", () => {
    const request: EnrichedChatRequest = {
      ...textRequest,
      webSearch: true,
      searchResults: [
        { title: "上海天气", url: "https://weather.example.cn/", snippet: "今日多云，24至30度。" },
      ],
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", { supportsImage: true }) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? "";

    expect(system).toContain("<web_search_results>");
    expect(system).toContain("[1] 上海天气（https://weather.example.cn/）");
    expect(system).toContain("今日多云，24至30度。");
    expect(system).toContain("输出最多1000个Unicode字符");
    expect(system).not.toContain("最多200个Unicode字符");
  });

  it("passes currentTime to the system prompt", () => {
    const request: ClientChatRequest = {
      ...textRequest,
      currentTime: "2026-08-27 11:09:37 星期四",
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", { supportsImage: true }) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? "";
    expect(system).toContain("当前现实时间：2026-08-27 11:09:37 星期四");
  });
});

describe("extractOpenAIDeltaText", () => {
  it("reads content from OpenAI-style delta events", () => {
    const data = JSON.stringify({ choices: [{ delta: { content: "彩叶" } }] });
    expect(extractOpenAIDeltaText(data)).toEqual({ content: "彩叶", thought: null });
  });

  it("reads reasoning_content as thought", () => {
    const data = JSON.stringify({ choices: [{ delta: { reasoning_content: "思考细节..." } }] });
    expect(extractOpenAIDeltaText(data)).toEqual({ content: null, thought: "思考细节..." });
  });

  it("reads usage metadata when present in chunk", () => {
    const data = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
    });
    expect(extractOpenAIDeltaText(data)).toEqual({
      usage: { promptTokens: 42, completionTokens: 18, totalTokens: 60 },
    });
  });

  it("returns null for [DONE] and empty content", () => {
    expect(extractOpenAIDeltaText("[DONE]")).toBeNull();
    const empty = JSON.stringify({ choices: [{ delta: { content: "" } }] });
    expect(extractOpenAIDeltaText(empty)).toBeNull();
  });

  it("returns null when choices and usage are absent", () => {
    const noChoices = JSON.stringify({ choices: [] });
    expect(extractOpenAIDeltaText(noChoices)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractOpenAIDeltaText("not-json")).toThrow(TypeError);
    expect(() => extractOpenAIDeltaText(JSON.stringify({ error: "x" }))).toThrow(TypeError);
  });
});

describe("buildOpenAICompatAdapter", () => {
  const adapter = buildOpenAICompatAdapter("openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.6-luna",
    allowedModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
    supportsImage: true,
    imageModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
  });

  it("exposes the provider metadata", () => {
    expect(adapter.id).toBe("openai");
    expect(adapter.isOpenAICompat).toBe(true);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.imageModels).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
    expect(adapter.defaultModel).toBe("gpt-5.6-luna");
    expect(adapter.allowedModels).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
  });

  it("builds a Bearer-authenticated streaming request", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "a".repeat(40),
      model: "gpt-5.6-luna",
    });

    expect(built.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(built.headers.authorization).toMatch(/^Bearer sk-/u);
    expect(built.headers.accept).toBe("text/event-stream");
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { model: string; stream: boolean };
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.stream).toBe(true);
  });

  it("overrides the endpoint with a custom base URL for both request kinds", () => {
    const baseUrl = "https://ark.cn-beijing.volces.com/api/v3";
    const apiKey = "sk-" + "a".repeat(40);

    const streamBuilt = adapter.buildRequest({
      request: textRequest,
      apiKey,
      model: "doubao-pro-32k",
      baseUrl,
    });
    expect(streamBuilt.url).toBe(`${baseUrl}/chat/completions`);
    expect(JSON.parse(streamBuilt.body) as Record<string, unknown>).toMatchObject({
      model: "doubao-pro-32k",
    });

    const judgeBuilt = adapter.buildJudgeRequest({
      apiKey,
      model: "doubao-pro-32k",
      baseUrl,
      systemPrompt: "judge",
      messages: [{ role: "user", text: "上海天气" }],
    });
    expect(judgeBuilt.url).toBe(`${baseUrl}/chat/completions`);
  });

  it("strips trailing slashes from a custom base URL", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "a".repeat(40),
      model: "gpt-5.6-luna",
      baseUrl: "https://api.siliconflow.cn/v1/",
    });

    expect(built.url).toBe("https://api.siliconflow.cn/v1/chat/completions");
  });
});

describe("DeepSeek thinking toggle", () => {
  const apiKey = "sk-" + "a".repeat(40);
  const deepseek = buildOpenAICompatAdapter("deepseek", {
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-v4-flash",
    allowedModels: ["deepseek-v4-flash"],
    supportsImage: false,
    imageModels: [],
    deepseekThinking: true,
  });
  const thinkingOf = (body: string) => (JSON.parse(body) as { thinking?: unknown }).thinking;

  it("disables thinking for title, summary and judge requests", () => {
    for (const mode of ["title", "summary"] as const) {
      const built = deepseek.buildRequest({
        request: { ...textRequest, mode },
        apiKey,
        model: "deepseek-v4-flash",
      });
      expect(thinkingOf(built.body)).toEqual({ type: "disabled" });
    }
    const judge = deepseek.buildJudgeRequest({
      apiKey,
      model: "deepseek-v4-flash",
      systemPrompt: "judge",
      messages: [{ role: "user", text: "上海天气" }],
    });
    expect(thinkingOf(judge.body)).toEqual({ type: "disabled" });
  });

  it("keeps the provider default thinking for chat requests", () => {
    const built = deepseek.buildRequest({ request: textRequest, apiKey, model: "deepseek-v4-flash" });
    expect(thinkingOf(built.body)).toBeUndefined();
  });

  it("leaves other providers untouched", () => {
    const body = buildOpenAICompatBody({ ...textRequest, mode: "title" }, "step-3.7-flash", { supportsImage: true, reasoningEffort: true }) as {
      thinking?: unknown;
    };
    expect(body.thinking).toBeUndefined();
  });
});

describe("OpenAI official endpoint rules", () => {
  const apiKey = "sk-" + "a".repeat(40);
  const openai = buildOpenAICompatAdapter("openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-6-luna",
    allowedModels: ["gpt-6-luna", "gpt-4.1"],
    supportsImage: true,
    imageModels: ["gpt-6-luna", "gpt-4.1"],
    openaiOfficialRules: true,
  });
  const parse = (body: string) => JSON.parse(body) as Record<string, unknown>;

  it("uses max_completion_tokens and low reasoning effort for GPT-6 on the official endpoint", () => {
    const body = parse(openai.buildRequest({ request: textRequest, apiKey, model: "gpt-6-luna" }).body);
    expect(body.max_completion_tokens).toBe(8192);
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBe("low");

    const judge = parse(
      openai.buildJudgeRequest({
        apiKey,
        model: "gpt-6-luna",
        systemPrompt: "judge",
        messages: [{ role: "user", text: "上海天气" }],
      }).body,
    );
    expect(judge.max_completion_tokens).toBe(512);
    expect(judge.max_tokens).toBeUndefined();
    expect(judge.reasoning_effort).toBe("low");
  });

  it("omits reasoning_effort for non-reasoning models", () => {
    const body = parse(openai.buildRequest({ request: textRequest, apiKey, model: "gpt-4.1" }).body);
    expect(body.max_completion_tokens).toBe(8192);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("keeps the generic max_tokens body for custom base URLs", () => {
    const body = parse(
      openai.buildRequest({
        request: textRequest,
        apiKey,
        model: "gpt-6-luna",
        baseUrl: "https://openrouter.ai/api/v1",
      }).body,
    );
    expect(body.max_tokens).toBe(8192);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe("third-party vendor rules on custom base URLs", () => {
  const apiKey = "sk-" + "a".repeat(40);
  const openai = buildOpenAICompatAdapter("openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-6-luna",
    allowedModels: ["gpt-6-luna"],
    supportsImage: true,
    imageModels: ["gpt-6-luna"],
    openaiOfficialRules: true,
  });
  const parse = (body: string) => JSON.parse(body) as Record<string, unknown>;

  it("applies the vendor patch to chat, auxiliary and judge requests", () => {
    const baseUrl = "https://api.moonshot.cn/v1";
    const chat = parse(openai.buildRequest({ request: textRequest, apiKey, model: "kimi-k2.6", baseUrl }).body);
    expect(chat.thinking).toBeUndefined();
    const title = parse(
      openai.buildRequest({ request: { ...textRequest, mode: "title" }, apiKey, model: "kimi-k2.6", baseUrl }).body,
    );
    expect(title.thinking).toEqual({ type: "disabled" });
    const judge = parse(
      openai.buildJudgeRequest({
        apiKey,
        model: "kimi-k3",
        baseUrl,
        systemPrompt: "judge",
        messages: [{ role: "user", text: "上海天气" }],
      }).body,
    );
    expect(judge.reasoning_effort).toBe("low");
    expect(judge.thinking).toBeUndefined();
  });

  it("does not leak vendor rules onto unrelated endpoints", () => {
    const body = parse(openai.buildRequest({ request: textRequest, apiKey, model: "kimi-k3" }).body);
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe("createOpenAIDeltaExtractor", () => {
  const chunk = (delta: Record<string, unknown>) => JSON.stringify({ choices: [{ index: 0, delta }] });

  it("turns cumulative reasoning_details snapshots into increments", () => {
    const extract = createOpenAIDeltaExtractor();
    const detail = (text: string) => ({ reasoning_details: [{ type: "reasoning.text", text }] });
    expect(extract(chunk(detail("先想")))).toEqual({ content: null, thought: "先想" });
    expect(extract(chunk(detail("先想一想")))).toEqual({ content: null, thought: "一想" });
  });

  it("appends incremental reasoning_details and prefers reasoning_content when both arrive", () => {
    const extract = createOpenAIDeltaExtractor();
    expect(extract(chunk({ reasoning_details: [{ text: "甲" }] }))).toEqual({ content: null, thought: "甲" });
    expect(extract(chunk({ reasoning_details: [{ text: "乙" }] }))).toEqual({ content: null, thought: "乙" });
    expect(extract(chunk({ reasoning_content: "丙", reasoning_details: [{ text: "甲乙丙" }] }))).toEqual({
      content: null,
      thought: "丙",
    });
  });

  it("moves a leading think block out of content even when tags are split across chunks", () => {
    const extract = createOpenAIDeltaExtractor();
    expect(extract(chunk({ content: "<thi" }))).toBeNull();
    expect(extract(chunk({ content: "nk>用户在问" }))).toEqual({ content: null, thought: "用户在问" });
    expect(extract(chunk({ content: "候。</th" }))).toEqual({ content: null, thought: "候。" });
    expect(extract(chunk({ content: "ink>\n\n你好" }))).toEqual({ content: "你好", thought: null });
    expect(extract(chunk({ content: "<think>不是思考" }))).toEqual({ content: "<think>不是思考", thought: null });
  });

  it("drops a stray closing tag at the start of content", () => {
    const split = createThinkTagSplitter();
    expect(split("</think>")).toEqual({ content: "", thought: "" });
    expect(split("\n答案")).toEqual({ content: "答案", thought: "" });
  });

  it("passes ordinary content through untouched", () => {
    const extract = createOpenAIDeltaExtractor();
    expect(extract(chunk({ content: "<b>你好</b>" }))).toEqual({ content: "<b>你好</b>", thought: null });
  });
});

describe("extractOpenAIJudgeText", () => {
  it("strips a leading think block before the verdict", () => {
    const response = JSON.stringify({ choices: [{ message: { content: "<think>看看</think>\nYES" } }] });
    expect(extractOpenAIJudgeText(response)).toBe("YES");
  });
});
