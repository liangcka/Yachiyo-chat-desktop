import { describe, expect, it } from "vitest";
import {
  buildCustomModelAdapter,
  chatThinkingPatch,
  customMaxTokens,
  extractResponsesDeltaText,
  extractResponsesJudgeText,
  resolveCustomEndpoint,
} from "../../../functions/_shared/providers/custom-model";
import type { ClientChatRequest, CustomModelOptions } from "../../../functions/_shared/validation";

const apiKey = "sk-" + "a".repeat(40);
const baseUrl = "https://relay.example.com/v1";

const chatRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

function build(options: CustomModelOptions, request: ClientChatRequest = chatRequest) {
  const built = buildCustomModelAdapter("openai", options).buildRequest({
    request,
    apiKey,
    model: "my-model",
    baseUrl,
  });
  return { ...built, json: JSON.parse(built.body) as Record<string, unknown> };
}

describe("resolveCustomEndpoint", () => {
  it("appends the protocol path unless the full URL switch is on", () => {
    expect(resolveCustomEndpoint(`${baseUrl}/`, { apiFormat: "chat_completions" })).toBe(`${baseUrl}/chat/completions`);
    expect(resolveCustomEndpoint(baseUrl, { apiFormat: "responses" })).toBe(`${baseUrl}/responses`);
    expect(resolveCustomEndpoint(baseUrl, { apiFormat: "anthropic_messages" })).toBe(`${baseUrl}/messages`);
    expect(resolveCustomEndpoint(`${baseUrl}/gateway/chat`, { apiFormat: "responses", fullUrl: true })).toBe(
      `${baseUrl}/gateway/chat`,
    );
  });
});

describe("customMaxTokens", () => {
  it("uses protocol defaults and caps auxiliary budgets by the user limit", () => {
    expect(customMaxTokens("chat_completions", undefined, { apiFormat: "chat_completions" })).toBe(8192);
    expect(customMaxTokens("anthropic_messages", undefined, { apiFormat: "anthropic_messages" })).toBe(16000);
    expect(customMaxTokens("responses", "title", { apiFormat: "responses" })).toBe(512);
    expect(customMaxTokens("chat_completions", "chat", { apiFormat: "chat_completions", maxOutputTokens: 32_768 })).toBe(32_768);
    expect(customMaxTokens("chat_completions", "summary", { apiFormat: "chat_completions", maxOutputTokens: 32_768 })).toBe(4096);
    expect(customMaxTokens("chat_completions", "summary", { apiFormat: "chat_completions", maxOutputTokens: 1000 })).toBe(1000);
  });
});

