import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-origins", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-origins";
import { fetchReasoningSupport, readReasoningEffort, writeReasoningEffort } from "./reasoning-effort";

const claude = { provider: "claude" as const, model: "claude-opus-5-5" };
const kimi = { provider: "openai" as const, model: "kimi-k3", baseUrl: "https://api.moonshot.cn/v1" };

describe("reasoning-effort", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.mocked(apiFetch).mockReset());

  it("按模型分别记忆档位，清除后恢复默认", () => {
    writeReasoningEffort(claude, "xhigh");
    writeReasoningEffort(kimi, "low");
    expect(readReasoningEffort(claude)).toBe("xhigh");
    expect(readReasoningEffort({ ...kimi, baseUrl: undefined })).toBeUndefined();
    expect(readReasoningEffort(kimi)).toBe("low");
    writeReasoningEffort(claude, undefined);
    expect(readReasoningEffort(claude)).toBeUndefined();
    expect(readReasoningEffort(kimi)).toBe("low");
  });

  it("忽略存储中的非法内容", () => {
    localStorage.setItem("yachiyo_reasoning_effort", JSON.stringify({ "claude||claude-opus-5-5": "turbo" }));
    expect(readReasoningEffort(claude)).toBeUndefined();
    localStorage.setItem("yachiyo_reasoning_effort", "not json");
    expect(readReasoningEffort(claude)).toBeUndefined();
  });

  it("向网关查询档位并缓存，失败时视为不支持且不缓存", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ levels: ["low", "high", "max", "bogus"], defaultLevel: "max" })));
    await expect(fetchReasoningSupport(kimi)).resolves.toEqual({ levels: ["low", "high", "max"], defaultLevel: "max" });
    await fetchReasoningSupport(kimi);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[0]![1].body as string)).toEqual({
      provider: "openai",
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.cn/v1",
    });

    vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError("offline"));
    await expect(fetchReasoningSupport(claude)).resolves.toEqual({ levels: [] });
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ levels: ["low", "medium"] })));
    await expect(fetchReasoningSupport(claude)).resolves.toEqual({ levels: ["low", "medium"] });
  });
});
