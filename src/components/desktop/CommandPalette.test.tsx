import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

it("搜索并通过键盘执行命令，Escape 关闭", () => {
  const run = vi.fn(); const close = vi.fn();
  render(<CommandPalette onClose={close} commands={[{ id: "settings", label: "联网搜索", group: "设置", run }, { id: "chat", label: "项目讨论", group: "对话", run: vi.fn() }]} />);
  const input = screen.getByRole("combobox");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "联网" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(run).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(2);
});
