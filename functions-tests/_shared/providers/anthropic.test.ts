import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import type { EnrichedChatRequest } from "../../../functions/_shared/web-search";
import {
  buildAnthropicAdapter,
  buildAnthropicBody,
  buildAnthropicSystem,
  extractAnthropicDeltaText,
} from "../../../functions/_shared/providers/anthropic";

type SystemField = string | Array<{ type: string; text: string; cache_control?: unknown }>;

function systemText(system: SystemField): string {
  return typeof system === "string" ? system : system.map((block) => block.text).join("");
}

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildAnthropicBody", () => {
  it("drops leading assistant message so history starts with user and lifts system prompt", () => {
    const body = buildAnthropicBody(textRequest, "claude-sonnet-5") as {
      model: string;
      system: SystemField;
      messages: Array<{ role: string; content: unknown }>;
      stream: boolean;
      max_tokens: number;
    };

    expect(body.model).toBe("claude-sonnet-5");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(16000);
    expect(systemText(body.system)).toContain("月见八千代");
    expect(body.messages).toEqual([
      { role: "user", content: "今天有点累" },
    ]);
  });

  it("merges adjacent same-role messages to enforce strict user/assistant alternation", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "user", text: "前情提要记忆" },
        { role: "assistant", text: "已记住记忆" },
        { role: "assistant", text: "彩叶~" },
        { role: "user", text: "第一句" },
        { role: "user", text: "第二句" },
      ],
    };
    const body = buildAnthropicBody(request, "claude-sonnet-5") as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages).toEqual([
      { role: "user", content: "前情提要记忆" },
      { role: "assistant", content: "已记住记忆\n\n彩叶~" },
      { role: "user", content: "第一句\n\n第二句" },
    ]);
  });

  it("maps image data URLs into Anthropic image blocks and merges image blocks for adjacent user turns", () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "user", text: "看图", imageDataUrl },
        { role: "user", text: "好看吗？" },
      ],
    };
    const body = buildAnthropicBody(request, "claude-sonnet-5") as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看图" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
        { type: "text", text: "好看吗？" },
      ],
    });
  });

  it("injects web search results and the 1000-character rule into the system prompt", () => {
    const request: EnrichedChatRequest = {
      ...textRequest,
      webSearch: true,
      searchResults: [
        { title: "上海天气", url: "https://weather.example.cn/", snippet: "今日多云，24至30度。" },
      ],
    };
    const body = buildAnthropicBody(request, "claude-sonnet-5") as { system: SystemField };
    const system = systemText(body.system);

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
    const body = buildAnthropicBody(request, "claude-sonnet-5") as { system: SystemField };
    expect(systemText(body.system)).toContain("当前现实时间：2026-08-27 11:09:37 星期四");
  });

  it("caches the stable role prompt ahead of the per-request runtime section", () => {
    const body = buildAnthropicBody(
      { ...textRequest, currentTime: "2026-10-19 09:00:00 星期一" },
      "claude-sonnet-5-5",
    ) as { system: SystemField };
    expect(Array.isArray(body.system)).toBe(true);
    const [stable, runtime] = body.system as Array<{ text: string; cache_control?: unknown }>;
    expect(stable?.cache_control).toEqual({ type: "ephemeral" });
    expect(stable?.text).toContain("月见八千代");
    expect(stable?.text).not.toContain("当前现实时间");
    expect(runtime?.cache_control).toBeUndefined();
    expect(runtime?.text.startsWith("<runtime>")).toBe(true);
    expect(runtime?.text).toContain("当前现实时间：2026-10-19 09:00:00 星期一");
  });

  it("keeps short prompts without a runtime section as plain strings", () => {
    expect(buildAnthropicSystem("只输出标题")).toBe("只输出标题");
    const title = buildAnthropicBody({ ...textRequest, mode: "title" }, "claude-sonnet-5-5") as {
      system: SystemField;
    };
    expect(typeof title.system).toBe("string");
  });

  it("requests low-effort adaptive thinking with summarized display for chat", () => {
    const body = buildAnthropicBody(textRequest, "claude-opus-5-5") as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("sizes auxiliary budgets for thinking and skips the thinking summary", () => {
    const title = buildAnthropicBody({ ...textRequest, mode: "title" }, "claude-sonnet-5-5") as Record<string, unknown>;
    const summary = buildAnthropicBody({ ...textRequest, mode: "summary" }, "claude-sonnet-5-5") as Record<string, unknown>;
    expect(title.max_tokens).toBe(1024);
    expect(summary.max_tokens).toBe(4096);
    expect(title.thinking).toEqual({ type: "adaptive" });
    expect(summary.output_config).toEqual({ effort: "low" });
  });

  it("omits adaptive thinking and effort for Haiku 4.5", () => {
    const body = buildAnthropicBody(textRequest, "claude-haiku-4-5") as Record<string, unknown>;
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it("enables server-side refusal fallback only on supported models", () => {
    const opus = buildAnthropicBody(textRequest, "claude-opus-5-5") as Record<string, unknown>;
    const haiku = buildAnthropicBody(textRequest, "claude-haiku-5-5") as Record<string, unknown>;
    expect(opus.fallbacks).toBe("default");
    expect(haiku.fallbacks).toBeUndefined();
  });
});

describe("extractAnthropicDeltaText", () => {
  it("reads text from content_block_delta events", () => {
    const data = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "彩叶" },
    });
    expect(extractAnthropicDeltaText(data)).toEqual({ content: "彩叶" });
  });

  it("reads thinking from thinking_delta events", () => {
    const data = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "思考过程..." },
    });
    expect(extractAnthropicDeltaText(data)).toEqual({ thought: "思考过程..." });
  });

  it("reads input tokens from message_start events", () => {
    const start = JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 30 } },
    });
    expect(extractAnthropicDeltaText(start)).toEqual({ usage: { promptTokens: 30 } });
  });

  it("counts cache writes and reads into prompt tokens", () => {
    const start = JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 30, cache_creation_input_tokens: 100, cache_read_input_tokens: 15000 } },
    });
    expect(extractAnthropicDeltaText(start)).toEqual({ usage: { promptTokens: 15130 } });
  });

  it("reads output tokens from message_delta events", () => {
    const delta = JSON.stringify({
      type: "message_delta",
      usage: { output_tokens: 25 },
    });
    expect(extractAnthropicDeltaText(delta)).toEqual({ usage: { completionTokens: 25 } });
  });

  it("returns null for unknown events and [DONE]", () => {
    expect(extractAnthropicDeltaText("[DONE]")).toBeNull();
    const ping = JSON.stringify({ type: "ping" });
    expect(extractAnthropicDeltaText(ping)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractAnthropicDeltaText("not-json")).toThrow(TypeError);
  });
});

