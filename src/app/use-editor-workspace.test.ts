import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorWorkspace } from "./use-editor-workspace";
import { readWorkspaceFile, writeWorkspaceFile, type WorkspaceFileView } from "../services/desktop-bridge";
import { emitWorkspaceFilesChanged } from "../services/workspace-events";

vi.mock("../services/desktop-bridge", () => ({ readWorkspaceFile: vi.fn(), writeWorkspaceFile: vi.fn() }));

function file(content: string, digest = `d-${content}`, extra: Partial<WorkspaceFileView> = {}): WorkspaceFileView {
  return { present: true, content, digest, lossless: true, bom: false, ...extra };
}

describe("编辑器工作区", () => {
  beforeEach(() => {
    vi.mocked(readWorkspaceFile).mockReset();
    vi.mocked(writeWorkspaceFile).mockReset();
  });

  it("回滚后清空标签，再次打开从磁盘读取恢复内容", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce(file("修改前")).mockResolvedValueOnce(file("检查点内容"));
    const { result } = renderHook(() => useEditorWorkspace("D:/alpha"));
    await act(() => result.current.openFile("src/index.ts"));
    const key = result.current.activeTab!.key;
    act(() => result.current.updateContent(key, "未保存修改"));
    expect(result.current.dirtyCount).toBe(1);
    act(() => result.current.resetTabs());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activePath).toBeNull();
    await act(() => result.current.openFile("src/index.ts"));
    expect(result.current.activeTab?.content).toBe("检查点内容");
    expect(result.current.dirtyCount).toBe(0);
  });

  it("恢复时仍在读取的旧文件不会重新打开", async () => {
    let completeRead: ((value: WorkspaceFileView) => void) | undefined;
    vi.mocked(readWorkspaceFile).mockImplementationOnce(() => new Promise((resolve) => { completeRead = resolve; }));
    const { result } = renderHook(() => useEditorWorkspace("D:/alpha"));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.openFile("src/old.ts"); });
    act(() => result.current.resetTabs());
    await act(async () => {
      completeRead?.(file("旧文件"));
      await pending;
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activePath).toBeNull();
  });

  it("不同项目的同名文件是两个标签，保存写回标签所属的项目并核对版本", async () => {
    vi.mocked(readWorkspaceFile).mockImplementation(async (workspace) => file(`${workspace} 的内容`, `digest-${workspace}`));
    vi.mocked(writeWorkspaceFile).mockResolvedValue({ ok: true, digest: "digest-after-save" });
    const { result, rerender } = renderHook(({ workspace }) => useEditorWorkspace(workspace), {
      initialProps: { workspace: "D:/alpha" as string | null },
    });
    await act(() => result.current.openFile("README.md"));
    const alphaKey = result.current.activeTab!.key;
    act(() => result.current.updateContent(alphaKey, "alpha 未保存修改"));

    rerender({ workspace: "D:/beta" });
    expect(result.current.tabs).toEqual([]);
    await act(() => result.current.openFile("README.md"));
    expect(result.current.activeTab?.content).toBe("D:/beta 的内容");
    expect(result.current.activeTab?.key).not.toBe(alphaKey);

    await act(async () => { await result.current.saveTab(alphaKey); });
    expect(writeWorkspaceFile).toHaveBeenLastCalledWith("D:/alpha", "README.md", "alpha 未保存修改", "digest-D:/alpha", false);

    rerender({ workspace: "D:/alpha" });
    expect(result.current.tabs.map((tab) => tab.workspace)).toEqual(["D:/alpha"]);
    expect(result.current.activeTab).toMatchObject({ content: "alpha 未保存修改", digest: "digest-after-save" });
    expect(result.current.dirtyCount).toBe(0);
  });

  it("磁盘版本已变化时保存标记冲突且不覆盖，重新加载后才可继续", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce(file("原文")).mockResolvedValueOnce(file("别处的修改"));
    vi.mocked(writeWorkspaceFile).mockResolvedValue({ ok: false, conflict: true, error: "文件 'a.ts' 已在别处被修改" });
    const { result } = renderHook(() => useEditorWorkspace("D:/alpha"));
    await act(() => result.current.openFile("a.ts"));
    const key = result.current.activeTab!.key;
    act(() => result.current.updateContent(key, "我的修改"));
    await act(async () => { expect(await result.current.saveTab(key)).toBe(false); });
    expect(result.current.activeTab?.conflict).toContain("已在别处被修改");
    await act(async () => { expect(await result.current.saveTab(key)).toBe(false); });
    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1);

    await act(() => result.current.reloadTab(key));
    expect(result.current.activeTab).toMatchObject({ content: "别处的修改", savedContent: "别处的修改", revision: 1 });
    expect(result.current.activeTab?.conflict).toBeUndefined();
  });

  it("非 UTF-8 文件以只读打开，避免保存时改变编码", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce(file("你好", "d", { lossless: false }));
    const { result } = renderHook(() => useEditorWorkspace("D:/alpha"));
    await act(() => result.current.openFile("gbk.txt"));
    expect(result.current.activeTab).toMatchObject({ readOnly: true, readOnlyReason: "encoding" });
  });

  it("文件在别处被修改后：未修改的标签自动重新加载，有未保存修改的标签标记冲突", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce(file("a 原文"))
      .mockResolvedValueOnce(file("b 原文"))
      .mockResolvedValue(file("撤销后的内容", "d-new"));
    const { result } = renderHook(() => useEditorWorkspace("D:/alpha"));
    await act(() => result.current.openFile("a.ts"));
    await act(() => result.current.openFile("b.ts"));
    const bKey = result.current.tabs.find((tab) => tab.path === "b.ts")!.key;
    act(() => result.current.updateContent(bKey, "b 未保存"));

    act(() => emitWorkspaceFilesChanged({ workspace: "D:/alpha", paths: ["a.ts", "b.ts"] }));
    await waitFor(() => expect(result.current.tabs.find((tab) => tab.path === "a.ts")?.content).toBe("撤销后的内容"));
    await waitFor(() => expect(result.current.tabs.find((tab) => tab.path === "b.ts")?.conflict).toBeDefined());
    expect(result.current.tabs.find((tab) => tab.path === "b.ts")?.content).toBe("b 未保存");
  });

  it("没有项目时不读取文件", async () => {
    const { result } = renderHook(() => useEditorWorkspace(null));
    await act(() => result.current.openFile("README.md"));
    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(result.current.tabs).toEqual([]);
  });
});
