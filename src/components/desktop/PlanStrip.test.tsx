import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { extractLatestTodos, type ChatMessage, type TodoItem } from "../../domain/chat";
import { PlanStrip } from "./PlanStrip";

describe("PlanStrip", () => {
  it("renders nothing when todos is empty", () => {
    const { container } = render(<PlanStrip todos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders progress counter and active task", () => {
    const todos: TodoItem[] = [
      { content: "第 1 步：查验架构", status: "completed" },
      { content: "第 2 步：实现修剪器", status: "in_progress" },
      { content: "第 3 步：编写单测", status: "pending" },
    ];

    render(<PlanStrip todos={todos} />);

    expect(screen.getByText("任务进度 1/3")).toBeInTheDocument();
    expect(screen.getByText("第 2 步：实现修剪器")).toBeInTheDocument();
  });

  it("toggles expanded task list on click", () => {
    const todos: TodoItem[] = [
      { content: "第 1 步：查验架构", status: "completed" },
      { content: "第 2 步：实现修剪器", status: "in_progress" },
    ];

    render(<PlanStrip todos={todos} />);

    // 默认折叠，不渲染 ul.plan-strip__list
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    // 点击展开
    const header = screen.getByRole("button", { name: /展开任务清单/i });
    fireEvent.click(header);

    // 展开后渲染列表
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("进行中")).toBeInTheDocument();

    // 再次点击折叠
    const collapseBtn = screen.getByRole("button", { name: /收起任务清单/i });
    fireEvent.click(collapseBtn);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders all completed state correctly", () => {
    const todos: TodoItem[] = [
      { content: "第 1 步", status: "completed" },
      { content: "第 2 步", status: "completed" },
    ];

    render(<PlanStrip todos={todos} />);
    expect(screen.getByText("任务进度 2/2")).toBeInTheDocument();
    expect(screen.getByText("所有计划步骤已完成")).toBeInTheDocument();
  });
});

describe("extractLatestTodos", () => {
  it("extracts latest todos from messages with todo_write toolSteps", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg_1",
        conversationId: "conv_1",
        role: "user",
        text: "请帮我重构",
        status: "complete",
        createdAt: 1000,
      },
      {
        id: "msg_2",
        conversationId: "conv_1",
        role: "assistant",
        text: "好的，规划如下",
        status: "complete",
        createdAt: 2000,
        toolSteps: [
          {
            id: "call_1",
            name: "todo_write",
            argumentsJson: JSON.stringify({
              todos: [
                { content: "旧任务 A", status: "completed" },
                { content: "旧任务 B", status: "in_progress" },
              ],
            }),
            result: { output: "Updated todo list: 0 pending, 1 in progress, 1 completed.", isError: false, durationMs: 10 },
          },
        ],
      },
      {
        id: "msg_3",
        conversationId: "conv_1",
        role: "assistant",
        text: "更新进度",
        status: "complete",
        createdAt: 3000,
        toolSteps: [
          {
            id: "call_2",
            name: "todo_write",
            argumentsJson: JSON.stringify({
              todos: [
                { content: "新任务 A", status: "completed" },
                { content: "新任务 B", status: "completed" },
                { content: "新任务 C", status: "in_progress" },
              ],
            }),
            result: { output: "Updated todo list: 0 pending, 1 in progress, 2 completed.", isError: false, durationMs: 12 },
          },
        ],
      },
    ];

    const latest = extractLatestTodos(messages);
    expect(latest).toBeDefined();
    expect(latest?.length).toBe(3);
    expect(latest?.[0].content).toBe("新任务 A");
    expect(latest?.[2].content).toBe("新任务 C");
    expect(latest?.[2].status).toBe("in_progress");
  });

  it("returns undefined when no todo_write present", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg_1",
        conversationId: "conv_1",
        role: "assistant",
        text: "普通回复",
        status: "complete",
        createdAt: 1000,
      },
    ];
    expect(extractLatestTodos(messages)).toBeUndefined();
  });
});
