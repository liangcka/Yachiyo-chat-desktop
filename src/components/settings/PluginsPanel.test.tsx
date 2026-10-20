import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsPanel } from "./PluginsPanel";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

beforeEach(() => {
  invoke.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("插件页 · 电脑控制", () => {
  it("网页版不显示电脑控制", () => {
    render(<PluginsPanel locale="zh-CN" hasDeepSeekKey onConfigureKey={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: "启用电脑控制" })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("桌面端读取并切换电脑控制开关", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    invoke.mockImplementation(async (command: string) =>
      command === "get_computer_control_state" ? { supported: true, enabled: true, reason: null } : undefined,
    );
    render(<PluginsPanel locale="zh-CN" hasDeepSeekKey onConfigureKey={vi.fn()} />);

    const toggle = await screen.findByRole("switch", { name: "启用电脑控制" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_computer_control_enabled", { enabled: false }));
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("不支持的系统显示原因并禁用开关", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    invoke.mockResolvedValue({ supported: false, enabled: true, reason: "桌面控制目前仅支持 Windows" });
    render(<PluginsPanel locale="zh-CN" hasDeepSeekKey onConfigureKey={vi.fn()} />);

    expect(await screen.findByRole("switch", { name: "启用电脑控制" })).toBeDisabled();
    expect(screen.getByText("当前系统不可用：桌面控制目前仅支持 Windows")).toBeInTheDocument();
  });
});
