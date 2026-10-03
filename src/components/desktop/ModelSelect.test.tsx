import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSelect } from "./ModelSelect";

describe("ModelSelect", () => {
  const mockEntries = [
    { provider: "stepfun" as const, apiKey: "key-1", model: "step-3.7-flash" },
    { provider: "deepseek" as const, apiKey: "key-2", model: "deepseek-v4-flash" },
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
        activeProvider="stepfun"
        entries={mockEntries}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    // 应该显示短名 StepFun 和模型名 step-3.7-flash，中间以 / 隔开
    expect(screen.getByText("StepFun")).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByText("step-3.7-flash")).toBeInTheDocument();

    // 完整的全称应在 title 属性中
    const trigger = screen.getByRole("button", { name: /StepFun/i });
    expect(trigger).toHaveAttribute("title", expect.stringContaining("阶跃星辰 StepFun"));
  });

  it("opens dropdown menu on click, switches provider on selection, and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <ModelSelect
        activeProvider="stepfun"
        entries={mockEntries}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
      />,
    );

    const trigger = screen.getByRole("button", { name: /StepFun/i });
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
      expect(onSelect).toHaveBeenCalledWith("deepseek");
    }

    // 菜单关闭
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates to settings from dropdown footer", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(
      <ModelSelect
        activeProvider="stepfun"
        entries={mockEntries}
        onSelect={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    const trigger = screen.getByRole("button", { name: /StepFun/i });
    await user.click(trigger);

    const manageBtn = screen.getByRole("button", { name: /管理模型与 API Key/i });
    await user.click(manageBtn);

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