describe("chatThinkingPatch", () => {
  it("writes the thinking switch in each family's dialect", () => {
    expect(chatThinkingPatch(undefined, "on")).toEqual({ thinking: { type: "enabled" } });
    expect(chatThinkingPatch("deepseek", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(chatThinkingPatch("gpt", "off")).toEqual({ reasoning_effort: "none" });
    expect(chatThinkingPatch("qwen", "on")).toEqual({ enable_thinking: true });
    expect(chatThinkingPatch("minimax", "on")).toEqual({});
  });
});

describe("buildCustomModelAdapter", () => {
  it("builds a Chat Completions body with budget, sampling and thinking overrides", () => {
    const { url, headers, json } = build({
      apiFormat: "chat_completions",
      maxOutputTokens: 2048,
      thinking: "off",
      temperature: 0.3,
      topP: 0.8,
      topK: 20,
    });

    expect(url).toBe(`${baseUrl}/chat/completions`);
    expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    expect(json).toMatchObject({
      model: "my-model",
      stream: true,
      max_tokens: 2048,
      thinking: { type: "disabled" },
      temperature: 0.3,
      top_p: 0.8,
      top_k: 20,
    });
  });

  it("applies the selected family's vendor rules and drops conflicting effort when thinking is off", () => {
    const qwenBody = (thinking?: "on" | "off") =>
      JSON.parse(
        buildCustomModelAdapter("openai", {
          apiFormat: "chat_completions",
          family: "qwen",
          ...(thinking !== undefined ? { thinking } : {}),
        }).buildRequest({ request: chatRequest, apiKey, model: "qwen3.8-max", baseUrl }).body,
      ) as Record<string, unknown>;
    // 端点主机名无法识别时，按所选系列套用千问规则
    expect(qwenBody().reasoning_effort).toBe("low");
    const off = qwenBody("off");
    expect(off.enable_thinking).toBe(false);
    expect(off.reasoning_effort).toBeUndefined();

    const gpt = build({ apiFormat: "chat_completions", family: "gpt", thinking: "on" }).json;
    expect(gpt.max_completion_tokens).toBe(8192);
    expect(gpt.max_tokens).toBeUndefined();
    expect(gpt.reasoning_effort).toBe("medium");
  });

  it("keeps the auxiliary budget free of forced thinking", () => {
    const title = build({ apiFormat: "chat_completions", thinking: "on" }, { ...chatRequest, mode: "title" }).json;
    expect(title.thinking).toBeUndefined();
    expect(title.max_tokens).toBe(512);
  });

  it("builds an Anthropic Messages body with budget_tokens thinking", () => {
    const { url, headers, json } = build({
      apiFormat: "anthropic_messages",
      maxOutputTokens: 8000,
      thinking: "on",
      temperature: 0.5,
      topP: 0.95,
      topK: 10,
    });

    expect(url).toBe(`${baseUrl}/messages`);
    expect(headers["x-api-key"]).toBe(apiKey);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.authorization).toBeUndefined();
    expect(json).toMatchObject({
      model: "my-model",
      max_tokens: 8000,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 4000 },
      top_p: 0.95,
    });
    // 开启思考时上游不接受修改 temperature 与 top_k
    expect(json.temperature).toBeUndefined();
    expect(json.top_k).toBeUndefined();
    expect(json.messages).toEqual([{ role: "user", content: "今天有点累" }]);

    const off = build({ apiFormat: "anthropic_messages", thinking: "off", temperature: 0.5 }).json;
    expect(off).toMatchObject({ thinking: { type: "disabled" }, temperature: 0.5, max_tokens: 16000 });
  });

  it("builds a Responses body with instructions, input items and reasoning", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const { url, json } = build(
      { apiFormat: "responses", fullUrl: true, thinking: "on", topK: 5, topP: 0.5 },
      { locale: "zh-CN", messages: [{ role: "user", text: "", imageDataUrl: image }] },
    );

    expect(url).toBe(baseUrl);
    expect(typeof json.instructions).toBe("string");
    expect(json).toMatchObject({
      store: false,
      stream: true,
      max_output_tokens: 8192,
      reasoning: { effort: "medium", summary: "auto" },
      top_p: 0.5,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "请看看这张图片。" },
            { type: "input_image", image_url: image },
          ],
        },
      ],
    });
    expect(json.top_k).toBeUndefined();
  });

  it("builds judge requests in the selected protocol", () => {
    const judge = buildCustomModelAdapter("openai", { apiFormat: "responses", thinking: "off" }).buildJudgeRequest({
      apiKey,
      model: "my-model",
      baseUrl,
      systemPrompt: "judge",
      messages: [{ role: "user", text: "天气" }],
    });
    expect(judge.url).toBe(`${baseUrl}/responses`);
    expect(JSON.parse(judge.body)).toMatchObject({
      instructions: "judge",
      stream: false,
      max_output_tokens: 512,
      reasoning: { effort: "none" },
    });
  });
});

describe("extractResponsesDeltaText", () => {
  it("maps text, reasoning summary and usage events", () => {
    expect(extractResponsesDeltaText(JSON.stringify({ type: "response.output_text.delta", delta: "你好" }))).toEqual({
      content: "你好",
    });
    expect(
      extractResponsesDeltaText(JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "想想" })),
    ).toEqual({ thought: "想想" });
    expect(
      extractResponsesDeltaText(
        JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
        }),
      ),
    ).toEqual({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    expect(extractResponsesDeltaText(JSON.stringify({ type: "response.created" }))).toBeNull();
  });

  it("treats failure events and malformed data as stream errors", () => {
    expect(() => extractResponsesDeltaText(JSON.stringify({ type: "response.failed" }))).toThrow(TypeError);
    expect(() => extractResponsesDeltaText("{oops")).toThrow(TypeError);
  });
});

describe("extractResponsesJudgeText", () => {
  it("joins output_text parts from message items", () => {
    const json = JSON.stringify({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "YES" }] },
      ],
    });
    expect(extractResponsesJudgeText(json)).toBe("YES");
    expect(extractResponsesJudgeText(JSON.stringify({ output: [] }))).toBeNull();
  });
});
