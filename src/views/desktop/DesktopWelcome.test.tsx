import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopWelcome } from "./DesktopWelcome";

describe("DesktopWelcome", () => {
  it("guides first-run users to model settings when no model is configured", async () => {
    const user = userEvent.setup();
    const onSetupModel = vi.fn();
    render(<DesktopWelcome locale="zh-CN" needsModelSetup onSetupModel={onSetupModel} />);

    expect(screen.getByText("先连接一个模型")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "配置模型" }));
    expect(onSetupModel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing once a model is available", () => {
    const { container } = render(<DesktopWelcome locale="ja-JP" />);

    expect(screen.queryByRole("button", { name: "モデルを設定" })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
