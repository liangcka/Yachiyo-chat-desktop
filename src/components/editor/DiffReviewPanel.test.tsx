import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffReviewPanel } from "./DiffReviewPanel";

vi.mock("../../services/desktop-bridge", () => ({
  executeDesktopAgentTool: vi.fn().mockResolvedValue({ output: "", isError: false }),
  readHeadFile: vi.fn(),
}));

describe("变更审阅空状态", () => {
  it("没有变更时只显示说明和刷新入口", async () => {
    const { container } = render(<DiffReviewPanel resolvedTheme="dark" />);
    expect(await screen.findByText("工作区无未提交变更")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部重置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "应用采纳" })).not.toBeInTheDocument();
    expect(container.querySelector(".review-files")).toBeNull();
    expect(container.querySelector(".review-content")).toBeNull();
  });
});
