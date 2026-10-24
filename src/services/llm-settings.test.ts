import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YachiyoDatabase } from "../data/db";
import { KEYSTORE_MANAGED_API_KEY, type ProviderId } from "../domain/llm";
import { apiFetch } from "./api-origins";
import { isDesktopApp } from "./app-platform";
import { LlmSettingsService } from "./llm-settings";

vi.mock("./app-platform", () => ({ isDesktopApp: vi.fn(() => false) }));
vi.mock("./api-origins", () => ({ apiFetch: vi.fn(async () => new Response("{}")) }));

const VALID_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";
const OTHER_KEY = "sk-other-abcdefghijklmnopqrstuvwxyz0123";

function save(
  service: LlmSettingsService,
  provider: ProviderId,
  apiKey: string,
  model: string,
  options: { id?: string; baseUrl?: string; activate?: boolean } = {},
) {
  const { activate, ...rest } = options;
  return service.saveEntry({ provider, apiKey, model, ...rest }, activate !== undefined ? { activate } : {});
}

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
    expect(await service.getActiveId()).toBeUndefined();
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("saves a config with a new id and auto-activates the first one", async () => {
    const record = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");

    expect(record).toMatchObject({ provider: "openai", apiKey: VALID_KEY, model: "gpt-5.6-luna" });
    expect(record.id).toMatch(/^openai~[a-z0-9]+$/);
    expect(await service.get(record.id)).toMatchObject({ apiKey: VALID_KEY });
    expect(await service.getActiveId()).toBe(record.id);
  });

  it("keeps several configs of the same provider side by side", async () => {
    const kimi = await save(service, "openai", VALID_KEY, "kimi-k3", { baseUrl: "https://api.moonshot.cn/v1" });
    const qwen = await save(service, "openai", OTHER_KEY, "qwen-max", {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });

    expect(kimi.id).not.toBe(qwen.id);
    expect(await service.list()).toHaveLength(2);
    expect(await service.get(kimi.id)).toMatchObject({ apiKey: VALID_KEY, model: "kimi-k3" });
    expect(await service.get(qwen.id)).toMatchObject({ apiKey: OTHER_KEY, model: "qwen-max" });
  });

  it("updates an existing config in place when its id is given", async () => {
    const first = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    await save(service, "openai", VALID_KEY, "gpt-6", { id: first.id });

    expect(await service.list()).toHaveLength(1);
    expect(await service.get(first.id)).toMatchObject({ model: "gpt-6" });
  });

  it("does not auto-activate a subsequent save", async () => {
    const first = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    await save(service, "claude", VALID_KEY, "claude-sonnet-5");

    expect(await service.getActiveId()).toBe(first.id);
  });

  it("force-activates when activate option is true", async () => {
    await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    const claude = await save(service, "claude", VALID_KEY, "claude-sonnet-5", { activate: true });

    expect(await service.getActiveId()).toBe(claude.id);
  });

  it("falls back to default model when model name is empty or blank", async () => {
    const record = await save(service, "gemini", VALID_KEY, "   ");

    expect(record.model).toBe("gemini-3.8-flash");
  });

  it("preserves custom and newly released official models without base URL", async () => {
    const record = await save(service, "stepfun", VALID_KEY, "step-2-16k");

    expect(record.model).toBe("step-2-16k");
  });

  it("keeps an arbitrary model name when a base URL is configured", async () => {
    const record = await save(service, "openai", VALID_KEY, "doubao-pro-32k", {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });

    expect(record.model).toBe("doubao-pro-32k");
    expect(record.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });

  it("persists custom model settings with a custom endpoint and keeps them across enable toggles", async () => {
    const record = await service.saveEntry({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "relay-model",
      baseUrl: "https://relay.example.com/v1",
      custom: { apiFormat: "responses", displayName: "中转", maxToolRounds: 80, supportsImage: false, temperature: 0.4 },
    });
    expect(record.custom).toEqual({
      apiFormat: "responses",
      displayName: "中转",
      maxToolRounds: 80,
      supportsImage: false,
      temperature: 0.4,
    });

    await service.setEnabled(record.id, false);
    expect((await service.get(record.id))?.custom?.apiFormat).toBe("responses");
    await service.setEnabled(record.id, true);
    await service.setActive(record.id);
    expect((await service.getActiveConfig())?.custom).toMatchObject({ apiFormat: "responses", maxToolRounds: 80 });
  });

  it("drops custom settings without an endpoint and sanitizes stored values", async () => {
    const native = await service.saveEntry({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "gpt-6-luna",
      custom: { apiFormat: "responses" },
    });
    expect(native.custom).toBeUndefined();

    // 旧版本或被篡改的记录：非法字段在读取时丢弃，未知协议回退为 Chat Completions
    await db.llmEntries.put({
      id: "openai~legacy01",
      provider: "openai",
      apiKey: VALID_KEY,
      model: "m",
      updatedAt: 1,
      baseUrl: "https://relay.example.com/v1",
      custom: { apiFormat: "grpc", temperature: 9, topK: 40 } as never,
    });
    await service.setActive("openai~legacy01");
    expect((await service.getActiveConfig())?.custom).toEqual({ apiFormat: "chat_completions", topK: 40 });
  });

  it("normalizes an empty base URL to undefined and keeps the whitelist fallback", async () => {
    const record = await save(service, "openai", VALID_KEY, "gpt-5.6-luna", { baseUrl: "   " });

    expect(record.baseUrl).toBeUndefined();
  });

  it("rejects an invalid base URL", async () => {
    await expect(save(service, "openai", VALID_KEY, "gpt-5.6-luna", { baseUrl: "http://insecure" })).rejects.toThrow();
  });

  it("refuses to change the provider of an existing config", async () => {
    const record = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");

    await expect(save(service, "claude", VALID_KEY, "claude-sonnet-5", { id: record.id })).rejects.toThrow();
  });

  it("getActiveConfig carries the base URL of the active config", async () => {
    await save(service, "openai", VALID_KEY, "qwen-max", {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });

    expect(await service.getActiveConfig()).toEqual({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "qwen-max",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  });

  it("getActiveConfig returns undefined when the active config was removed", async () => {
    const record = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    await service.clear(record.id);

    expect(await service.getActiveId()).toBeUndefined();
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("getActiveConfig returns undefined when stored key is invalid", async () => {
    await save(service, "openai", "tooshort", "gpt-5.6-luna");

    // saveEntry 不校验 key 长度，仅在读取当前配置时判定
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("getActiveConfig returns trimmed key and configured model", async () => {
    await save(service, "claude", `  ${VALID_KEY}  `, "claude-sonnet-5");

    expect(await service.getActiveConfig()).toEqual({
      provider: "claude",
      apiKey: VALID_KEY,
      model: "claude-sonnet-5",
    });
  });

  it("clears the active pointer without touching configs", async () => {
    const openai = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    const claude = await save(service, "claude", VALID_KEY, "claude-sonnet-5", { activate: true });

    await service.clearActive();

    expect(await service.getActiveId()).toBeUndefined();
    expect(await service.get(claude.id)).toBeDefined();
    expect(await service.get(openai.id)).toBeDefined();
  });

  it("clear removes one config and resets activation when it was active", async () => {
    await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    const claude = await save(service, "claude", VALID_KEY, "claude-sonnet-5", { activate: true });

    await service.clear(claude.id);

    expect(await service.get(claude.id)).toBeUndefined();
    expect(await service.getActiveId()).toBeUndefined();
    expect(await service.list()).toHaveLength(1);
  });

  it("keeps several configs enabled and only moves the active pointer when needed", async () => {
    const openai = await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    const claude = await save(service, "claude", VALID_KEY, "claude-sonnet-5");

    await service.setEnabled(claude.id, false);
    expect((await service.get(claude.id))?.disabled).toBe(true);
    expect(await service.getActiveId()).toBe(openai.id);

    await service.setEnabled(claude.id, true);
    expect((await service.get(claude.id))?.disabled).toBeUndefined();
    expect(await service.getActiveId()).toBe(openai.id);

    await service.setEnabled(openai.id, false);
    expect(await service.getActiveId()).toBe(claude.id);

    await service.setEnabled(claude.id, false);
    expect(await service.getActiveId()).toBeUndefined();

    await service.setEnabled(openai.id, true);
    expect(await service.getActiveId()).toBe(openai.id);
  });

  it("clearAll wipes every config and the active pointer", async () => {
    await save(service, "openai", VALID_KEY, "gpt-5.6-luna");
    await save(service, "glm", VALID_KEY, "glm-4.7-flash");

    await service.clearAll();

    expect(await service.list()).toEqual([]);
    expect(await service.getActiveId()).toBeUndefined();
  });

  it("keeps locale setting intact when clearing llm data", async () => {
    await db.settings.put({ key: "locale", value: "ja-JP" });
    await save(service, "openai", VALID_KEY, "gpt-5.6-luna");

    await service.clearAll();

    expect(await db.settings.get("locale")).toEqual({ key: "locale", value: "ja-JP" });
  });
});

describe("YachiyoDatabase v3 migration", () => {
  it("moves per-provider records into llmEntries with the provider as id", async () => {
    const name = `yachiyo-llm-migrate-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      conversations: "id, updatedAt, locale",
      messages: "id, conversationId, createdAt, [conversationId+createdAt]",
      images: "id, conversationId",
      settings: "key",
      llmSettings: "provider",
    });
    await legacy.table("llmSettings").bulkPut([
      { provider: "deepseek", apiKey: KEYSTORE_MANAGED_API_KEY, model: "deepseek-flash", updatedAt: 1 },
      { provider: "glm", apiKey: KEYSTORE_MANAGED_API_KEY, model: "glm-5.3-flash", updatedAt: 2, disabled: true },
    ]);
    await legacy.table("settings").put({ key: "activeProvider", value: "deepseek" });
    legacy.close();

    const db = new YachiyoDatabase(name);
    const service = new LlmSettingsService(db);
    try {
      const entries = await service.list();
      expect(entries).toHaveLength(2);
      expect(await service.get("deepseek")).toMatchObject({ id: "deepseek", provider: "deepseek", model: "deepseek-flash" });
      expect(await service.get("glm")).toMatchObject({ id: "glm", disabled: true });
      expect(await service.getActiveId()).toBe("deepseek");
      expect(await db.llmSettings.count()).toBe(0);
    } finally {
      db.close();
      await db.delete();
    }
  });
});

describe("LlmSettingsService on desktop", () => {
  let db: YachiyoDatabase;
  let service: LlmSettingsService;

  beforeEach(() => {
    vi.mocked(isDesktopApp).mockReturnValue(true);
    vi.mocked(apiFetch).mockClear();
    vi.mocked(apiFetch).mockResolvedValue(new Response("{}"));
    db = new YachiyoDatabase(`yachiyo-llm-desktop-test-${crypto.randomUUID()}`);
    service = new LlmSettingsService(db);
  });

  afterEach(async () => {
    vi.mocked(isDesktopApp).mockReturnValue(false);
    db.close();
    await db.delete();
  });

  it("stores the key in the config's own keystore slot and keeps only a placeholder locally", async () => {
    const record = await save(service, "claude", VALID_KEY, "claude-sonnet-5-5");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/keys",
      expect.objectContaining({ body: JSON.stringify({ provider: record.id, key: VALID_KEY }) }),
    );
    expect(await service.get(record.id)).toMatchObject({ apiKey: KEYSTORE_MANAGED_API_KEY });
  });

  it("gives each config of one provider its own keystore slot", async () => {
    const kimi = await save(service, "openai", VALID_KEY, "kimi-k3", { baseUrl: "https://api.moonshot.cn/v1" });
    const qwen = await save(service, "openai", OTHER_KEY, "qwen-max", {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });

    const slots = vi.mocked(apiFetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).provider);
    expect(slots).toEqual([kimi.id, qwen.id]);
    expect(kimi.id).not.toBe(qwen.id);
  });

  it("getActiveConfig names the keystore slot of the active config", async () => {
    const record = await save(service, "openai", VALID_KEY, "kimi-k3", { baseUrl: "https://api.moonshot.cn/v1" });

    expect(await service.getActiveConfig()).toEqual({
      provider: "openai",
      apiKey: KEYSTORE_MANAGED_API_KEY,
      model: "kimi-k3",
      keySlot: record.id,
      baseUrl: "https://api.moonshot.cn/v1",
    });
  });

  it("keeps the stored key when saving an existing config with the placeholder", async () => {
    const record = await save(service, "claude", VALID_KEY, "claude-sonnet-5-5");
    vi.mocked(apiFetch).mockClear();

    await save(service, "claude", KEYSTORE_MANAGED_API_KEY, "claude-opus-5-5", { id: record.id });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(await service.get(record.id)).toMatchObject({ model: "claude-opus-5-5" });
  });

  it("refuses the placeholder for a new config that has no stored key", async () => {
    await expect(save(service, "claude", KEYSTORE_MANAGED_API_KEY, "claude-opus-5-5")).rejects.toThrow();
    expect(await service.list()).toEqual([]);
  });

  it("binds the key to the endpoint it is saved with", async () => {
    const record = await save(service, "openai", VALID_KEY, "kimi-k3", { baseUrl: "https://api.moonshot.cn/v1" });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/keys",
      expect.objectContaining({
        body: JSON.stringify({ provider: record.id, key: VALID_KEY, baseUrl: "https://api.moonshot.cn/v1" }),
      }),
    );
  });

  it("refuses to reuse the stored key for a different endpoint", async () => {
    const record = await save(service, "openai", VALID_KEY, "kimi-k3", { baseUrl: "https://api.moonshot.cn/v1" });
    vi.mocked(apiFetch).mockClear();

    await expect(
      save(service, "openai", KEYSTORE_MANAGED_API_KEY, "kimi-k3", { id: record.id, baseUrl: "https://evil.example/v1" }),
    ).rejects.toThrow();
    await expect(save(service, "openai", KEYSTORE_MANAGED_API_KEY, "gpt-6-luna", { id: record.id })).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await service.get(record.id)).toMatchObject({ baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3" });

    // 端点不变时仍可沿用已存 Key（只改模型）
    await save(service, "openai", KEYSTORE_MANAGED_API_KEY, "kimi-k2.6", {
      id: record.id,
      baseUrl: "https://api.moonshot.cn/v1",
    });
    expect(await service.get(record.id)).toMatchObject({ model: "kimi-k2.6" });
  });

  it("deletes the config's own keystore slot", async () => {
    const record = await save(service, "openai", VALID_KEY, "kimi-k3", { baseUrl: "https://api.moonshot.cn/v1" });

    await service.clear(record.id);

    expect(apiFetch).toHaveBeenCalledWith(`/api/keys/${encodeURIComponent(record.id)}`, { method: "DELETE" });
  });

  it("carries the saved endpoint when migrating legacy plaintext keys", async () => {
    await db.llmEntries.put({
      id: "openai",
      provider: "openai",
      apiKey: VALID_KEY,
      model: "kimi-k3",
      updatedAt: 1,
      baseUrl: "https://api.moonshot.cn/v1",
    });

    await service.migrateKeysToKeystore();

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/keys",
      expect.objectContaining({
        body: JSON.stringify({ provider: "openai", key: VALID_KEY, baseUrl: "https://api.moonshot.cn/v1" }),
      }),
    );
  });

  it("does not persist the config when the keystore rejects the key", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response("{}", { status: 500 }));

    await expect(save(service, "claude", VALID_KEY, "claude-sonnet-5-5")).rejects.toThrow();
    expect(await service.list()).toEqual([]);
  });

  it("migrates plaintext keys from older versions into the keystore", async () => {
    await db.llmEntries.put({ id: "deepseek", provider: "deepseek", apiKey: VALID_KEY, model: "deepseek-v4-flash", updatedAt: 1 });

    await service.migrateKeysToKeystore();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(await service.get("deepseek")).toMatchObject({ apiKey: KEYSTORE_MANAGED_API_KEY });
  });
});
