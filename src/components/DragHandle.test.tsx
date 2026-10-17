import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DragHandle from "./DragHandle";

function pointer(handle: HTMLElement, type: string, clientX: number): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(handle, event);
}

describe("面板拖动分隔条", () => {
  afterEach(() => vi.restoreAllMocks());

  it("松开指针时提交尚未绘制的最后一段位移", () => {
    const onDrag = vi.fn();
    const onDragEnd = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(12);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    render(<DragHandle position="left" onDrag={onDrag} onDragEnd={onDragEnd} />);
    const handle = screen.getByRole("separator");
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    pointer(handle, "pointerdown", 100);
    pointer(handle, "pointermove", 135);
    pointer(handle, "pointerup", 140);
    expect(onDrag).toHaveBeenCalledExactlyOnceWith(40);
    expect(onDragEnd).toHaveBeenCalledOnce();
  });

  it("键盘调整也保存宽度，卸载取消未绘制的帧", () => {
    const onDrag = vi.fn();
    const onDragEnd = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(23);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const view = render(<DragHandle position="right" onDrag={onDrag} onDragEnd={onDragEnd} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onDrag).toHaveBeenCalledWith(-10);
    expect(onDragEnd).toHaveBeenCalledOnce();
    handle.setPointerCapture = vi.fn();
    pointer(handle, "pointerdown", 10);
    pointer(handle, "pointermove", 25);
    act(() => view.unmount());
    expect(cancel).toHaveBeenCalledWith(23);
  });
});
