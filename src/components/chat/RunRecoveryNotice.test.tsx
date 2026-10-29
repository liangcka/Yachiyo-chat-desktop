import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { FollowUpContext, OpenReviewContext } from "./review-context";
import { RunRecoveryNotice } from "./RunRecoveryNotice";

const interrupted: ChatMessage = {
  id: "a1", conversationId: "c1", role: "assistant", status: "stopped", text: "做到一半", createdAt: 1,
  run: { id: "run-1", workspace: "D:/alpha", executionMode: "confirm", startedAt: 1 },
  recovery: { status: "interrupted" },
  toolSteps: [
    { id: "r1", name: "read_file", argumentsJson: JSON.stringify({ path: "src/a.ts" }), result: { output: "", isError: false, durationMs: 1 } },
    { id: "w1", name: "write_file", argumentsJson: JSON.stringify({ path: "src/a.ts" }) },
    { id: "g1", name: "grep", argumentsJson: JSON.stringify({ pattern: "x" }) },
  ],
};

function renderNotice(message: ChatMessage, onRegenerate = vi.fn(), followUp = vi.fn(), openReview = vi.fn()) {
  render(
    <OpenReviewContext.Provider value={openReview}>
      <FollowUpContext.Provider value={followUp}>
        <RunRecoveryNotice message={message} locale="zh-CN" latest onRegenerate={onRegenerate} />
      </FollowUpContext.Provider>
    </OpenReviewContext.Provider>,
  );
  return { onRegenerate, followUp, openReview };
}

describe("运行恢复提示", () => {
  it("说明被中断并列出未确认结果的操作；继续任务把这些操作交给 Agent 先核实", () => {
    const { followUp, openReview } = renderNotice(interrupted);
    expect(screen.getByRole("status")).toHaveTextContent("任务在结束前被中断（应用退出或网关重启）。");
    expect(screen.getByRole("status")).toHaveTextContent("未确认结果的操作：write_file src/a.ts、grep（不会自动重放）");

    fireEvent.click(screen.getByRole("button", { name: "查看改动" }));
    expect(openReview).toHaveBeenCalledWith({ runId: "run-1", workspace: "D:/alpha" });

    fireEvent.click(screen.getByRole("button", { name: "继续任务" }));
    const prompt = followUp.mock.calls[0]![0] as string;
    expect(prompt).toContain("以下操作没有确认结果：\n- write_file src/a.ts\n- grep");
    expect(prompt).toContain("不要假设它们已执行或未执行");
  });

  it("存在未确认的写入时，重新尝试要先确认，取消则不执行", () => {
    const { onRegenerate } = renderNotice(interrupted);
    fireEvent.click(screen.getByRole("button", { name: "重新尝试" }));
    expect(onRegenerate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("重新执行可能重复写入：write_file src/a.ts");
    expect(dialog).not.toHaveTextContent("grep");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onRegenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新尝试" }));
    fireEvent.click(screen.getAllByRole("button", { name: "重新尝试" }).at(-1)!);
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("没有未确认的写入时直接重新尝试；重连中只显示重连状态", () => {
    const { onRegenerate } = renderNotice({ ...interrupted, recovery: { status: "unknown" }, toolSteps: [] });
    expect(screen.getByRole("status")).toHaveTextContent("无法确认任务结果");
    fireEvent.click(screen.getByRole("button", { name: "重新尝试" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("连接中断正在重连时只说明重连", () => {
    renderNotice({ ...interrupted, status: "streaming", recovery: undefined, reconnecting: true } as ChatMessage);
    expect(screen.getByRole("status")).toHaveTextContent("与本地网关的连接中断，正在重新连接…");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
