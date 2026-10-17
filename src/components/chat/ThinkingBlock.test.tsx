import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock";

describe("ThinkingBlock", () => {
  it("流式思考默认只展示最新一行，点击展开全文，后续更新保持用户选择", () => {
    const props = { locale: "zh-CN" as const, hasText: false, isStreaming: true };
    const { container, rerender } = render(<ThinkingBlock {...props} thought={"第一行\n最新一行\n"} />);
    expect(screen.getByText("思考中…")).toBeVisible();
    expect(screen.getByText("最新一行")).toBeVisible();
    expect(container.querySelector(".thinking-block__content")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector(".thinking-block__text")).toHaveTextContent("第一行 最新一行");
    rerender(<ThinkingBlock {...props} thought={"第一行\n最新一行\n后续内容"} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    rerender(<ThinkingBlock {...props} hasText isStreaming={false} thought="思考全文" durationMs={500} />);
    expect(screen.getByRole("button", { name: "思考了不到 1 秒" })).toHaveAttribute("aria-expanded", "false");
  });

  it.each([0, 999])("%d 毫秒使用不足一秒文案并支持日文", (durationMs) => {
    const { rerender } = render(<ThinkingBlock locale="zh-CN" hasText isStreaming={false} thought="内容" durationMs={durationMs} />);
    expect(screen.getByText("思考了不到 1 秒")).toBeVisible();
    rerender(<ThinkingBlock locale="ja-JP" hasText isStreaming={false} thought="内容" durationMs={durationMs} />);
    expect(screen.getByText("1 秒未満考えました")).toBeVisible();
  });
});
