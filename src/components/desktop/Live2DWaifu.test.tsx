import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Live2DWaifu } from "./Live2DWaifu";

const SCRIPT_ID = "yachiyo-live2d-autoload";

function injectedScript(): HTMLScriptElement | null {
  return document.body.querySelector<HTMLScriptElement>(`#${SCRIPT_ID}`);
}

afterEach(() => {
  cleanup();
  injectedScript()?.remove();
});

describe("Live2DWaifu", () => {
  it("挂载后向 body 注入 autoload 脚本（position=right 右下角悬浮）", () => {
    render(<Live2DWaifu />);
    const script = injectedScript();
    expect(script).not.toBeNull();
    expect(script?.getAttribute("src")).toBe("/live2d/autoload.js?position=right");
  });

  it("StrictMode 双挂载不重复注入脚本", () => {
    render(
      <StrictMode>
        <Live2DWaifu />
      </StrictMode>,
    );
    expect(document.body.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);
  });

  it("重复渲染（重挂载）复用已存在的脚本节点", () => {
    const { unmount } = render(<Live2DWaifu />);
    const first = injectedScript();
    expect(first).not.toBeNull();

    unmount();
    // 挂件随应用生命周期常驻，卸载不清理；再次挂载应复用同一节点
    render(<Live2DWaifu />);
    expect(document.body.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);
  });
});
