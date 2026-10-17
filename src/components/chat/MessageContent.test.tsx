import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { ConversationView } from "../ConversationView";
import { MessageContent } from "./MessageContent";

function agentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "agent", conversationId: "one", createdAt: 1, role: "assistant", status: "complete",
    text: "先检查。已检查。最终回答。", thought: "检查配置。整理结果。",
    toolSteps: [
      { id: "one", name: "read_file", argumentsJson: '{"path":"config.ts"}', result: { output: "ok", isError: false, durationMs: 10 } },
      { id: "two", name: "run_command", argumentsJson: '{"command":"check"}', result: { output: "配置缺失", isError: true, durationMs: 20 } },
    ],
    contentSegments: [
      { type: "thought", start: 0, end: 5, startedAtMs: 0, endedAtMs: 500 },
      { type: "text", start: 0, end: 4 },
      { type: "tool", toolId: "one" },
      { type: "text", start: 4, end: 8 },
      { type: "tool", toolId: "two" },
      { type: "thought", start: 5, end: 10, startedAtMs: 24000, endedAtMs: 25000 },
      { type: "text", start: 8, end: 13 },
    ],
    ...overrides,
  };
}

describe("MessageContent 过程摘要", () => {
  it("完成后仅展开最终回答，摘要展开后保留原有顺序", () => {
    const { container } = render(<MessageContent message={agentMessage()} locale="zh-CN" hideCitations={false} />);
    const summary = screen.getByText("已处理 25 秒 · 运行 2 步").closest("summary")!;
    expect(summary).toHaveTextContent("· 1 步失败");
    expect(screen.getByText("最终回答。")).toBeVisible();
    expect(screen.getByText("先检查。")).not.toBeVisible();
    fireEvent.click(summary);
    const process = container.querySelector(".message-process__content")!;
    expect([...process.children].map((node) => node.textContent)).toEqual([
      "思考了不到 1 秒", "先检查。", expect.stringContaining("已运行 1 步"),
      "已检查。", expect.stringContaining("1 项失败"), "思考了 1 秒",
    ]);
    expect(screen.getByText("先检查。")).toBeVisible();
    const failedGroup = screen.getByText("1 项失败").closest("details")!;
    fireEvent.click(failedGroup.querySelector("summary")!);
    fireEvent.click(screen.getByRole("button", { name: /运行 `check`/ }));
    expect(screen.getByText("配置缺失")).toBeVisible();
    fireEvent.click(summary);
    expect(screen.getByText("先检查。")).not.toBeVisible();
    expect(screen.getByText("最终回答。")).toBeVisible();
  });

  it("流式阶段保持逐段展示，完成后自动折叠", () => {
    const { rerender } = render(<MessageContent message={agentMessage({ status: "streaming" })} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("先检查。")).toBeVisible();
    expect(screen.queryByText(/已处理/)).not.toBeInTheDocument();
    rerender(<MessageContent message={agentMessage()} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("先检查。")).not.toBeVisible();
    expect(screen.getByText("已处理 25 秒 · 运行 2 步")).toBeVisible();
  });

  it("工具末尾没有时间戳时仅展示步数，并支持日文", () => {
    const message = agentMessage();
    message.contentSegments = message.contentSegments!.filter((_, index) => index !== 5);
    render(<MessageContent message={message} locale="ja-JP" hideCitations={false} />);
    expect(screen.getByText("2 ステップを実行")).toBeVisible();
    expect(screen.getByText("· 1 ステップ失敗")).toBeVisible();
    expect(screen.queryByText(/秒/)).not.toBeVisible();
  });

  it("无工具的普通思考回复不折叠", () => {
    const message = agentMessage({ toolSteps: [], contentSegments: [
      { type: "thought", start: 0, end: 5 }, { type: "text", start: 0, end: 13 },
    ] });
    const { container } = render(<MessageContent message={message} locale="zh-CN" hideCitations={false} />);
    expect(container.querySelector(".message-process")).toBeNull();
    expect(screen.getByText(message.text)).toBeVisible();
  });

  it("仅当前回复里同名工具的最后一个未完成步骤等待批准，批准后恢复转圈", () => {
    const message = agentMessage({ status: "streaming", text: "", thought: "", toolSteps: [
      { id: "one", name: "run_command", argumentsJson: '{"command":"first"}' },
      { id: "two", name: "read_file", argumentsJson: '{"path":"config.ts"}' },
      { id: "three", name: "run_command", argumentsJson: '{"command":"last"}' },
    ], contentSegments: [
      { type: "tool", toolId: "one" }, { type: "text", start: 0, end: 0 },
      { type: "tool", toolId: "two" }, { type: "tool", toolId: "three" },
    ] });
    const history = { ...message, id: "history", status: "stopped" as const };
    const { container, rerender } = render(<ConversationView messages={[history, message]} locale="zh-CN" pendingToolName="run_command" />);
    expect(screen.getAllByText("等待批准")).toHaveLength(1);
    const pending = screen.getByRole("button", { name: /运行 `last` 等待批准/ });
    expect(within(pending).queryByRole("status")).toHaveTextContent("等待批准");
    expect(pending.querySelector(".tool-card__spinner")).toBeNull();
    expect(container.querySelectorAll(".tool-card__spinner")).toHaveLength(2);
    rerender(<ConversationView messages={[history, message]} locale="zh-CN" />);
    expect(screen.queryByText("等待批准")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".tool-card__spinner")).toHaveLength(3);
  });
});
