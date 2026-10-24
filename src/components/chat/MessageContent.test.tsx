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
      "已检查。", expect.stringContaining("1 步失败"), "思考了 1 秒",
    ]);
    expect(screen.getByText("先检查。")).toBeVisible();
    const failedGroup = screen.getByText("1 步失败").closest("details")!;
    fireEvent.click(failedGroup.querySelector("summary")!);
    fireEvent.click(screen.getByRole("button", { name: /运行 `check`/ }));
    expect(screen.getByText("配置缺失")).toBeVisible();
    fireEvent.click(summary);
    expect(screen.getByText("先检查。")).not.toBeVisible();
    expect(screen.getByText("最终回答。")).toBeVisible();
  });

  it("过程区里没有正文间隔的连续思考/工具合并为一条思考 + 一个工具组", () => {
    const toolSteps = ["a", "b", "c"].map((id, index) => ({
      id, name: "run_command", argumentsJson: `{"command":"${id}"}`,
      result: { output: "x", isError: index === 1, durationMs: 1 },
    }));
    const message = agentMessage({ text: "最终回答。", thought: "一二三", toolSteps, contentSegments: [
      { type: "thought", start: 0, end: 1, startedAtMs: 0, endedAtMs: 2000 },
      { type: "tool", toolId: "a" },
      { type: "thought", start: 1, end: 2, startedAtMs: 3000, endedAtMs: 5000 },
      { type: "tool", toolId: "b" },
      { type: "thought", start: 2, end: 3, startedAtMs: 6000, endedAtMs: 7000 },
      { type: "tool", toolId: "c" },
      { type: "text", start: 0, end: 5 },
    ] });
    const { container } = render(<MessageContent message={message} locale="zh-CN" hideCitations={false} />);
    const process = container.querySelector(".message-process__content")!;
    expect([...process.children].map((node) => node.textContent)).toEqual([
      "思考了 5 秒", expect.stringContaining("已运行 3 步"),
    ]);
    expect(within(process as HTMLElement).getByText("1 步失败")).toBeInTheDocument();
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
    const pendingPermission = { toolName: "run_command", argumentsJson: '{"command":"last"}' };
    const { container, rerender } = render(<ConversationView messages={[history, message]} locale="zh-CN" pendingPermission={pendingPermission} />);
    expect(screen.getAllByText("等待批准")).toHaveLength(1);
    const pending = screen.getByRole("button", { name: /运行 `last` 等待批准/ });
    expect(within(pending).queryByRole("status")).toHaveTextContent("等待批准");
    expect(pending.querySelector(".tool-card__spinner")).toBeNull();
    expect(container.querySelectorAll(".tool-card__spinner")).toHaveLength(2);
    rerender(<ConversationView messages={[history, message]} locale="zh-CN" />);
    expect(screen.queryByText("等待批准")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".tool-card__spinner")).toHaveLength(3);
  });

  it("同一轮有两条 run_command 时，只有被审批的那条显示等待批准，参数不匹配退回第一个未完成步骤", () => {
    const message = agentMessage({ status: "streaming", text: "", thought: "", toolSteps: [
      { id: "one", name: "run_command", argumentsJson: '{"command":"echo first"}' },
      { id: "two", name: "run_command", argumentsJson: '{"command":"echo second"}' },
    ], contentSegments: [
      { type: "tool", toolId: "one" }, { type: "tool", toolId: "two" },
    ] });

    // 审批第二条
    const { rerender } = render(
      <MessageContent
        message={message}
        locale="zh-CN"
        hideCitations={false}
        pendingPermission={{ toolName: "run_command", argumentsJson: '{"command":"echo second"}' }}
      />,
    );
    const secondBtn = screen.getByRole("button", { name: /运行 `echo second` 等待批准/ });
    expect(within(secondBtn).getByText("等待批准")).toBeInTheDocument();
    const firstBtn = screen.getByRole("button", { name: /运行 `echo first`/ });
    expect(within(firstBtn).queryByText("等待批准")).toBeNull();

    // 参数不匹配时退回同名第一个未完成步骤
    rerender(
      <MessageContent
        message={message}
        locale="zh-CN"
        hideCitations={false}
        pendingPermission={{ toolName: "run_command", argumentsJson: '{"command":"echo unknown"}' }}
      />,
    );
    const fallbackFirst = screen.getByRole("button", { name: /运行 `echo first` 等待批准/ });
    expect(within(fallbackFirst).getByText("等待批准")).toBeInTheDocument();
  });

  it("过程摘要耗时不足 1 秒时显示已处理不到 1 秒（中日双语），不显示已处理 0 秒", () => {
    const shortMessageZh = agentMessage({
      toolSteps: [
        { id: "one", name: "read_file", argumentsJson: '{"path":"config.ts"}', result: { output: "ok", isError: false, durationMs: 10, endedAtMs: 600 } },
      ],
      contentSegments: [
        { type: "thought", start: 0, end: 5, startedAtMs: 100, endedAtMs: 400 },
        { type: "tool", toolId: "one" },
        { type: "text", start: 8, end: 13 },
      ],
    });
    const { rerender } = render(<MessageContent message={shortMessageZh} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText(/已处理不到 1 秒 · /)).toBeVisible();
    expect(screen.queryByText(/已处理 0 秒/)).not.toBeInTheDocument();

    const shortMessageJa = agentMessage({
      toolSteps: [
        { id: "one", name: "read_file", argumentsJson: '{"path":"config.ts"}', result: { output: "ok", isError: false, durationMs: 10, endedAtMs: 600 } },
      ],
      contentSegments: [
        { type: "thought", start: 0, end: 5, startedAtMs: 100, endedAtMs: 400 },
        { type: "tool", toolId: "one" },
        { type: "text", start: 8, end: 13 },
      ],
    });
    rerender(<MessageContent message={shortMessageJa} locale="ja-JP" hideCitations={false} />);
    expect(screen.getByText(/1 秒未満で処理 · /)).toBeVisible();
    expect(screen.queryByText(/0 秒で処理/)).not.toBeInTheDocument();
  });

  it("工具组运行中显示正在运行 N 步，结束后显示已运行 N 步", () => {
    const streamingMessage = agentMessage({
      status: "streaming",
      toolSteps: [
        { id: "one", name: "read_file", argumentsJson: '{"path":"config.ts"}' },
      ],
      contentSegments: [
        { type: "tool", toolId: "one" },
      ],
    });
    const { rerender } = render(<MessageContent message={streamingMessage} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("正在运行 1 步")).toBeVisible();

    rerender(<MessageContent message={streamingMessage} locale="ja-JP" hideCitations={false} />);
    expect(screen.getByText("1 ステップを実行中")).toBeVisible();

    const completedMessage = agentMessage({
      status: "streaming",
      toolSteps: [
        { id: "one", name: "read_file", argumentsJson: '{"path":"config.ts"}', result: { output: "ok", isError: false, durationMs: 10 } },
      ],
      contentSegments: [
        { type: "tool", toolId: "one" },
      ],
    });
    rerender(<MessageContent message={completedMessage} locale="zh-CN" hideCitations={false} />);
    expect(screen.getByText("已运行 1 步")).toBeVisible();

    rerender(<MessageContent message={completedMessage} locale="ja-JP" hideCitations={false} />);
    expect(screen.getByText("1 ステップを実行")).toBeVisible();
  });
});
