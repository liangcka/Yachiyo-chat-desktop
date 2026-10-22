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

    expect(document.querySelector(".dsh-reasoning-select__matrix")).toBeNull();
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Ultra");
    expect(screen.getByRole("dialog")).toHaveClass("dsh-reasoning-select__panel--ultra");
    expect(document.querySelector("canvas.dsh-reasoning-select__matrix")).toBeInTheDocument();
    expect(readReasoningEffort(model)).toBe("max");
    expect(screen.getByRole("button", { name: /推理强度 · Ultra/ })).toBeInTheDocument();

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(readReasoningEffort(model)).toBe("xhigh");

    await user.click(screen.getByRole("button", { name: "恢复模型默认档位" }));
    expect(readReasoningEffort(model)).toBeUndefined();
    expect(slider).toHaveAttribute("aria-valuetext", "中");
  });

  it("按住拖动时拇指连续跟手、档位随最近刻度切换，松手吸附到档位", async () => {
    support.value = { levels: ["low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" };
    const user = userEvent.setup();
    render(<ReasoningEffortSelect model={model} onOpenModelSettings={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "选择推理强度" }));

    const slider = screen.getByRole("slider", { name: "选择推理强度" });
    const rail = slider.querySelector<HTMLElement>(".dsh-reasoning-select__rail")!;
    const thumb = slider.querySelector<HTMLElement>(".dsh-reasoning-select__thumb")!;
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200, top: 0, height: 28, right: 200, bottom: 28, x: 0, y: 0, toJSON: () => ({}) });

    fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientX: 0 });
    expect(slider).toHaveAttribute("aria-valuetext", "轻度");
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 110 });
    expect(parseFloat(thumb.style.left)).toBeCloseTo(55);
    expect(slider).toHaveClass("dsh-reasoning-select__track--dragging");
    expect(slider).toHaveAttribute("aria-valuetext", "高");
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 400 });
    expect(slider).toHaveAttribute("aria-valuetext", "Ultra");
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 400 });
    expect(slider).not.toHaveClass("dsh-reasoning-select__track--dragging");
    expect(thumb.style.left).toBe("100%");
    expect(readReasoningEffort(model)).toBe("max");

    // 松手后的移动不再改档位
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 0 });
    expect(readReasoningEffort(model)).toBe("max");
  });

  it("悬停刻度时在上方提示该档位名", async () => {
    support.value = { levels: ["low", "medium", "high", "xhigh", "max"], defaultLevel: "high" };
    const user = userEvent.setup();
    render(<ReasoningEffortSelect model={model} onOpenModelSettings={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "选择推理强度" }));

    const slider = screen.getByRole("slider", { name: "选择推理强度" });
    const rail = slider.querySelector<HTMLElement>(".dsh-reasoning-select__rail")!;
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200, top: 0, height: 28, right: 200, bottom: 28, x: 0, y: 0, toJSON: () => ({}) });

    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 198 });
    expect(document.querySelector(".dsh-reasoning-select__tip")).toHaveTextContent("Ultra");
    // 悬停在当前档位上不重复提示
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 100 });
    expect(document.querySelector(".dsh-reasoning-select__tip")).toBeNull();
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 0 });
    fireEvent.pointerLeave(slider);
    expect(document.querySelector(".dsh-reasoning-select__tip")).toBeNull();
    expect(readReasoningEffort(model)).toBeUndefined();
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
