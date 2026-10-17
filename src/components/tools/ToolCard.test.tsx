import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "./ToolCard";
import { projectManager } from "../../services/project-manager";

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

  it("等待批准文字优先于转圈，并保留日文", () => {
    const { container, rerender } = render(<ToolCard toolName="run_command" isRunning isWaitingForApproval locale="ja-JP" />);
    expect(screen.getByRole("status")).toHaveTextContent("承認待ち");
    expect(container.querySelector(".tool-card__spinner")).toBeNull();
    rerender(<ToolCard toolName="run_command" isRunning locale="ja-JP" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector(".tool-card__spinner")).toBeInTheDocument();
  });

  it("失败步骤展开后默认显示错误输出，参数仍收在详情内", () => {
    render(<ToolCard toolName="run_command" args={{ command: "check" }} isError output="配置缺失" />);
    fireEvent.click(screen.getByRole("button", { name: /运行 `check`/ }));
    expect(screen.getByText("配置缺失")).toBeVisible();
    expect(screen.getByText(/"command": "check"/)).not.toBeVisible();
  });

  it.each(["zh-CN", "ja-JP"] as const)("未选择项目的失败步骤提供项目选择入口（%s）", async (locale) => {
    const pick = vi.spyOn(projectManager, "pickAndOpenProject").mockResolvedValue(undefined);
    render(<ToolCard toolName="write_file" isError locale={locale}
      output="当前未选择项目，无法写入。请让用户在侧栏选择项目。" />);
    const label = locale === "ja-JP" ? "プロジェクトを選択" : "选择项目";
    await fireEvent.click(screen.getByRole("button", { name: label }));
    expect(pick).toHaveBeenCalledWith(label);
    pick.mockRestore();
  });

  it("其他工具错误不显示项目选择入口", () => {
    render(<ToolCard toolName="read_file" isError output="文件不存在" />);
    expect(screen.queryByRole("button", { name: "选择项目" })).not.toBeInTheDocument();
  });

  it.each(["当前未打开项目工作区，请使用用户提供的绝对路径读取文件或目录。", "当前未选择工作区项目，无法写入文件。"])("历史记录和相对路径错误也提供项目入口：%s", (output) => {
    render(<ToolCard toolName="read_file" isError output={output} />);
    expect(screen.getByRole("button", { name: "选择项目" })).toBeVisible();
  });
});
