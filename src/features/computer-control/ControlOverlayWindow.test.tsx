import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlOverlayState } from "../../services/desktop-bridge";
import { ControlOverlayWindow } from "./ControlOverlayWindow";

const bridge = vi.hoisted(() => ({
  current: null as ControlOverlayState | null,
  push: undefined as ((state: ControlOverlayState) => void) | undefined,
  setHitRegion: vi.fn<(region: unknown) => Promise<boolean>>(async () => true),
  stop: vi.fn(async () => true),
}));

vi.mock("../../services/desktop-bridge", () => ({
  getControlOverlayState: vi.fn(async () => bridge.current),
  onControlOverlayStateChange: vi.fn(async (callback: (state: ControlOverlayState) => void) => {
    bridge.push = callback;
    return () => {
      bridge.push = undefined;
    };
  }),
  setOverlayHitRegion: bridge.setHitRegion,
  stopActiveControl: bridge.stop,
}));

describe("ControlOverlayWindow", () => {
  beforeEach(() => {
    bridge.current = null;
    bridge.setHitRegion.mockClear();
    bridge.stop.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing until the control state turns active", () => {
    render(<ControlOverlayWindow />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores the current state on load and reports the banner hit region", async () => {
    bridge.current = { active: true, toolName: "mcp__windows_mcp__click", detail: "正在模拟鼠标点击 (1, 2)" };
    render(<ControlOverlayWindow />);

    expect(await screen.findByText("正在模拟鼠标点击 (1, 2)")).toBeInTheDocument();
    await waitFor(() => expect(bridge.setHitRegion).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0 })));
  });

  it("takes over on click and clears the hit region once inactive", async () => {
    render(<ControlOverlayWindow />);
    await waitFor(() => expect(bridge.push).toBeDefined());
    bridge.push?.({ active: true, toolName: "mcp__windows_mcp__type", detail: "正在模拟键盘键入文本" });

    await userEvent.click(await screen.findByRole("button", { name: "立即接管电脑控制" }));

    expect(bridge.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(bridge.setHitRegion).toHaveBeenLastCalledWith(null);
  });
});
