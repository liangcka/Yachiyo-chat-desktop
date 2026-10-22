import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSelect } from "./ModelSelect";

describe("ModelSelect", () => {
  const mockEntries = [
    { id: "stepfun", provider: "stepfun" as const, apiKey: "key-1", model: "step-3.7-flash" },
    { id: "deepseek~a1b2c3d4", provider: "deepseek" as const, apiKey: "key-2", model: "deepseek-v4-flash" },
  ];

  it("renders placeholder when no provider is active", () => {
    render(
      <ModelSelect
        entries={mockEntries}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("选择模型")).toBeInTheDocument();
  });

  it("renders clean structured vendor and model name without redundant text or brackets", () => {
    render(
      <ModelSelect
        activeEntryId="stepfun"
        entries={mockEntries}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.queryByText("StepFun")).not.toBeInTheDocument();
    expect(screen.queryByText("/")).not.toBeInTheDocument();
    expect(screen.getByText("step-3.7 Flash")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /step-3.7 Flash/i });
    expect(trigger).toHaveAttribute("title", expect.stringContaining("阶跃星辰 StepFun"));
  });

  it("opens dropdown menu on click, switches provider on selection, and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <ModelSelect
        activeEntryId="stepfun"
        entries={mockEntries}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
      />,
    );

    const trigger = screen.getByRole("button", { name: /step-3.7 Flash/i });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // 点击展开
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("已配置模型")).toBeInTheDocument();

    // 列表中展示完整厂商名
    expect(screen.getByText(/阶跃星辰 StepFun/i)).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();

    // 选择 DeepSeek
    const deepseekOption = screen.getByText("DeepSeek").closest("button");
    expect(deepseekOption).not.toBeNull();
    if (deepseekOption) {
      await user.click(deepseekOption);
      expect(onSelect).toHaveBeenCalledWith("deepseek~a1b2c3d4");
    }

    // 菜单关闭
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates to settings from dropdown footer", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(
      <ModelSelect
        activeEntryId="stepfun"
        entries={mockEntries}
        onSelect={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    const trigger = screen.getByRole("button", { name: /step-3.7 Flash/i });
    await user.click(trigger);

    const manageBtn = screen.getByRole("button", { name: /管理模型与 API Key/i });
    await user.click(manageBtn);

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
