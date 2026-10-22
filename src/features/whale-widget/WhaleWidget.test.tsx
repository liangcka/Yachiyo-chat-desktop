import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginsPanel } from "../../components/settings/PluginsPanel";
import { getPluginSettings } from "../../services/plugin-settings";
import { WhaleWidget } from "./WhaleWidget";
import { ensureWhaleWidget } from "./runtime";

const deepseekEntry = { id: "deepseek", provider: "deepseek" as const, apiKey: "sk-" + "w".repeat(40), model: "deepseek-flash" };

describe("WhaleWidget", () => {
  it("加载上游脚本，由本机宿主接管 /dsh-whale/* 请求，卸载时隐藏挂件", async () => {
    const view = render(
      <WhaleWidget
        entries={[deepseekEntry]}
        activeProvider="deepseek"
        phase="idle"
        messages={[]}
        conversationTitle="写周报"
        pendingPermissionId="req-1"
      />,
    );
    const script = document.head.querySelector<HTMLScriptElement>('script[src*="whale-widget"]');
    expect(script).not.toBeNull();
    expect(document.documentElement).not.toHaveAttribute("data-whale-hidden");

    const wait = (await (await fetch("/dsh-whale/wait.json")).json()) as Record<string, unknown>;
    expect(wait).toMatchObject({ ok: true, pending: { kind: "approval", id: "req-1" }, sessionName: "写周报" });

    view.unmount();
    expect(document.documentElement).toHaveAttribute("data-whale-hidden");
    expect(await (await fetch("/dsh-whale/wait.json")).json()).toMatchObject({ pending: null });

    // 再次挂载复用同一份脚本
    render(<WhaleWidget entries={[]} phase="idle" messages={[]} />);
    expect(document.head.querySelectorAll('script[src*="whale-widget"]')).toHaveLength(1);
    expect(document.documentElement).not.toHaveAttribute("data-whale-hidden");
  });
});

describe("头顶的盆", () => {
  it("挂件出现后插进身体，点击由盆认领而不触发上游的拖动", async () => {
    ensureWhaleWidget();
    const upstreamPointerDown = vi.fn();
    document.addEventListener("pointerdown", upstreamPointerDown, true);

    const root = document.createElement("div");
    root.className = "dshwv-root";
    const body = document.createElement("div");
    body.className = "dshwv-body";
    const img = document.createElement("img");
    img.className = "dshwv-img";
    img.src = "/dsh-whale/image.png?v=2";
    body.append(img);
    root.append(body);
    document.body.append(root);
    await Promise.resolve();

    expect(img).toHaveAttribute("data-whale-src", "/dsh-whale/image.png?v=2");
    const bowl = screen.getByRole("button", { name: "敲一下小鲸鱼头上的盆" });
    expect(bowl.previousElementSibling).toBe(img);

    fireEvent.pointerDown(bowl, { button: 0 });
    expect(upstreamPointerDown).not.toHaveBeenCalled();
    fireEvent.click(bowl);
    expect(bowl).toHaveClass("yachiyo-whale-bowl--knock");

    document.removeEventListener("pointerdown", upstreamPointerDown, true);
    root.remove();
  });
});

describe("插件页", () => {
  it("开关写入本地设置，未配置 DeepSeek Key 时引导去配置", () => {
    const onConfigureKey = vi.fn();
    render(<PluginsPanel locale="zh-CN" hasDeepSeekKey={false} onConfigureKey={onConfigureKey} />);
    expect(screen.queryByText("需要 DeepSeek 官方 API Key")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "启用余额小鲸鱼" }));
    expect(getPluginSettings().whaleWidget.enabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "去配置" }));
    expect(onConfigureKey).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("switch", { name: "启用余额小鲸鱼" }));
    expect(getPluginSettings().whaleWidget.enabled).toBe(false);
  });
});
