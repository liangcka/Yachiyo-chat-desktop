import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { FollowUpContext } from "./review-context";
import { RunResultSummary } from "./RunResultSummary";
import { SupplementList } from "./SupplementList";

const failing: ChatMessage = {
  id: "a", conversationId: "c", role: "assistant", status: "complete", text: "改好了", createdAt: 1,
  toolSteps: [{
    id: "c1", name: "run_command", argumentsJson: JSON.stringify({ command: "npm test" }),
    result: {
      output: "", isError: true, durationMs: 2000,
      command: { executionId: "e", command: "npm test", cwd: "D:/demo", exitCode: 1, durationMs: 2000, endReason: "exited", exitConfirmed: true, outputBytes: 1, truncated: false },
    },
  }],
};

describe("运行结果区", () => {
  it("列出未解决的问题；最新回复可把问题作为新消息交给 Agent 继续处理", () => {
    const followUp = vi.fn();
    const { rerender } = render(<FollowUpContext.Provider value={followUp}><RunResultSummary message={failing} locale="zh-CN" latest /></FollowUpContext.Provider>);
    const region = screen.getByRole("region", { name: "1 个未解决的问题" });
    expect(region).toHaveTextContent("命令 npm test：退出码 1 · 2.0 秒");
    fireEvent.click(screen.getByRole("button", { name: "继续处理这些问题" }));
    expect(followUp).toHaveBeenCalledWith("继续完成任务，先处理以下未解决的问题：\n- 命令 npm test：退出码 1 · 2.0 秒");

    rerender(<FollowUpContext.Provider value={followUp}><RunResultSummary message={failing} locale="zh-CN" latest={false} /></FollowUpContext.Provider>);
    expect(screen.queryByRole("button", { name: "继续处理这些问题" })).toBeNull();
  });

  it("没有未解决的问题时不显示", () => {
    const { container } = render(<RunResultSummary message={{ ...failing, toolSteps: [] }} locale="ja-JP" latest />);
    expect(container).toBeEmptyDOMElement();
  });

  it("补充要求显示排队、已送达与未送达，未送达的可以作为新消息发送", () => {
    const followUp = vi.fn();
    render(<FollowUpContext.Provider value={followUp}>
      <SupplementList locale="zh-CN" supplements={[
        { id: "s1", text: "改日志级别", createdAt: 1, state: "delivered" },
        { id: "s2", text: "补一个用例", createdAt: 2, state: "queued" },
        { id: "s3", text: "更新 README", createdAt: 3, state: "undelivered" },
      ]} />
    </FollowUpContext.Provider>);
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["改日志级别已送达", "补一个用例排队中", "更新 README未送达作为新消息发送"]);
    fireEvent.click(screen.getByRole("button", { name: "作为新消息发送" }));
    expect(followUp).toHaveBeenCalledWith("更新 README");
  });
});
