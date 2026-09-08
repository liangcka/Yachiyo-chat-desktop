import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../../i18n/messages";
import * as appPlatform from "../../services/app-platform";
import * as desktopBridge from "../../services/desktop-bridge";
import { DesktopTopBar } from "./DesktopTopBar";

describe("DesktopTopBar", () => {
  const copy = copyFor("zh-CN");

  it("renders brand button and triggers onNewChat when clicked", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn().mockResolvedValue(undefined);
    const onSwitchView = vi.fn();

    render(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={onNewChat}
        onSwitchView={onSwitchView}
      />,
    );

    expect(screen.getByText("月见八千代")).toBeInTheDocument();
    expect(screen.getByText("IDE")).toBeInTheDocument();

    const brandBtn = screen.getByRole("button", { name: "月见八千代" });
    await user.click(brandBtn);
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("renders sidebar collapse toggle and calls onToggleSidebar", async () => {
    const user = userEvent.setup();
    const onToggleSidebar = vi.fn();

    const { rerender } = render(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={vi.fn()}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed={false}
      />,
    );

    const collapseBtn = screen.getByTitle("折叠侧边栏 (Ctrl+[)");
    expect(collapseBtn).toBeInTheDocument();
    await user.click(collapseBtn);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);

    // 测试折叠态下的展开文案
    rerender(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={vi.fn()}
        onToggleSidebar={onToggleSidebar}
        sidebarCollapsed={true}
      />,
    );

    expect(screen.getByTitle("展开侧边栏 (Ctrl+[)")).toBeInTheDocument();
  });

  it("renders view switcher tabs and switches between chat and editor", async () => {
    const user = userEvent.setup();
    const onSwitchView = vi.fn();

    render(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={onSwitchView}
      />,
    );

    const chatTab = screen.getByRole("tab", { name: /对话/i });
    const editorTab = screen.getByRole("tab", { name: /编辑器/i });

    expect(chatTab).toHaveAttribute("aria-selected", "true");
    expect(editorTab).toHaveAttribute("aria-selected", "false");

    await user.click(editorTab);
    expect(onSwitchView).toHaveBeenCalledWith("editor");
  });

  it("renders window controls in desktop mode and triggers bridge functions", async () => {
    vi.spyOn(appPlatform, "isDesktopApp").mockReturnValue(true);
    const minimizeSpy = vi.spyOn(desktopBridge, "minimizeDesktopWindow").mockResolvedValue(true);
    const toggleMaximizeSpy = vi
      .spyOn(desktopBridge, "toggleMaximizeDesktopWindow")
      .mockResolvedValue(true);
    const closeSpy = vi.spyOn(desktopBridge, "closeDesktopWindow").mockResolvedValue(true);

    const user = userEvent.setup();

    render(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );

    const minBtn = screen.getByTitle("最小化");
    const maxBtn = screen.getByTitle("最大化");
    const closeBtn = screen.getByTitle("关闭");

    expect(minBtn).toBeInTheDocument();
    expect(maxBtn).toBeInTheDocument();
    expect(closeBtn).toBeInTheDocument();

    await user.click(minBtn);
    expect(minimizeSpy).toHaveBeenCalledTimes(1);

    await user.click(maxBtn);
    expect(toggleMaximizeSpy).toHaveBeenCalledTimes(1);

    await user.click(closeBtn);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it("hides window controls in web mode", () => {
    vi.spyOn(appPlatform, "isDesktopApp").mockReturnValue(false);

    render(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={vi.fn()}
      />,
    );

    expect(screen.queryByTitle("最小化")).not.toBeInTheDocument();
    expect(screen.queryByTitle("最大化")).not.toBeInTheDocument();
    expect(screen.queryByTitle("关闭")).not.toBeInTheDocument();

    vi.restoreAllMocks();
  });
});
