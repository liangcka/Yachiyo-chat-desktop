import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlOverlayState } from "../../services/desktop-bridge";
import { ControlOverlayWindow } from "./ControlOverlayWindow";

const bridge = vi.hoisted(() => ({
  current: null as ControlOverlayState | null,
  push: undefined as ((state: ControlOverlayState) => void) | undefined,
  moveCursor: undefined as ((position: { x: number; y: number }) => void) | undefined,
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
  onOverlayCursorMove: vi.fn(async (callback: (position: { x: number; y: number }) => void) => {
    bridge.moveCursor = callback;
    return () => {
      bridge.moveCursor = undefined;
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

  it("shows the single-line status, reports the banner hit region, and follows the cursor", async () => {
    bridge.current = { active: true, toolName: "mcp__windows_mcp__click", detail: "正在模拟鼠标点击 (1, 2)" };
    render(<ControlOverlayWindow />);

    expect(await screen.findByText("八千代正在控制你的电脑")).toBeInTheDocument();
    await waitFor(() => expect(bridge.setHitRegion).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0 })));

    // 收到坐标后独立光标显示并定位
    await waitFor(() => expect(bridge.moveCursor).toBeDefined());
    bridge.moveCursor?.({ x: 120, y: 80 });
    const cursor = document.querySelector<HTMLElement>(".fullscreen-control-window__cursor");
    expect(cursor?.style.transform).toBe("translate(120px, 80px)");
    expect(cursor?.style.opacity).toBe("1");
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
