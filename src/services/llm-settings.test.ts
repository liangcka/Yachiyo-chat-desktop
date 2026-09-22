import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YachiyoDatabase } from "../data/db";
import { LlmSettingsService } from "./llm-settings";

const VALID_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";

describe("LlmSettingsService", () => {
  let db: YachiyoDatabase;
  let service: LlmSettingsService;

  beforeEach(() => {
    db = new YachiyoDatabase(`yachiyo-llm-test-${crypto.randomUUID()}`);
    service = new LlmSettingsService(db);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("returns undefined when no config is stored", async () => {
    expect(await service.get("openai")).toBeUndefined();
    expect(await service.list()).toEqual([]);
    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("saves a provider config and auto-activates the first one", async () => {
    const record = await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");

    expect(record).toMatchObject({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "gpt-5.6-luna",
    });
    expect(await service.get("openai")).toMatchObject({ apiKey: VALID_KEY });
    expect(await service.getActiveProvider()).toBe("openai");
  });

  it("does not auto-activate a subsequent provider save", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5");

    expect(await service.getActiveProvider()).toBe("openai");
  });

  it("force-activates when activate option is true", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5", {
      activate: true,
    });

    expect(await service.getActiveProvider()).toBe("claude");
  });

  it("falls back to default model when model name is empty or blank", async () => {
    const record = await service.saveProvider("gemini", VALID_KEY, "   ");

    expect(record.model).toBe("gemini-3.7-flash");
  });

  it("preserves custom and newly released official models without base URL", async () => {
    const record = await service.saveProvider("stepfun", VALID_KEY, "step-2-16k");

    expect(record.model).toBe("step-2-16k");
  });

  it("keeps an arbitrary model name when a base URL is configured", async () => {
    const record = await service.saveProvider("openai", VALID_KEY, "doubao-pro-32k", {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });

    expect(record.model).toBe("doubao-pro-32k");
    expect(record.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(await service.get("openai")).toMatchObject({ model: "doubao-pro-32k" });
  });

  it("normalizes an empty base URL to undefined and keeps the whitelist fallback", async () => {
    const record = await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna", {
      baseUrl: "   ",
    });

    expect(record.baseUrl).toBeUndefined();
  });

  it("rejects an invalid base URL", async () => {
    await expect(
      service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna", { baseUrl: "http://insecure" }),
    ).rejects.toThrow();
  });

  it("getActiveConfig carries the base URL of the active provider", async () => {
    await service.saveProvider("openai", VALID_KEY, "qwen-max", {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });

    const config = await service.getActiveConfig();
    expect(config).toEqual({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "qwen-max",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  });

  it("getActiveConfig returns undefined when active provider has no record", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.clear("openai");

    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("getActiveConfig returns undefined when stored key is invalid", async () => {
    await service.saveProvider("openai", "tooshort", "gpt-5.6-luna");

    // saveProvider 不校验 key 长度，仅在读取激活配置时判定
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("getActiveConfig returns trimmed key and configured model", async () => {
    await service.saveProvider("claude", `  ${VALID_KEY}  `, "claude-sonnet-5");

    const config = await service.getActiveConfig();
    expect(config).toEqual({
      provider: "claude",
      apiKey: VALID_KEY,
      model: "claude-sonnet-5",
    });
  });

  it("clears the active pointer without touching other providers", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5", {
      activate: true,
    });

    await service.clearActiveProvider();

    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.get("claude")).toBeDefined();
    expect(await service.get("openai")).toBeDefined();
  });

  it("clear removes a provider and resets activation when it was active", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5", {
      activate: true,
    });

    await service.clear("claude");

    expect(await service.get("claude")).toBeUndefined();
    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.list()).toHaveLength(1);
  });

  it("clearAll wipes every provider and the active pointer", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("glm", VALID_KEY, "glm-4.7-flash");

    await service.clearAll();

    expect(await service.list()).toEqual([]);
    expect(await service.getActiveProvider()).toBeUndefined();
  });

  it("keeps locale setting intact when clearing llm data", async () => {
    await db.settings.put({ key: "locale", value: "ja-JP" });
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");

    await service.clearAll();

    expect(await db.settings.get("locale")).toEqual({ key: "locale", value: "ja-JP" });
  });
});
