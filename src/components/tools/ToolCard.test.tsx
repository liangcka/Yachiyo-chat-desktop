import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCard } from "./ToolCard";

describe("ToolCard", () => {
  it("渲染动词化描述而非原始工具名和 JSON", () => {
    const { container } = render(
      <ToolCard
        toolName="read_file"
        args={{ path: "src/main.rs" }}
        output="fn main() {}"
        locale="zh-CN"
      />,
    );
    expect(screen.getByText("读取 src/main.rs")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
    expect(container.querySelector(".tool-card__arg-pill")).not.toBeInTheDocument();
  });

  it("运行中时显示转圈且无徽章文字", () => {
    const { container } = render(
      <ToolCard
        toolName="run_command"
        args={{ command: "cargo check" }}
        isRunning
        locale="zh-CN"
      />,
    );
    expect(screen.getByText("运行 `cargo check`")).toBeInTheDocument();
    expect(container.querySelector(".tool-card__spinner")).toBeInTheDocument();
    expect(screen.queryByText("执行中")).not.toBeInTheDocument();
    expect(screen.queryByText("実行中")).not.toBeInTheDocument();
    expect(container.querySelector(".tool-card__status")).not.toBeInTheDocument();
  });

  it("失败步骤增加 error 类并无错误徽章", () => {
    const { container } = render(
      <ToolCard
        toolName="run_command"
        args={{ command: "invalid-cmd" }}
        isError
        output="command not found"
        locale="zh-CN"
      />,
    );
    expect(container.querySelector(".tool-card--error")).toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
    expect(screen.queryByText("失敗")).not.toBeInTheDocument();
    expect(container.querySelector(".tool-card__status")).not.toBeInTheDocument();
  });

  it("点击展开后展示终端样式输出，参数收拢在详情中", () => {
    const { container } = render(
      <ToolCard
        toolName="run_command"
        args={{ command: "ls -la" }}
        output="total 42"
        locale="zh-CN"
      />,
    );
    // 默认折叠
    expect(screen.queryByText("total 42")).not.toBeInTheDocument();

    // 点击展开
    fireEvent.click(screen.getByRole("button", { name: /运行 `ls -la`/ }));
    expect(screen.getByText("total 42")).toBeInTheDocument();

    // 输出区域与详情折叠
    const outputElem = container.querySelector(".tool-card__output");
    expect(outputElem).toBeInTheDocument();
    expect(outputElem?.textContent).toBe("total 42");

    const detailsElem = container.querySelector(".tool-card__details");
    expect(detailsElem).toBeInTheDocument();
    expect(screen.getByText("详情")).toBeInTheDocument();
  });

  it("日文环境下正确展示动词与详情", () => {
    render(
      <ToolCard
        toolName="read_file"
        args={{ path: "README.md" }}
        output="# Demo"
        locale="ja-JP"
      />,
    );
    expect(screen.getByText("README.md を読み込み")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /README\.md を読み込み/ }));
    expect(screen.getByText("詳細")).toBeInTheDocument();
    expect(screen.getByText("出力")).toBeInTheDocument();
  });

  it("MCP 工具格式化且无内联样式", () => {
    const { container } = render(
      <ToolCard
        toolName="mcp__filesystem__list_directory"
        args={{ path: "/tmp" }}
        locale="zh-CN"
      />,
    );
    expect(screen.getByText("filesystem · list_directory")).toBeInTheDocument();
    // 确保没有内联样式
    const inlineStyled = container.querySelectorAll("[style]");
    expect(inlineStyled).toHaveLength(0);
  });
});