describe("buildAnthropicAdapter", () => {
  const adapter = buildAnthropicAdapter();

  it("exposes the claude provider metadata", () => {
    expect(adapter.id).toBe("claude");
    expect(adapter.isOpenAICompat).toBe(false);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.defaultModel).toBe("claude-sonnet-5-5");
    expect(adapter.allowedModels).toContain("claude-opus-5");
  });

  it("builds an x-api-key authenticated request with anthropic-version", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-ant-" + "a".repeat(40),
      model: "claude-sonnet-5",
    });

    expect(built.url).toBe("https://api.anthropic.com/v1/messages");
    expect(built.headers["x-api-key"]).toMatch(/^sk-ant-/u);
    expect(built.headers["anthropic-version"]).toBe("2023-06-01");
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { model: string; stream: boolean; system: SystemField };
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.stream).toBe(true);
    expect(systemText(body.system)).toContain("月见八千代");
    expect(built.headers["anthropic-beta"]).toBeUndefined();
  });

  it("sends the server-side fallback beta header for fallback-capable models", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-ant-" + "a".repeat(40),
      model: "claude-sonnet-5-5",
    });
    expect(built.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
  });

  it("gives the judge request room for low-effort thinking without fallbacks", () => {
    const built = adapter.buildJudgeRequest({
      apiKey: "sk-ant-" + "a".repeat(40),
      model: "claude-opus-5-5",
      systemPrompt: "judge",
      messages: [{ role: "user", text: "上海天气" }],
    });
    const body = JSON.parse(built.body) as Record<string, unknown>;
    expect(body.max_tokens).toBe(1024);
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.fallbacks).toBeUndefined();
    expect(built.headers["anthropic-beta"]).toBeUndefined();
  });
});
