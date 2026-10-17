import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckpointPanel } from "./CheckpointPanel";
import { listCheckpoints, restoreCheckpoint } from "../../services/checkpoint-client";

vi.mock("../../services/project-manager", () => ({
  useProjectState: () => ({ activeProject: "D:/work/project", recentProjects: [] }),
}));
vi.mock("../../services/checkpoint-client", () => ({
  listCheckpoints: vi.fn(),
  restoreCheckpoint: vi.fn(),
}));

describe("文件检查点", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCheckpoints).mockResolvedValue([{ id: "run-1-2", runId: "run-1", turn: 2, createdAt: 1_700_000_000_000 }]);
    vi.mocked(restoreCheckpoint).mockResolvedValue(undefined);
  });

  it("确认后才恢复，成功后刷新文件视图", async () => {
    const user = userEvent.setup();
    const onRestored = vi.fn();
    render(<CheckpointPanel isRunning={false} onRestored={onRestored} />);
    await user.click(await screen.findByRole("button", { name: "退回第 2 轮之前" }));
    expect(restoreCheckpoint).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(restoreCheckpoint).toHaveBeenCalledExactlyOnceWith("D:/work/project", "run-1-2"));
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it("任务运行时不可恢复，后端拒绝恢复时保留错误说明", async () => {
    const user = userEvent.setup();
    vi.mocked(restoreCheckpoint).mockRejectedValue(new Error("工作区正在执行任务，请停止任务后再恢复或修改文件。"));
    const view = render(<CheckpointPanel isRunning />);
    expect(await screen.findByRole("button", { name: "退回第 2 轮之前" })).toBeDisabled();
    view.rerender(<CheckpointPanel isRunning={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "退回第 2 轮之前" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "退回第 2 轮之前" }));
    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("工作区正在执行任务");
  });
});
