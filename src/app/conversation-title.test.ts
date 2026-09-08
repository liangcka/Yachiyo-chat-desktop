import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../domain/chat";
import {
  buildTitleRequestMessages,
  cleanAiGeneratedTitle,
  defaultTitleForLocale,
  generateConversationTitle,
  isDefaultTitle,
} from "./conversation-title";

function makeMessage(text: string, role: "user" | "assistant" = "user", imageId?: string): ChatMessage {
  return {
    conversationId: "conv-1",
    createdAt: 100,
    id: `msg-${Math.random()}`,
    role,
    status: "complete",
    text,
    ...(imageId ? { imageId } : {}),
  };
}

describe("conversation-title", () => {
  describe("isDefaultTitle", () => {
    it("recognizes Chinese and Japanese default titles", () => {
      expect(isDefaultTitle("新的对话")).toBe(true);
      expect(isDefaultTitle("  新的对话  ")).toBe(true);
      expect(isDefaultTitle("新しい会話")).toBe(true);
      expect(isDefaultTitle("  新しい会話  ")).toBe(true);
      expect(isDefaultTitle("这是什么这个项目")).toBe(false);
      expect(isDefaultTitle("")).toBe(false);
    });
  });

  describe("defaultTitleForLocale", () => {
    it("returns correct default titles for locales", () => {
      expect(defaultTitleForLocale("zh-CN")).toBe("新的对话");
      expect(defaultTitleForLocale("ja-JP")).toBe("新しい会話");
    });
  });

  describe("generateConversationTitle", () => {
    it("returns default title when messages have no user message", () => {
      const messages = [makeMessage("你好！有什么可以帮你的？", "assistant")];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("新的对话");
      expect(generateConversationTitle(messages, "ja-JP")).toBe("新しい会話");
    });

    it("extracts clean title from straightforward user question", () => {
      const messages = [
        makeMessage("这是什么这个项目", "user"),
        makeMessage("这是《Alice in Cradle》的启动器", "assistant"),
      ];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("这是什么这个项目");
    });

    it("strips polite question prefixes and trailing question marks in Chinese", () => {
      const messages = [makeMessage("请问一下，八千代能帮我写一首诗吗？")];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("能帮我写一首诗吗");
    });

    it("strips greetings and polite prefixes in Japanese", () => {
      const messages = [makeMessage("こんにちは、このプロジェクトは何ですか？")];
      expect(generateConversationTitle(messages, "ja-JP")).toBe("このプロジェクトは何ですか");
    });

    it("strips markdown code blocks and focuses on natural language query", () => {
      const text = "```ts\nfunction add(a: number, b: number) { return a + b; }\n```\n帮我给这个函数写单测";
      const messages = [makeMessage(text)];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("帮我给这个函数写单测");
    });

    it("falls back to code analysis when user sends only code block", () => {
      const text = "```python\nprint('hello')\n```";
      const messages = [makeMessage(text)];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("代码分析");
      expect(generateConversationTitle(messages, "ja-JP")).toBe("コード分析");
    });

    it("falls back to image analysis when user sends only an image", () => {
      const messages = [makeMessage("", "user", "img-123")];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("图片分析");
      expect(generateConversationTitle(messages, "ja-JP")).toBe("画像分析");
    });

    it("strips markdown headers and bullet points from first line", () => {
      const text = "# 项目架构与规划说明\n- 第一点\n- 第二点";
      const messages = [makeMessage(text)];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("项目架构与规划说明");
    });

    it("truncates very long prompts cleanly up to 20 characters with ellipsis", () => {
      const longText = "请问如何在 React 19 中优雅地结合 IndexedDB 和 Web Workers 编写高性能状态缓存模块？";
      const messages = [makeMessage(longText)];
      const title = generateConversationTitle(messages, "zh-CN");
      expect(Array.from(title).length).toBe(20);
      expect(title.endsWith("…")).toBe(true);
    });

    it("preserves short greetings if removing prefix would leave empty string", () => {
      const messages = [makeMessage("你好")];
      expect(generateConversationTitle(messages, "zh-CN")).toBe("你好");
    });
  });

  describe("cleanAiGeneratedTitle", () => {
    it("cleans surrounding quotes and book quotes", () => {
      expect(cleanAiGeneratedTitle("《量子力学入门》")).toBe("量子力学入门");
      expect(cleanAiGeneratedTitle("“React 状态管理”")).toBe("React 状态管理");
      expect(cleanAiGeneratedTitle("「八千代の日常」")).toBe("八千代の日常");
    });

    it("strips common title prefixes and trailing punctuation", () => {
      expect(cleanAiGeneratedTitle("标题：前端架构设计。")).toBe("前端架构设计");
      expect(cleanAiGeneratedTitle("对话主题: Python爬虫开发！")).toBe("Python爬虫开发");
      expect(cleanAiGeneratedTitle("Title: Rust Concurrency?")).toBe("Rust Concurrency");
      expect(cleanAiGeneratedTitle("好的，为你生成的标题是：Alice启动器")).toBe("Alice启动器");
      expect(cleanAiGeneratedTitle("为您提炼的标题是：《Alice in Cradle启动器》")).toBe("Alice in Cradle启动器");
    });

    it("strips markdown formatting and headers", () => {
      expect(cleanAiGeneratedTitle("## **机器学习基础**\n这是多余内容")).toBe("机器学习基础");
      expect(cleanAiGeneratedTitle("`Docker部署实践`")).toBe("Docker部署实践");
    });

    it("rejects default titles, empty strings, and overly short strings", () => {
      expect(cleanAiGeneratedTitle("")).toBeUndefined();
      expect(cleanAiGeneratedTitle("   ")).toBeUndefined();
      expect(cleanAiGeneratedTitle("a")).toBeUndefined();
      expect(cleanAiGeneratedTitle("新的对话")).toBeUndefined();
      expect(cleanAiGeneratedTitle("新しい会話")).toBeUndefined();
    });

    it("rejects excessively long rambles and truncates mildly long titles", () => {
      expect(
        cleanAiGeneratedTitle("这是一段非常非常非常非常非常非常非常非常非常非常漫长无意义的模型胡言乱语"),
      ).toBeUndefined();
      const mildlyLong = "微前端架构下的状态共享与跨应用通信机制设计";
      const cleaned = cleanAiGeneratedTitle(mildlyLong);
      expect(cleaned).toBeDefined();
      expect(Array.from(cleaned!).length).toBe(20);
      expect(cleaned!.endsWith("…")).toBe(true);
    });
  });

  describe("buildTitleRequestMessages", () => {
    it("constructs a single user prompt with formatted conversation snippet", () => {
      const messages = [
        makeMessage("今天天气真好，想出去散步", "user"),
        makeMessage("八千代也想和彩叶一起出门看银杏呢~", "assistant"),
      ];
      const requestMessages = buildTitleRequestMessages(messages, "zh-CN");
      expect(requestMessages).toHaveLength(1);
      expect(requestMessages[0]?.role).toBe("user");
      expect(requestMessages[0]?.text).toContain("今天天气真好");
      expect(requestMessages[0]?.text).toContain("八千代也想和彩叶一起出门");
    });

    it("supports Japanese prompt formatting", () => {
      const messages = [makeMessage("TypeScriptの型システムについて教えて", "user")];
      const requestMessages = buildTitleRequestMessages(messages, "ja-JP");
      expect(requestMessages[0]?.text).toContain("TypeScriptの型システムについて教えて");
      expect(requestMessages[0]?.text).toContain("ユーザー:");
    });
  });
});
