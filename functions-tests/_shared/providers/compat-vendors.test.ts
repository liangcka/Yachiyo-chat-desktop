import { describe, expect, it } from "vitest";
import {
  compatVendorBodyPatch,
  detectCompatVendor,
} from "../../../functions/_shared/providers/compat-vendors";

describe("detectCompatVendor", () => {
  it("matches vendors by endpoint host suffix, including regional subdomains", () => {
    expect(detectCompatVendor("https://ark.cn-beijing.volces.com/api/v3")).toBe("ark");
    expect(detectCompatVendor("https://ark.ap-southeast.bytepluses.com/api/v3")).toBe("ark");
    expect(detectCompatVendor("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")).toBe("dashscope");
    expect(detectCompatVendor("https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")).toBe("dashscope");
    expect(detectCompatVendor("https://api.moonshot.ai/v1")).toBe("moonshot");
    expect(detectCompatVendor("https://api.minimax.cn/v1")).toBe("minimax");
    expect(detectCompatVendor("https://api.minimaxi.com/v1")).toBe("minimax");
  });

  it("ignores unknown hosts, look-alike domains and missing base URLs", () => {
    expect(detectCompatVendor(undefined)).toBeUndefined();
    expect(detectCompatVendor("https://api.openai.com/v1")).toBeUndefined();
    expect(detectCompatVendor("https://evilmoonshot.cn/v1")).toBeUndefined();
    expect(detectCompatVendor("not a url")).toBeUndefined();
  });
});

describe("compatVendorBodyPatch", () => {
  it("lowers Kimi K3 effort and turns off K2.6 thinking only for auxiliary requests", () => {
    expect(compatVendorBodyPatch("moonshot", "kimi-k3", "chat")).toEqual({ reasoning_effort: "low" });
    expect(compatVendorBodyPatch("moonshot", "kimi-k3", "auxiliary")).toEqual({ reasoning_effort: "low" });
    expect(compatVendorBodyPatch("moonshot", "kimi-k2.6", "auxiliary")).toEqual({ thinking: { type: "disabled" } });
    expect(compatVendorBodyPatch("moonshot", "kimi-k2.6", "chat")).toEqual({});
    expect(compatVendorBodyPatch("moonshot", "kimi-k2.7-code", "auxiliary")).toEqual({});
  });

  it("disables Qwen thinking only on confirmed hybrid models", () => {
    expect(compatVendorBodyPatch("dashscope", "qwen3.8-flash", "auxiliary")).toEqual({ enable_thinking: false });
    expect(compatVendorBodyPatch("dashscope", "qwen3.7-plus-2026-05-26", "auxiliary")).toEqual({
      enable_thinking: false,
    });
    expect(compatVendorBodyPatch("dashscope", "qwen3.8-max-preview", "auxiliary")).toEqual({});
    expect(compatVendorBodyPatch("dashscope", "qwen3.7-max-2026-05-17", "auxiliary")).toEqual({});
    expect(compatVendorBodyPatch("dashscope", "qwen3-235b-a22b-instruct-2507", "auxiliary")).toEqual({});
    expect(compatVendorBodyPatch("dashscope", "qwen3.8-max", "chat")).toEqual({ reasoning_effort: "low" });
    expect(compatVendorBodyPatch("dashscope", "qwen3.7-plus", "chat")).toEqual({});
  });

  it("splits MiniMax thinking out of content and respects per-model thinking controls", () => {
    expect(compatVendorBodyPatch("minimax", "MiniMax-M3", "chat")).toEqual({ reasoning_split: true });
    expect(compatVendorBodyPatch("minimax", "MiniMax-M3", "auxiliary")).toEqual({
      reasoning_split: true,
      thinking: { type: "disabled" },
    });
    expect(compatVendorBodyPatch("minimax", "MiniMax-M3.1-Flash", "auxiliary")).toEqual({ reasoning_effort: "low" });
    expect(compatVendorBodyPatch("minimax", "MiniMax-M2.7", "auxiliary")).toEqual({ reasoning_split: true });
  });

  it("leaves unknown vendors untouched", () => {
    expect(compatVendorBodyPatch(undefined, "kimi-k3", "chat")).toEqual({});
  });
});

describe("compatVendorBodyPatch for MiMo, TokenHub and Qianfan", () => {
  it("disables MiMo thinking for auxiliary requests only", () => {
    expect(compatVendorBodyPatch("mimo", "mimo-v2.6-flash", "auxiliary")).toEqual({ thinking: { type: "disabled" } });
    expect(compatVendorBodyPatch("mimo", "mimo-v2.6-pro", "chat")).toEqual({});
  });

  it("limits TokenHub rules to Hunyuan's own models", () => {
    expect(compatVendorBodyPatch("hunyuan", "hy3", "auxiliary")).toEqual({ thinking: { type: "disabled" } });
    expect(compatVendorBodyPatch("hunyuan", "hy3", "chat")).toEqual({ reasoning_effort: "low" });
    expect(compatVendorBodyPatch("hunyuan", "hy4-preview", "chat")).toEqual({});
    expect(compatVendorBodyPatch("hunyuan", "glm-5.3", "auxiliary")).toEqual({});
  });

  it("only toggles ERNIE thinking on the documented hybrid model", () => {
    expect(compatVendorBodyPatch("qianfan", "ernie-5.0-thinking-preview", "auxiliary")).toEqual({
      enable_thinking: false,
    });
    expect(compatVendorBodyPatch("qianfan", "ernie-5.1", "auxiliary")).toEqual({});
  });

  it("recognises the native Zhipu endpoint as a vendor", () => {
    expect(detectCompatVendor("https://open.bigmodel.cn/api/paas/v4/chat/completions")).toBe("zhipu");
    expect(detectCompatVendor("https://api.z.ai/api/paas/v4")).toBe("zhipu");
  });
});
