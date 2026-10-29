import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FollowUpContext } from "./review-context";
import { RunNotes } from "./RunNotes";

describe("运行提示", () => {
  it("说明上下文压缩与交付前的执行反馈", () => {
    render(<RunNotes locale="zh-CN" latest notes={[
      { kind: "context_compacted", foldedTurns: 3, beforeTokens: 92_000, afterTokens: 41_000 },
      { kind: "verification_reminder", reason: "not_verified", files: ["src/lib.rs"] },
      { kind: "verification_reminder", reason: "verification_failed", command: "cargo test" },
    ]} />);
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "上下文已压缩：折叠了 3 轮较早的步骤（约 92k → 41k tokens），目标、补充要求、改动文件与失败记录保留在摘要中。",
      "Agent 准备结束时，修改的代码尚未验证（src/lib.rs），已提醒它先验证。",
      "最近一次验证未通过（cargo test），已提醒 Agent 处理后再交付。",
    ]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("上下文超限停止时，最新回复可继续任务", () => {
    const followUp = vi.fn();
    const { rerender } = render(<FollowUpContext.Provider value={followUp}>
      <RunNotes locale="ja-JP" latest notes={[{ kind: "context_overflow", tokens: 70_000, budgetTokens: 60_000 }]} />
    </FollowUpContext.Provider>);
    expect(screen.getByRole("listitem")).toHaveTextContent("文脈がモデルのウィンドウに収まらないため停止しました（約 70k tokens、上限 60k）。");
    fireEvent.click(screen.getByRole("button", { name: "タスクを続ける" }));
    expect(followUp).toHaveBeenCalledWith(expect.stringContaining("残りの作業を続けてください"));
    rerender(<FollowUpContext.Provider value={followUp}>
      <RunNotes locale="ja-JP" latest={false} notes={[{ kind: "context_overflow", tokens: 70_000, budgetTokens: 60_000 }]} />
    </FollowUpContext.Provider>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
