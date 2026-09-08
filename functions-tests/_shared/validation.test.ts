import { describe, expect, it } from "vitest";
import { ChatValidationError, validateChatRequest } from "../../functions/_shared/validation";

const smallPng = "data:image/png;base64,iVBORw0KGgo=";

function validRequest(): unknown {
  return {
    locale: "zh-CN",
    messages: [
      { role: "assistant", text: "彩叶~今天也辛苦啦！" },
      { role: "user", text: "陪我聊一会儿吧" },
    ],
  };
}

describe("validateChatRequest", () => {
  it("accepts bounded text and one image on the last user message", () => {
    const result = validateChatRequest({
      locale: "ja-JP",
      messages: [{ role: "user", text: "", imageDataUrl: smallPng }],
    });

    expect(result).toEqual({
      locale: "ja-JP",
      messages: [{ role: "user", text: "", imageDataUrl: smallPng }],
    });
  });

  it("rejects unknown fields at every input level", () => {
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), debug: true }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "你好", hidden: "value" }],
      }),
    ).toThrow(ChatValidationError);
  });

  it("accepts an optional boolean webSearch flag on both return paths", () => {
    expect(
      validateChatRequest({ ...(validRequest() as object), webSearch: true }),
    ).toMatchObject({ webSearch: true });
    expect(
      validateChatRequest({ ...(validRequest() as object), webSearch: false }),
    ).toMatchObject({ webSearch: false });
    expect(validateChatRequest(validRequest())).not.toHaveProperty("webSearch");

    expect(
      validateChatRequest({
        ...(validRequest() as object),
        provider: "openai",
        apiKey: "sk-" + "a".repeat(40),
        model: "gpt-5.6-luna",
        webSearch: true,
      }),
    ).toMatchObject({ webSearch: true });
  });

  it("rejects a non-boolean webSearch and the server-only searchResults field", () => {
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), webSearch: "yes" }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), webSearch: 1 }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        ...(validRequest() as object),
        searchResults: [{ title: "t", url: "https://example.com/", snippet: "s" }],
      }),
    ).toThrow(ChatValidationError);
  });

  it("accepts a valid baseUrl on the user-key path and echoes it back", () => {
    const request = {
      ...(validRequest() as object),
      provider: "openai",
      apiKey: "sk-" + "a".repeat(40),
      model: "doubao-pro-32k",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    };

    expect(validateChatRequest(request)).toMatchObject({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    // 不带 baseUrl 时不产生该键
    const withoutBaseUrl = { ...request, baseUrl: undefined };
    expect(validateChatRequest(withoutBaseUrl)).not.toHaveProperty("baseUrl");
  });

  it("rejects insecure, malformed, and oversized baseUrl values", () => {
    const base = {
      ...(validRequest() as object),
      provider: "openai",
      apiKey: "sk-" + "a".repeat(40),
      model: "gpt-5.6-luna",
    };

    expect(() => validateChatRequest({ ...base, baseUrl: "http://api.example.com/v1" })).toThrow(
      ChatValidationError,
    );
    expect(() => validateChatRequest({ ...base, baseUrl: "https://a b.example.com/" })).toThrow(
      ChatValidationError,
    );
    expect(() => validateChatRequest({ ...base, baseUrl: "" })).toThrow(ChatValidationError);
    expect(() => validateChatRequest({ ...base, baseUrl: "https://" + "a".repeat(2100) })).toThrow(
      ChatValidationError,
    );
    expect(() => validateChatRequest({ ...base, baseUrl: 42 })).toThrow(ChatValidationError);
  });

  it("accepts an optional boolean smartSearch flag on both return paths", () => {
    expect(
      validateChatRequest({ ...(validRequest() as object), smartSearch: true }),
    ).toMatchObject({ smartSearch: true });
    expect(validateChatRequest(validRequest())).not.toHaveProperty("smartSearch");

    expect(
      validateChatRequest({
        ...(validRequest() as object),
        provider: "openai",
        apiKey: "sk-" + "a".repeat(40),
        model: "gpt-5.6-luna",
        webSearch: true,
        smartSearch: true,
      }),
    ).toMatchObject({ smartSearch: true });

    expect(() =>
      validateChatRequest({ ...(validRequest() as object), smartSearch: "on" }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), smartSearch: 1 }),
    ).toThrow(ChatValidationError);
  });

  it("enforces message, per-message, and total Unicode bounds", () => {
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: Array.from({ length: 21 }, (_, index) => ({
          role: index === 20 ? "user" : "assistant",
          text: "好",
        })),
      }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "🌙".repeat(4_001) }],
      }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: Array.from({ length: 7 }, (_, index) => ({
          role: index === 6 ? "user" : "assistant",
          text: "八".repeat(4_000),
        })),
      }),
    ).toThrow(ChatValidationError);
  });

  it("rejects misplaced, unsupported, and oversized images", () => {
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [
          { role: "user", text: "旧图", imageDataUrl: smallPng },
          { role: "user", text: "现在" },
        ],
      }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [
          { role: "user", text: "看看", imageDataUrl: "data:image/gif;base64,R0lGODlh" },
        ],
      }),
    ).toThrow(ChatValidationError);

    const oversizedBase64 = "A".repeat(2_796_208);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [
          {
            role: "user",
            text: "看看",
            imageDataUrl: `data:image/jpeg;base64,${oversizedBase64}`,
          },
        ],
      }),
    ).toThrow(ChatValidationError);
  });

  it("accepts an optional currentTime string on both return paths and rejects invalid values", () => {
    expect(
      validateChatRequest({
        ...(validRequest() as object),
        currentTime: "2026-08-27 11:09:37 星期四",
      }),
    ).toMatchObject({ currentTime: "2026-08-27 11:09:37 星期四" });

    expect(
      validateChatRequest({
        ...(validRequest() as object),
        provider: "openai",
        apiKey: "sk-" + "a".repeat(40),
        model: "gpt-5.6-luna",
        currentTime: "2026-08-27 11:09:37 星期四",
      }),
    ).toMatchObject({ currentTime: "2026-08-27 11:09:37 星期四" });

    expect(validateChatRequest(validRequest())).not.toHaveProperty("currentTime");

    // Rejects non-string, empty, or too long currentTime
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), currentTime: 123456 }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), currentTime: "" }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), currentTime: "   " }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), currentTime: "a".repeat(101) }),
    ).toThrow(ChatValidationError);
  });

  it("accepts valid request mode values and rejects unknown modes", () => {
    expect(validateChatRequest({ ...(validRequest() as object), mode: "chat" })).toMatchObject({
      mode: "chat",
    });
    expect(
      validateChatRequest({ ...(validRequest() as object), mode: "summary" }),
    ).toMatchObject({ mode: "summary" });
    expect(validateChatRequest({ ...(validRequest() as object), mode: "title" })).toMatchObject({
      mode: "title",
    });
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), mode: "invalid-mode" }),
    ).toThrow(ChatValidationError);
  });
});
