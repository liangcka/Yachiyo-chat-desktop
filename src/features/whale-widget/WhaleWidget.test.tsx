import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsPanel } from "../../components/settings/PluginsPanel";
import { DEFAULT_PLUGIN_SETTINGS, getPluginSettings, saveWhaleWidgetSettings } from "../../services/plugin-settings";
import { checkWhaleAssetUpdate, whaleImageUrl } from "./assets";
import { WhaleWidget } from "./WhaleWidget";

const deepseekEntry = { provider: "deepseek" as const, apiKey: "sk-" + "w".repeat(40), model: "deepseek-flash" };
const fetchMock = vi.fn<typeof fetch>();

function balanceResponse(total: string): Response {
  return new Response(JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: "CNY", total_balance: total, granted_balance: "1.00", topped_up_balance: "0" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WhaleWidget", () => {
  const settings = { ...DEFAULT_PLUGIN_SETTINGS.whaleWidget, enabled: true };

  it("未配置 DeepSeek Key 时不发请求，展开后引导去配置", () => {
    const onConfigureKey = vi.fn();
    render(<WhaleWidget locale="zh-CN" entries={[]} phase="idle" settings={settings} onConfigureKey={onConfigureKey} />);
    const body = screen.getByRole("button", { name: "余额小鲸鱼：未配置" });
    expect(body.querySelector("img")).toHaveAttribute("src", whaleImageUrl(settings.assetVersion));
    fireEvent.click(body);
    fireEvent.click(screen.getByRole("button", { name: "去配置" }));
    expect(onConfigureKey).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("查询余额后显示金额，DeepSeek 回复结束后提示本轮消耗", async () => {
    fetchMock.mockResolvedValueOnce(balanceResponse("10.00")).mockResolvedValueOnce(balanceResponse("9.97"));
    const view = render(
      <WhaleWidget locale="zh-CN" entries={[deepseekEntry]} activeProvider="deepseek" phase="idle" settings={settings} onConfigureKey={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: "余额小鲸鱼：¥10.00" })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/deepseek/balance");
    expect(JSON.parse(String(init?.body))).toEqual({ apiKey: deepseekEntry.apiKey });

    vi.useFakeTimers();
    const props = { locale: "zh-CN", entries: [deepseekEntry], activeProvider: "deepseek", settings, onConfigureKey: vi.fn() } as const;
    view.rerender(<WhaleWidget {...props} phase="streaming" />);
    view.rerender(<WhaleWidget {...props} phase="idle" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("这一轮花了 ¥0.03"));
    fireEvent.click(screen.getByRole("button", { name: "余额小鲸鱼：¥9.97" }));
    expect(await screen.findByText("今日已用")).toBeInTheDocument();
    expect(screen.getByText("¥0.03")).toBeInTheDocument();
  });

  it("加载不到 CDN 素材时退回内置鲸鱼", () => {
    render(<WhaleWidget locale="zh-CN" entries={[]} phase="idle" settings={settings} onConfigureKey={vi.fn()} />);
    const body = screen.getByRole("button", { name: /余额小鲸鱼/u });
    fireEvent.error(body.querySelector("img")!);
    expect(body.querySelector("img")).toBeNull();
    expect(body.querySelector("svg")).not.toBeNull();
  });
});

describe("插件页", () => {
  it("开关写入本地设置，开启后可检查并更新素材版本", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.5.0" }), { status: 200 }));
    render(<PluginsPanel locale="zh-CN" hasDeepSeekKey={false} onConfigureKey={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "启用余额小鲸鱼" }));
    expect(getPluginSettings().whaleWidget.enabled).toBe(true);
    expect(screen.getByText("需要 DeepSeek 官方 API Key")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    fireEvent.click(await screen.findByRole("button", { name: "更新到 v0.5.0" }));
    expect(getPluginSettings().whaleWidget.assetVersion).toBe("0.5.0");
    expect(screen.getByRole("status")).toHaveTextContent("已更新到 v0.5.0");
  });

  it("非法版本号不会写进 CDN 地址", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ version: "../evil" }), { status: 200 }));
    await expect(checkWhaleAssetUpdate("0.4.2")).rejects.toThrow();
    localStorage.setItem("yachiyo-plugin-settings", JSON.stringify({ whaleWidget: { assetVersion: "x/../y" } }));
    expect(getPluginSettings().whaleWidget.assetVersion).toBe(DEFAULT_PLUGIN_SETTINGS.whaleWidget.assetVersion);
    saveWhaleWidgetSettings({ enabled: false });
  });
});
