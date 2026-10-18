import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopWelcome } from "./DesktopWelcome";

describe("DesktopWelcome", () => {
  it("guides first-run users to model settings when no model is configured", async () => {
    const user = userEvent.setup();
    const onSetupModel = vi.fn();
    render(
      <DesktopWelcome disabled={false} locale="zh-CN" needsModelSetup onPrompt={vi.fn()} onSetupModel={onSetupModel} />,
    );

    expect(screen.getByText("先连接一个模型")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "配置模型" }));
    expect(onSetupModel).toHaveBeenCalledTimes(1);
  });

  it("hides the setup guide once a model is available", () => {
    render(<DesktopWelcome disabled={false} locale="ja-JP" onPrompt={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "モデルを設定" })).not.toBeInTheDocument();
    expect(screen.getByText("八千代だよ。今日は何を一緒にしようか？")).toBeInTheDocument();
  });
});
