import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "./ToolCard";
import { PermissionCard } from "./PermissionCard";

const args = { path: "src/main.ts", old_string: "const a = 1;\r\n保持不变\r\n", new_string: "const a = 2;\n保持不变\n", replace_all: true };

describe("edit_file 片段预览", () => {
  it("工具卡展开后显示增删行、共同上下文和全量替换说明", () => {
    const { container } = render(<ToolCard toolName="edit_file" args={args} />);
    expect(screen.queryByRole("region", { name: "片段改动预览" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑 src/main.ts" }));
    const diff = screen.getByRole("region", { name: "片段改动预览" });
    expect(within(diff).getByText("const a = 1;")).toBeVisible();
    expect(within(diff).getByText("const a = 2;")).toBeVisible();
    expect(within(diff).getAllByText("保持不变")).toHaveLength(1);
    expect(within(diff).getByText("替换所有匹配处")).toBeVisible();
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("权限卡直接展示同一份 diff，并保留日文和批准操作", () => {
    const onApprove = vi.fn();
    render(<PermissionCard toolName="edit_file" argumentsJson={JSON.stringify(args)} locale="ja-JP" onApprove={onApprove} onDeny={vi.fn()} />);
    expect(screen.getByText("このファイルの変更を許可しますか？")).toBeVisible();
    const diff = screen.getByRole("region", { name: "変更箇所のプレビュー" });
    expect(within(diff).getByText("const a = 1;")).toBeVisible();
    expect(within(diff).getByText("const a = 2;")).toBeVisible();
    expect(within(diff).getByText("一致箇所をすべて置換")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /1回のみ許可/ }));
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it("损坏或缺少片段参数时保留原有详情展示", () => {
    render(<ToolCard toolName="edit_file" args={{ path: "a.ts", old_string: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑 a.ts" }));
    expect(screen.queryByRole("region", { name: "片段改动预览" })).toBeNull();
    expect(screen.getByText("详情")).toBeVisible();
  });
});
