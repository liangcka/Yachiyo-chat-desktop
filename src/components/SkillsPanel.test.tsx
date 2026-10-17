import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { SkillsPanel } from "./SkillsPanel";

describe("联网搜索设置", () => {
  it("父开关关闭时保留子项偏好并禁止点击", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SkillsPanel open embedded onlyWebSearch skills={[]} activeIds={[]} copy={copyFor("zh-CN")} onClose={vi.fn()} onToggle={vi.fn()} webSearchSettings={{ enabled: false, smart: true, showSources: true }} onWebSearchSettingsChange={onChange} />);
    const children = screen.getAllByRole("button").filter((button) => button.hasAttribute("disabled"));
    expect(children).toHaveLength(2);
    for (const button of children) {
      expect(button).toHaveAttribute("aria-pressed", "true");
      await user.click(button);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});
