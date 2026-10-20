import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlOverlayState } from "../../services/desktop-bridge";
import { ControlOverlayWindow } from "./ControlOverlayWindow";

const bridge = vi.hoisted(() => ({
  current: null as ControlOverlayState | null,
  push: undefined as ((state: ControlOverlayState) => void) | undefined,
  moveCursor: undefined as ((position: { x: number; y: number }) => void) | undefined,
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
}));

function overlayCursor(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".fullscreen-control-window__cursor");
}

describe("ControlOverlayWindow", () => {
  beforeEach(() => {
    bridge.current = null;
  });

  it("renders nothing until the control state turns active", () => {
    render(<ControlOverlayWindow />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the single-line status with the Esc hint and no buttons, and follows the cursor", async () => {
    bridge.current = { active: true, paused: false };
    render(<ControlOverlayWindow />);

    expect(await screen.findByText("八千代正在控制你的电脑")).toBeInTheDocument();
    expect(screen.getByText("按 Esc 取消控制")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    // 收到坐标后八千代光标显示并定位
    await waitFor(() => expect(bridge.moveCursor).toBeDefined());
    bridge.moveCursor?.({ x: 120, y: 80 });
    expect(overlayCursor()?.style.transform).toBe("translate(120px, 80px)");
    expect(overlayCursor()?.style.opacity).toBe("1");
  });

  it("keeps the status bar but hides the overlay cursor while paused, and disappears once inactive", async () => {
    render(<ControlOverlayWindow />);
    await waitFor(() => expect(bridge.push).toBeDefined());

    act(() => bridge.push?.({ active: true, paused: true }));
    expect(await screen.findByText("八千代正在控制你的电脑")).toBeInTheDocument();
    expect(overlayCursor()).toBeNull();

    act(() => bridge.push?.({ active: true, paused: false }));
    expect(overlayCursor()).not.toBeNull();

    act(() => bridge.push?.({ active: false, paused: false }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
