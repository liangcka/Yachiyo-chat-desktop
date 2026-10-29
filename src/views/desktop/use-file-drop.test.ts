import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopFileDropEvent } from "../../services/desktop-bridge";
import { useFileDrop } from "./use-file-drop";

const bridge = vi.hoisted(() => ({
  emit: undefined as ((event: DesktopFileDropEvent) => void) | undefined,
  unlisten: vi.fn(),
}));
vi.mock("../../services/desktop-bridge", () => ({
  onDesktopFileDrop: vi.fn(async (callback: (event: DesktopFileDropEvent) => void) => {
    bridge.emit = callback;
    return bridge.unlisten;
  }),
}));

function dragEvent(files: File[] = []): DragEvent {
  return { dataTransfer: { types: ["Files"], files }, preventDefault: vi.fn() } as unknown as DragEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  bridge.emit = undefined;
  bridge.unlisten.mockClear();
});

describe("useFileDrop 桌面端", () => {
  it("系统拖入时高亮，放下后交出路径，卸载时注销监听", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const onPaths = vi.fn();
    const { result, unmount } = renderHook(() => useFileDrop({ enabled: true, onPaths, onFiles: vi.fn() }));
    await vi.waitFor(() => expect(bridge.emit).toBeDefined());

    act(() => bridge.emit?.({ type: "enter", paths: ["D:\\a.png"] }));
    expect(result.current.active).toBe(true);
    act(() => bridge.emit?.({ type: "leave" }));
    expect(result.current.active).toBe(false);

    act(() => bridge.emit?.({ type: "drop", paths: ["D:\\a.png", "D:\\b.mp4"] }));
    expect(onPaths).toHaveBeenCalledWith(["D:\\a.png", "D:\\b.mp4"]);
    expect(result.current.active).toBe(false);

    unmount();
    expect(bridge.unlisten).toHaveBeenCalled();
  });

  it("输入区不可用时不高亮也不接收文件", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const onPaths = vi.fn();
    const { result } = renderHook(() => useFileDrop({ enabled: false, onPaths, onFiles: vi.fn() }));
    await vi.waitFor(() => expect(bridge.emit).toBeDefined());
    act(() => bridge.emit?.({ type: "enter", paths: ["D:\\a.png"] }));
    expect(result.current.active).toBe(false);
    act(() => bridge.emit?.({ type: "drop", paths: ["D:\\a.png"] }));
    expect(onPaths).not.toHaveBeenCalled();
  });
});

describe("useFileDrop 网页端", () => {
  it("子元素间进出不提前取消高亮，放下时交出 File", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop({ enabled: true, onPaths: vi.fn(), onFiles }));
    act(() => result.current.handlers.onDragEnter(dragEvent()));
    act(() => result.current.handlers.onDragEnter(dragEvent()));
    act(() => result.current.handlers.onDragLeave(dragEvent()));
    expect(result.current.active).toBe(true);

    const file = new File(["x"], "a.txt");
    const drop = dragEvent([file]);
    act(() => result.current.handlers.onDrop(drop));
    expect(drop.preventDefault).toHaveBeenCalled();
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(result.current.active).toBe(false);
  });
});
