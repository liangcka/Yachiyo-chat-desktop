import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskReviewPanel } from "./TaskReviewPanel";
import {
  keepRunChange,
  listRunChanges,
  readRunChange,
  restoreRunChange,
  revertRunChange,
  revertRunChanges,
  type RunChangeContent,
  type RunFileChange,
} from "../../services/desktop-bridge";
import { subscribeWorkspaceFilesChanged, type WorkspaceFilesChanged } from "../../services/workspace-events";

vi.mock("../../services/desktop-bridge", () => ({
  listRunChanges: vi.fn(),
  readRunChange: vi.fn(),
  revertRunChange: vi.fn(),
  revertRunChanges: vi.fn(),
  keepRunChange: vi.fn(),
  restoreRunChange: vi.fn(),
}));

const baseline = `${Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
const current = baseline.replace("line 2\n", "line 2 Agent 一\n").replace("line 28\n", "line 28 Agent 二\n");

function change(extra: Partial<RunFileChange> = {}): RunFileChange {
  return {
    path: "src/app.ts",
    kind: "modified",
    state: "agent",
    source: "file_tool",
    calls: ["call-1"],
    baseline: { present: true, digest: "d-base" },
    current: { present: true, digest: "d-current" },
    ...extra,
  };
}

function content(entry: RunFileChange, before = baseline, after = current): RunChangeContent {
  return {
    change: entry,
    baseline: { present: entry.baseline.present, content: before, digest: "d-base", lossless: true, bom: false },
    current: { present: entry.current.present, content: after, digest: "d-current", lossless: true, bom: false },
  };
}

describe("本次任务改动审阅", () => {
  beforeEach(() => {
    vi.mocked(listRunChanges).mockReset();
    vi.mocked(readRunChange).mockReset();
    vi.mocked(revertRunChange).mockReset();
    vi.mocked(revertRunChanges).mockReset();
    vi.mocked(keepRunChange).mockReset();
    vi.mocked(restoreRunChange).mockReset();
  });

  it("只撤销所选块：提交按块合并后的内容并核对当前版本，未选块保持现状", async () => {
    const entry = change();
    vi.mocked(listRunChanges).mockResolvedValue([entry]);
    vi.mocked(readRunChange).mockResolvedValue(content(entry));
    vi.mocked(revertRunChange).mockResolvedValue({ ok: true, change: { ...entry, state: "reviewed" } });
    const events: WorkspaceFilesChanged[] = [];
    const unsubscribe = subscribeWorkspaceFilesChanged((event) => events.push(event));

    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    const picks = await screen.findAllByRole("checkbox", { name: "撤销此块" });
    expect(picks).toHaveLength(2);
    expect(screen.getByRole("button", { name: /撤销所选块/ })).toBeDisabled();
    fireEvent.click(picks[0]!);
    fireEvent.click(screen.getByRole("button", { name: /撤销所选块/ }));

    await waitFor(() => expect(revertRunChange).toHaveBeenCalledOnce());
    expect(revertRunChange).toHaveBeenCalledWith("D:/alpha", "run-1", "src/app.ts", "d-current", baseline.replace("line 28\n", "line 28 Agent 二\n"));
    expect(await screen.findByText("已撤销所选改动，其余改动保持不变。")).toBeInTheDocument();
    expect(events).toContainEqual({ workspace: "D:/alpha", paths: ["src/app.ts"] });
    unsubscribe();
  });

  it("磁盘版本已变化时不覆盖，显示原因并重新读取", async () => {
    const entry = change();
    vi.mocked(listRunChanges).mockResolvedValue([entry]);
    vi.mocked(readRunChange).mockResolvedValue(content(entry));
    vi.mocked(revertRunChange).mockResolvedValue({ ok: false, conflict: true, error: "文件 'src/app.ts' 已在别处被修改" });

    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /撤销整个文件/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("未覆盖：文件 'src/app.ts' 已在别处被修改");
    expect(revertRunChange).toHaveBeenCalledWith("D:/alpha", "run-1", "src/app.ts", "d-current");
    await waitFor(() => expect(listRunChanges).toHaveBeenCalledTimes(2));
  });

  it("冲突文件不提供撤销与保留，只说明原因", async () => {
    const entry = change({ state: "conflict" });
    vi.mocked(listRunChanges).mockResolvedValue([entry]);
    vi.mocked(readRunChange).mockResolvedValue(content(entry));

    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("不能直接撤销");
    expect(screen.queryByRole("button", { name: /撤销/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /保留/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("新文件撤销即删除；保留只记录审阅结果，不写文件内容", async () => {
    const added = change({ path: "src/new.ts", kind: "added", baseline: { present: false } });
    const modified = change();
    vi.mocked(listRunChanges).mockResolvedValue([added, modified]);
    vi.mocked(readRunChange).mockImplementation(async (_workspace, _run, path) => (path === "src/new.ts" ? content(added, "", "export {};\n") : content(modified)));
    vi.mocked(revertRunChange).mockResolvedValue({ ok: true, change: { ...added, state: "reverted" } });
    vi.mocked(keepRunChange).mockResolvedValue({ ok: true, change: { ...modified, state: "reviewed" } });

    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /撤销（删除新文件）/ }));
    await waitFor(() => expect(revertRunChange).toHaveBeenCalledWith("D:/alpha", "run-1", "src/new.ts", "d-current"));

    fireEvent.click(screen.getByRole("button", { name: /src\/app\.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: /保留/ }));
    await waitFor(() => expect(keepRunChange).toHaveBeenCalledWith("D:/alpha", "run-1", "src/app.ts", "d-current"));
  });

  it("已撤销的文件可以恢复 Agent 版本，恢复前读取最新版本摘要", async () => {
    const entry = change({ state: "reverted" });
    vi.mocked(listRunChanges).mockResolvedValue([entry]);
    vi.mocked(readRunChange).mockResolvedValue(content(entry, baseline, baseline));
    vi.mocked(restoreRunChange).mockResolvedValue({ ok: true, change: { ...entry, state: "agent" } });

    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /恢复 Agent 版本/ }));
    await waitFor(() => expect(restoreRunChange).toHaveBeenCalledWith("D:/alpha", "run-1", "src/app.ts", "d-current"));
  });

  it("撤销全部待处理只提交待处理文件及其版本，已处理与冲突的文件不在其中", async () => {
    const pendingA = change({ path: "a.ts", current: { present: true, digest: "d-a" } });
    const pendingB = change({ path: "b.ts", kind: "added", baseline: { present: false }, current: { present: true, digest: "d-b" } });
    const kept = change({ path: "c.ts", state: "reviewed" });
    const conflict = change({ path: "d.ts", state: "conflict" });
    vi.mocked(listRunChanges).mockResolvedValue([pendingA, pendingB, kept, conflict]);
    vi.mocked(readRunChange).mockResolvedValue(content(pendingA));
    vi.mocked(revertRunChanges).mockResolvedValue({ ok: false, conflict: true, error: "文件 'a.ts' 已在别处被修改，请刷新后再处理。没有撤销任何文件。" });

    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /撤销全部待处理（2）/ }));
    await waitFor(() => expect(revertRunChanges).toHaveBeenCalledWith("D:/alpha", "run-1", [
      { path: "a.ts", expectedDigest: "d-a" },
      { path: "b.ts", expectedDigest: "d-b" },
    ]));
    expect(await screen.findByRole("alert")).toHaveTextContent("未覆盖：文件 'a.ts' 已在别处被修改，请刷新后再处理。没有撤销任何文件。");
  });

  it("没有改动时说明只显示本任务的改动", async () => {
    vi.mocked(listRunChanges).mockResolvedValue([]);
    render(<TaskReviewPanel workspace="D:/alpha" runId="run-1" />);
    expect(await screen.findByText("本次任务没有改动文件")).toBeInTheDocument();
  });
});
