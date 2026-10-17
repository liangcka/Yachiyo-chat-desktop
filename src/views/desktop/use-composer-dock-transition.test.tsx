import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CSSProperties } from "react";
import { useComposerDockTransition } from "./use-composer-dock-transition";

interface HarnessProps {
  isBlank: boolean;
  conversationId?: string;
}

function Harness({ isBlank, conversationId = "conversation-1" }: HarnessProps) {
  const { composerRef, prepareTransition } = useComposerDockTransition(isBlank, conversationId);
  return (
    <div>
      <div
        ref={composerRef}
        style={{ "--motion-duration-panel": "250ms", "--ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)" } as CSSProperties}
        data-testid="composer"
        data-position={isBlank ? "welcome" : "dock"}
      >
        <textarea aria-label="输入" onKeyDown={(event) => {
          if (event.key === "Enter") prepareTransition();
        }} />
        <button type="button" onClick={prepareTransition}>发送</button>
      </div>
    </div>
  );
}

function mockAnimation() {
  const animation = { cancel: vi.fn(), onfinish: null, oncancel: null };
  const animate = vi.fn().mockReturnValue(animation);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return DOMRect.fromRect({
      x: 40,
      y: this.dataset.position === "welcome" ? 240 : 640,
      width: 760,
      height: 160,
    });
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  return { animate, animation };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.mocked(window.matchMedia).mockClear();
});

describe("首次发送的输入区过渡", () => {
  it("回车发送后从原位置下移，保留输入节点与焦点，后续渲染不重播", () => {
    const { animate } = mockAnimation();
    const { rerender } = render(<Harness isBlank />);
    const input = screen.getByRole("textbox", { name: "输入" });
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    rerender(<Harness isBlank={false} />);

    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translate(0px, -400px)" }, { transform: "translate(0, 0)" }],
      { duration: 250, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
    );
    expect(screen.getByRole("textbox", { name: "输入" })).toBe(input);
    expect(input).toHaveFocus();
    rerender(<Harness isBlank={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("点击发送和回车使用同一过渡", () => {
    const { animate } = mockAnimation();
    const { rerender } = render(<Harness isBlank />);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    rerender(<Harness isBlank={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("切换到其他历史会话时不播放输入区位移", () => {
    const { animate } = mockAnimation();
    const { rerender } = render(<Harness isBlank />);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    rerender(<Harness isBlank={false} conversationId="conversation-2" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("系统要求减少动态效果时直接就位", () => {
    const { animate } = mockAnimation();
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    vi.mocked(window.matchMedia).mockReturnValueOnce({ ...preference, matches: true });
    const { rerender } = render(<Harness isBlank />);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    rerender(<Harness isBlank={false} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("窗口尺寸改变时取消位移并清理订阅", () => {
    const { animation } = mockAnimation();
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { rerender, unmount } = render(<Harness isBlank />);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    rerender(<Harness isBlank={false} />);
    fireEvent(window, new Event("resize"));
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    unmount();
  });
});
