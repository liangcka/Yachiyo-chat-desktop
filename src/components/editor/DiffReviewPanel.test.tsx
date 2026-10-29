import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiffReviewPanel } from "./DiffReviewPanel";
import { executeDesktopAgentTool, readHeadFile, readWorkspaceFile } from "../../services/desktop-bridge";

vi.mock("../../services/desktop-bridge", () => ({
  executeDesktopAgentTool: vi.fn(),
  readHeadFile: vi.fn(),
  readWorkspaceFile: vi.fn(),
}));

describe("工作区差异（相对 HEAD）", () => {
  beforeEach(() => {
    vi.mocked(executeDesktopAgentTool).mockReset().mockResolvedValue({ output: "", isError: false });
    vi.mocked(readHeadFile).mockReset();
    vi.mocked(readWorkspaceFile).mockReset();
  });

  it("没有变更时只显示说明", async () => {
    const { container } = render(<DiffReviewPanel workspace="D:/demo" resolvedTheme="dark" />);
    expect(await screen.findByText("没有未提交的改动")).toBeInTheDocument();
    expect(container.querySelector(".review-files")).toBeNull();
    expect(container.querySelector(".review-content")).toBeNull();
  });

  it("只读显示差异，不提供任何写回入口；删除的文件也能查看", async () => {
    vi.mocked(executeDesktopAgentTool).mockResolvedValue({ output: " M src/app.ts\n D old.ts\n", isError: false });
    vi.mocked(readHeadFile).mockResolvedValue({ present: true, content: "a\nb\n" });
    vi.mocked(readWorkspaceFile).mockResolvedValue({ present: true, content: "a\nB\n", digest: "d", lossless: true, bom: false });

    render(<DiffReviewPanel workspace="D:/demo" resolvedTheme="dark" />);
    expect(await screen.findByText("B")).toBeInTheDocument();
    expect(screen.getByText(/只读：包含任务开始前就有的改动/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /old\.ts/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /采纳|拒绝|应用|撤销/ })).toBeNull();
    expect(readWorkspaceFile).toHaveBeenCalledWith("D:/demo", "src/app.ts");
  });
});
