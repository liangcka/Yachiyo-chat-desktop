import { describe, expect, it } from "vitest";
import {
  DOMESTIC_PROVIDERS,
  INTERNATIONAL_PROVIDERS,
  MODEL_VENDORS,
  PROVIDER_IDS,
  PROVIDER_METADATA,
  findVendorForEntry,
  getProviderMeta,
  isProviderId,
  isValidApiKey,
} from "./llm";

describe("ProviderId", () => {
  it("exposes six supported providers", () => {
    expect(PROVIDER_IDS).toEqual(["stepfun", "deepseek", "glm", "openai", "claude", "gemini"]);
  });

  it("narrows known ids and rejects unknown values", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("claude")).toBe(true);
    expect(isProviderId("unknown")).toBe(false);
    expect(isProviderId(123)).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });
});

describe("PROVIDER_METADATA", () => {
  it("covers every provider id", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_METADATA[id]).toBeDefined();
      expect(PROVIDER_METADATA[id].id).toBe(id);
    }
  });

  it("keeps defaultModel within each model list", () => {
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDER_METADATA[id];
      expect(meta.models).toContain(meta.defaultModel);
    }
  });

  it("splits providers into domestic and international groups", () => {
    expect(DOMESTIC_PROVIDERS).toEqual(["stepfun", "deepseek", "glm"]);
    expect(INTERNATIONAL_PROVIDERS).toEqual(["openai", "claude", "gemini"]);
    expect([...DOMESTIC_PROVIDERS, ...INTERNATIONAL_PROVIDERS].sort()).toEqual(
      [...PROVIDER_IDS].sort(),
    );
  });

  it("reports image support flags aligned with backend", () => {
    expect(PROVIDER_METADATA.stepfun.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.deepseek.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.glm.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.openai.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.claude.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.gemini.supportsImage).toBe(true);
  });

  it("limits imageModels to the models that actually accept images", () => {
    expect(PROVIDER_METADATA.deepseek.imageModels).toEqual([
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
    ]);
    expect(PROVIDER_METADATA.glm.imageModels).toEqual([
      "glm-5.3-flash",
      "glm-5.3-flashx",
      "glm-4.6v-flash",
      "glm-4v-flash",
    ]);
    for (const id of PROVIDER_IDS) {
      for (const model of PROVIDER_METADATA[id].imageModels) {
        expect(PROVIDER_METADATA[id].models).toContain(model);
      }
    }
  });

  it("getProviderMeta returns the matching metadata", () => {
    expect(getProviderMeta("glm").label).toBe("智谱 GLM");
  });
});

describe("isValidApiKey", () => {
  it("accepts printable ASCII strings within length bounds", () => {
    expect(isValidApiKey("sk-" + "a".repeat(20))).toBe(true);
    expect(isValidApiKey("sk-ant-api03-abcdef0123456789")).toBe(true);
  });

  it("rejects too short, too long, and non-ASCII values", () => {
    expect(isValidApiKey("short")).toBe(false);
    expect(isValidApiKey("a".repeat(600))).toBe(false);
    expect(isValidApiKey("含中文的key-abcdefghij")).toBe(false);
    // 内部会 trim，两侧空格不影响判定
    expect(isValidApiKey("  " + "a".repeat(20) + "  ")).toBe(true);
  });
});

describe("MODEL_VENDORS", () => {
  it("keeps card ids unique and every default model inside its own model list", () => {
    const ids = MODEL_VENDORS.map((vendor) => vendor.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const vendor of MODEL_VENDORS) {
      expect(vendor.models, vendor.id).toContain(vendor.defaultModel);
    }
  });

  it("only maps native-protocol providers to cards without a custom endpoint", () => {
    for (const vendor of MODEL_VENDORS) {
      if (vendor.mappedProvider === "claude" || vendor.mappedProvider === "gemini") {
        expect(vendor.defaultBaseUrl, vendor.id).toBeUndefined();
      }
    }
  });

  it("gives every preset endpoint a distinct host inside its shared provider slot", () => {
    const seen = new Set<string>();
    for (const vendor of MODEL_VENDORS) {
      if (vendor.defaultBaseUrl === undefined) continue;
      const key = `${vendor.mappedProvider}|${new URL(vendor.defaultBaseUrl).hostname}`;
      expect(seen.has(key), `${vendor.id} shares ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe("findVendorForEntry", () => {
  it("finds the card that owns a saved endpoint by its host", () => {
    expect(findVendorForEntry("openai", "https://api.moonshot.cn/v1")?.id).toBe("kimi_cn");
    expect(findVendorForEntry("openai", "https://api.moonshot.ai/v1/")?.id).toBe("kimi_global");
    expect(findVendorForEntry("glm", "https://api.z.ai/api/paas/v4")?.id).toBe("zai");
  });

  it("maps entries without an endpoint to the native card of the slot", () => {
    expect(findVendorForEntry("openai", undefined)?.id).toBe("openai");
    expect(findVendorForEntry("claude", undefined)?.id).toBe("claude");
    expect(findVendorForEntry("glm", undefined)?.id).toBe("glm");
  });

  it("returns undefined for an endpoint no card presets", () => {
    expect(findVendorForEntry("openai", "https://my-proxy.example.com/v1")).toBeUndefined();
  });
});
