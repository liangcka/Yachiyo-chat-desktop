import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhaleStore } from "./store";
import { WhaleHost } from "./whale-host";

const API_KEY = "sk-" + "w".repeat(40);
const fetchMock = vi.fn<typeof fetch>();
const assetFetch = vi.fn<typeof fetch>();
let storeSeq = 0;

function createHost(): WhaleHost {
  storeSeq += 1;
  return new WhaleHost(new WhaleStore(`whale-host-test-${storeSeq}`), assetFetch);
}

async function call(host: WhaleHost, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await host.handle(new URL(path, "http://localhost"), init);
  return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
}

function post(body: unknown, method = "POST"): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function balanceResponse(total: string): Response {
  return new Response(JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: "CNY", total_balance: total, granted_balance: "1.00", topped_up_balance: "0" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  assetFetch.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("余额与记账", () => {
  it("未配置 DeepSeek Key 时返回 NO_KEY，不外呼", async () => {
    const result = await call(createHost(), "/dsh-whale/balance.json");
    expect(result).toMatchObject({ ok: false, code: "NO_KEY", version: "0.4.2", usageMode: "ledger" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("网关确认 Key 缺失或被拒时通知宿主应用，同一问题只通知一次，恢复后可再次通知", async () => {
    const host = createHost();
    const issues: string[] = [];
    host.onKeyIssue((issue) => issues.push(issue));
    host.setContext({ hasKey: true });
    const problem = (code: string, status: number) =>
      new Response(JSON.stringify({ error: { code } }), { status, headers: { "content-type": "application/json" } });
    fetchMock
      .mockResolvedValueOnce(problem("API_KEY_MISSING", 400))
      .mockResolvedValueOnce(problem("API_KEY_MISSING", 400))
      .mockResolvedValueOnce(balanceResponse("10.00"))
      .mockResolvedValueOnce(problem("PROVIDER_AUTH_FAILED", 401));

    expect(await call(host, "/dsh-whale/balance.json?refresh=1")).toMatchObject({ ok: false, code: "NO_KEY" });
    await call(host, "/dsh-whale/balance.json?refresh=1");
    expect(issues).toEqual(["missing"]);
    expect(await call(host, "/dsh-whale/balance.json?refresh=1")).toMatchObject({ ok: true });
    await call(host, "/dsh-whale/balance.json?refresh=1");
    expect(issues).toEqual(["missing", "rejected"]);
  });

  it("余额经代理获取，余额下降计入今日已用，不下发账户指纹", async () => {
    const host = createHost();
    host.setContext({ hasKey: true, apiKey: API_KEY });
    fetchMock.mockResolvedValueOnce(balanceResponse("10.00")).mockResolvedValueOnce(balanceResponse("9.70"));

    const first = await call(host, "/dsh-whale/balance.json?refresh=1");
    expect(first).toMatchObject({ ok: true, totalBalance: 10, bonusBalance: 1, currency: "CNY", todayUsage: 0 });
    expect(first).not.toHaveProperty("accountTag");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/deepseek/balance");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ apiKey: API_KEY });

    const second = await call(host, "/dsh-whale/balance.json?refresh=1");
    expect(second).toMatchObject({ ok: true, totalBalance: 9.7, todayUsage: 0.3, usageLabel: "已观测消费" });
  });

  it("瞬时失败时沿用最近余额并标记 stale", async () => {
    const host = createHost();
    host.setContext({ hasKey: true, apiKey: API_KEY });
    fetchMock.mockResolvedValueOnce(balanceResponse("10.00"));
    await call(host, "/dsh-whale/balance.json?refresh=1");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await call(host, "/dsh-whale/balance.json?refresh=1");
    expect(result).toMatchObject({ ok: true, stale: true, totalBalance: 10 });
  });

  it("回复结束后按余额下降结算本轮消耗，并写入按模型的用量记录", async () => {
    const host = createHost();
    host.setContext({ hasKey: true, apiKey: API_KEY });
    fetchMock.mockResolvedValueOnce(balanceResponse("10.00")).mockResolvedValueOnce(balanceResponse("9.97"));
    await call(host, "/dsh-whale/balance.json?refresh=1");
    expect(await call(host, "/dsh-whale/last-turn.json")).toMatchObject({ seq: 0, turn: null });

    host.beginTurn();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const settled = host.endTurn({ model: "deepseek-flash", tokens: 1234 });
    await vi.advanceTimersByTimeAsync(2_600);
    vi.useRealTimers();
    await settled;

    expect(await call(host, "/dsh-whale/last-turn.json")).toMatchObject({ ok: true, seq: 1, amount: 0.03, tokens: 1234 });
    const records = await call(host, "/dsh-whale/usage-records.json");
    expect((records.today as { models: unknown[] }).models).toEqual([{ model: "deepseek-flash", cost: 0.03, source: "events", currency: "CNY" }]);
  });

  it("挂件隐藏期间不外呼，也不下发审批提示", async () => {
    const host = createHost();
    host.setContext({ hasKey: true, apiKey: API_KEY, pending: { kind: "approval", id: "req-1" }, sessionName: "写周报" });
    expect(await call(host, "/dsh-whale/wait.json")).toMatchObject({ pending: { kind: "approval", id: "req-1" }, sessionName: "写周报" });
    host.setContext({ paused: true });
    expect(await call(host, "/dsh-whale/wait.json")).toMatchObject({ pending: null });
    expect(await call(host, "/dsh-whale/balance.json?refresh=1")).toMatchObject({ ok: false, code: "PAUSED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("配置与素材", () => {
  it("外观设置缺字段时沿用现有值，缺 scale 时拒绝", async () => {
    const host = createHost();
    expect(await call(host, "/dsh-whale/size.json")).toEqual({ status: 200, version: "0.4.2", versionLabel: "0.4.2" });
    await call(host, "/dsh-whale/size.json", post({ scale: 1.5, vol: 0.3, menuBtnHide: true }, "PUT"));
    await call(host, "/dsh-whale/size.json", post({ scale: 2 }, "PUT"));
    expect(await call(host, "/dsh-whale/size.json")).toMatchObject({ scale: 2, vol: 0.3, menuBtnHide: true, soundSet: "duck", turnCostCloseMs: 5000 });
    expect(await call(host, "/dsh-whale/size.json", post({ vol: 1 }, "PUT"))).toMatchObject({ status: 400, ok: false });
  });

  it("自定义泡泡框的 SVG 只保留几何标签与属性", async () => {
    const svgCode = '<path d="M0 0"/><script>alert(1)</script><rect onclick="steal()" width="5" fill="url(javascript:x)"/>';
    const result = await call(createHost(), "/dsh-whale/bubble.json", post({ items: [], lib: [], frames: [{ id: "f1", slots: { big: { svgCode } } }], defaultFrameId: "f1" }));
    const config = result.config as { frames: Array<{ slots: { big: { svgCode: string } } }>; defaultFrameId: string };
    expect(config.frames[0]!.slots.big.svgCode).toBe('<path d="M0 0"/><rect width="5"/>');
    expect(config.defaultFrameId).toBe("f1");
  });

  it("自定义角色存入本机，可取回与删除", async () => {
    const host = createHost();
    const image = `data:image/png;base64,${btoa("\x89PNG\r\n\x1a\n-whale-role-bytes")}`;
    const uploaded = await call(host, "/dsh-whale/roles.json", post({ name: "测试角色", image }));
    const role = (uploaded.roles as Array<{ id: string; name: string; url: string }>).find((item) => item.name === "测试角色")!;
    expect(role.url).toBe(`/dsh-whale/role-image.png?id=${role.id}`);
    const response = await host.handle(new URL(role.url, "http://localhost"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    await call(host, "/dsh-whale/role-delete.json", post({ id: role.id }));
    expect((await host.handle(new URL(role.url, "http://localhost"))).status).toBe(404);
    expect(await call(host, "/dsh-whale/role-delete.json", post({ id: "default" }))).toMatchObject({ status: 400 });
  });

  it("内置音效按版本从 CDN 加载，自定义音效组的留空槽静音", async () => {
    const host = createHost();
    assetFetch.mockResolvedValue(new Response("mp3", { status: 200 }));
    const press = await host.handle(new URL("/dsh-whale/sound/press.mp3?set=duck", "http://localhost"));
    expect(press.headers.get("content-type")).toBe("audio/mpeg");
    expect(String(assetFetch.mock.calls[0]![0])).toBe("https://cdn.jsdelivr.net/npm/dsh-whale-widget@0.4.2/assets/Ya1.mp3");

    const saved = await call(host, "/dsh-whale/audio.json", post({ action: "save-group", name: "只有松开", press: "", release: "d2" }));
    const group = (saved.groups as Array<{ id: string; name: string }>).find((item) => item.name === "只有松开")!;
    const muted = await host.handle(new URL(`/dsh-whale/sound/press.mp3?set=${group.id}`, "http://localhost"));
    expect(muted.status).toBe(204);
  });

  it("只提供内置 DeepSeek，其它厂商模型的写操作被拒绝", async () => {
    const host = createHost();
    const models = await call(host, "/dsh-whale/api-models.json");
    expect((models.models as Array<{ id: string }>).map((model) => model.id)).toEqual(["deepseek"]);
    expect(await call(host, "/dsh-whale/api-models.json", post({ action: "save", model: { provider: "openrouter" } }))).toMatchObject({ status: 400, ok: false });
    const saved = await call(host, "/dsh-whale/api-models.json", post({ action: "model-settings", id: "deepseek", alert: { below: 20 } }));
    expect(saved).toMatchObject({ ok: true, settings: { alert: { below: 20 } } });
  });
});
