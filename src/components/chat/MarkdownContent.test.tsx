import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent 块级结构", () => {
  it("渲染标题与分隔线", () => {
    const { container } = render(<MarkdownContent text={"# 总览\n\n## 结论\n\n---\n\n#没有空格不是标题"} isAssistant />);
    expect(screen.getByRole("heading", { level: 1, name: "总览" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "结论" })).toBeInTheDocument();
    expect(container.querySelectorAll("hr.markdown-hr")).toHaveLength(1);
    expect(screen.getByText("#没有空格不是标题").tagName).toBe("P");
  });

  it("表头后紧跟分隔行时渲染表格，并按分隔行读取对齐", () => {
    render(<MarkdownContent text={"| 命令 | 用途 |\n|---|:---:|\n| build | 构建 |\n| test |\n\n收尾"} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["命令", "用途"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[2]).getAllByRole("cell")).toHaveLength(2);
    expect(within(rows[1]).getByText("构建")).toHaveAttribute("data-align", "center");
    expect(screen.getByText("收尾").tagName).toBe("P");
  });

  it("缺少分隔行的竖线文本保持为段落", () => {
    render(<MarkdownContent text={"a | b\n---"} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("a | b").tagName).toBe("P");
  });

  it("连续引用行合并为一块，连续空行只保留一个间隙", () => {
    const { container } = render(<MarkdownContent text={"\n\n第一段\n\n\n\n> 引用一\n> 引用二\n\n"} />);
    const quotes = container.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toHaveTextContent("引用一引用二");
    expect(container.querySelectorAll(".markdown-spacer")).toHaveLength(1);
    expect(container.querySelector(".markdown-content")?.firstElementChild).toHaveTextContent("第一段");
  });

  it("代码块前后的空行不额外占位", () => {
    const { container } = render(<MarkdownContent text={"配置如下：\n\n```ts\nconst a = 1;\n```\n\n完成"} />);
    const content = container.querySelector(".markdown-content")!;
    expect([...content.children].map((child) => child.className)).toEqual(["markdown-p", "markdown-code-block", "markdown-p"]);
  });
});
