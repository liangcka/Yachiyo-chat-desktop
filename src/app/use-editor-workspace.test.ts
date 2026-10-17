import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorWorkspace } from "./use-editor-workspace";
import { executeDesktopAgentTool } from "../services/desktop-bridge";

vi.mock("../services/desktop-bridge", () => ({ executeDesktopAgentTool: vi.fn() }));

describe("编辑器工作区", () => {
  it("回滚后清空标签，再次打开从磁盘读取恢复内容", async () => {
    vi.mocked(executeDesktopAgentTool)
      .mockResolvedValueOnce({ output: "修改前" })
      .mockResolvedValueOnce({ output: "检查点内容" });
    const { result } = renderHook(() => useEditorWorkspace());
    await act(() => result.current.openFile("src/index.ts"));
    act(() => result.current.updateContent("src/index.ts", "未保存修改"));
    expect(result.current.dirtyCount).toBe(1);
    act(() => result.current.resetTabs());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activePath).toBeNull();
    await act(() => result.current.openFile("src/index.ts"));
    expect(result.current.activeTab?.content).toBe("检查点内容");
    expect(result.current.dirtyCount).toBe(0);
  });

  it("恢复时仍在读取的旧文件不会重新打开", async () => {
    let completeRead: ((value: { output: string }) => void) | undefined;
    vi.mocked(executeDesktopAgentTool).mockImplementationOnce(() => new Promise((resolve) => { completeRead = resolve; }));
    const { result } = renderHook(() => useEditorWorkspace());
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.openFile("src/old.ts"); });
    act(() => result.current.resetTabs());
    await act(async () => {
      completeRead?.({ output: "旧文件" });
      await pending;
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activePath).toBeNull();
  });
});
