import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReasoningSupport } from "../../services/reasoning-effort";

const support = vi.hoisted(() => ({ value: { levels: [] } as ReasoningSupport }));

vi.mock("../../services/reasoning-effort", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/reasoning-effort")>()),
  fetchReasoningSupport: vi.fn(() => Promise.resolve(support.value)),
}));

import { readReasoningEffort } from "../../services/reasoning-effort";
import { ReasoningEffortSelect } from "./ReasoningEffortSelect";

const model = { provider: "openai" as const, model: "gpt-6-astra" };

describe("ReasoningEffortSelect", () => {
  beforeEach(() => localStorage.clear());

  it("模型不支持调节时禁用并说明原因", async () => {
    support.value = { levels: [] };
    render(<ReasoningEffortSelect model={model} onOpenModelSettings={vi.fn()} />);
    const trigger = await screen.findByRole("button", { name: "推理强度" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "当前模型不支持调节推理强度");
  });

  it("展示默认档位，键盘调节后按模型记忆，重置后恢复默认", async () => {
    support.value = { levels: ["low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" };
    const user = userEvent.setup();
    render(<ReasoningEffortSelect model={model} onOpenModelSettings={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "选择推理强度" }));

    const slider = screen.getByRole("slider", { name: "选择推理强度" });
    expect(slider).toHaveAttribute("aria-valuetext", "中");
    expect(screen.getByRole("button", { name: "恢复模型默认档位" })).toBeDisabled();

    expect(document.querySelector(".dsh-reasoning-select__meteors")).toBeNull();
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Ultra");
    expect(screen.getByRole("dialog")).toHaveClass("dsh-reasoning-select__panel--ultra");
    expect(document.querySelectorAll(".dsh-reasoning-select__meteors i")).toHaveLength(4);
    expect(readReasoningEffort(model)).toBe("max");
    expect(screen.getByRole("button", { name: /推理强度 · Ultra/ })).toBeInTheDocument();

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(readReasoningEffort(model)).toBe("xhigh");

    await user.click(screen.getByRole("button", { name: "恢复模型默认档位" }));
    expect(readReasoningEffort(model)).toBeUndefined();
    expect(slider).toHaveAttribute("aria-valuetext", "中");
  });

  it("点击模型名打开模型设置", async () => {
    support.value = { levels: ["low", "high", "max"], defaultLevel: "high" };
    const onOpenModelSettings = vi.fn();
    const user = userEvent.setup();
    render(<ReasoningEffortSelect model={model} onOpenModelSettings={onOpenModelSettings} />);
    await user.click(await screen.findByRole("button", { name: "选择推理强度" }));
    await user.click(screen.getByRole("button", { name: /gpt-6-astra/ }));
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
