import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie, signSession } from "../../functions/_shared/session";
import { onRequestPost } from "../../functions/api/deepseek/balance";

const origin = "https://yachiyo.test";
const apiKey = "sk-" + "d".repeat(40);
const upstreamFetch = vi.fn<typeof fetch>();

async function balanceRequest(body: unknown, options: { session?: boolean; origin?: string } = {}): Promise<Request> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: options.origin ?? origin };
  if (options.session !== false) {
    const token = await signSession({ sid: "balance-session", exp: Date.now() + 60_000 }, env.SESSION_SIGNING_SECRET);
    headers.cookie = sessionCookie(token).split(";", 1)[0];
  }
  return new Request(`${origin}/api/deepseek/balance`, { method: "POST", headers, body: JSON.stringify(body) });
}

function invoke(request: Request, runtimeEnv: Env = env): Promise<Response> {
  return onRequestPost({ request, env: runtimeEnv });
}

beforeEach(() => {
  upstreamFetch.mockReset();
  upstreamFetch.mockRejectedValue(new Error("Unexpected outbound request"));
  vi.stubGlobal("fetch", upstreamFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/deepseek/balance", () => {
  it("拒绝跨源与无会话请求，且不外呼", async () => {
    expect((await invoke(await balanceRequest({ apiKey }, { origin: "https://attacker.test" }))).status).toBe(403);
    const response = await invoke(await balanceRequest({ apiKey }, { session: false }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "SESSION_REQUIRED" } });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("Key 不合法时直接拒绝", async () => {
    const response = await invoke(await balanceRequest({ apiKey: "short" }));
    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("用 Bearer Key 请求 DeepSeek 并原样返回余额 JSON", async () => {
    const payload = {
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "12.34", granted_balance: "2.00", topped_up_balance: "10.34" }],
    };
    upstreamFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const response = await invoke(await balanceRequest({ apiKey }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    const [url, init] = upstreamFetch.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/user/balance");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${apiKey}`);
  });

  it("上游鉴权失败与其他错误分别映射", async () => {
    upstreamFetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const auth = await invoke(await balanceRequest({ apiKey }));
    expect(auth.status).toBe(401);
    expect(await auth.json()).toEqual({ error: { code: "PROVIDER_AUTH_FAILED" } });

    upstreamFetch.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    const busy = await invoke(await balanceRequest({ apiKey }));
    expect(busy.status).toBe(502);
    expect(await busy.json()).toEqual({ error: { code: "PROVIDER_ERROR" } });
  });

  it("mock 模式返回固定余额且不外呼", async () => {
    const response = await invoke(await balanceRequest({}), { ...env, APP_MODE: "mock" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ is_available: true });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
