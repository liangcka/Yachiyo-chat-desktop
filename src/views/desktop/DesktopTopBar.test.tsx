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

  it("renders view switcher icon button and switches between chat and editor", async () => {
    const user = userEvent.setup();
    const onSwitchView = vi.fn();

    const { rerender } = render(
      <DesktopTopBar
        activeView="chat"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={onSwitchView}
      />,
    );

    const toggleBtn = screen.getByRole("button", { name: copy.editorTab });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("title", `${copy.editorTab} (Ctrl+2)`);

    await user.click(toggleBtn);
    expect(onSwitchView).toHaveBeenCalledWith("editor");

    rerender(
      <DesktopTopBar
        activeView="editor"
        copy={copy}
        onNewChat={vi.fn()}
        onSwitchView={onSwitchView}
      />,
    );

    const backToChatBtn = screen.getByRole("button", { name: copy.editorViewTab });
    expect(backToChatBtn).toBeInTheDocument();
    expect(backToChatBtn).toHaveAttribute("title", `${copy.editorViewTab} (Ctrl+1)`);

    await user.click(backToChatBtn);
    expect(onSwitchView).toHaveBeenCalledWith("chat");
  });

  it("renders conversation title and project name, supporting inline rename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(
      <DesktopTopBar
        activeConversationId="conv-test-1"
        activeView="chat"
        conversationTitle="当前对话标题"
        copy={copy}
        onNewChat={vi.fn()}
        onRenameConversation={onRename}
        onSwitchView={vi.fn()}
      />,
    );

    expect(screen.getByText("当前对话标题")).toBeInTheDocument();
    expect(screen.getByText("无项目")).toBeInTheDocument();

    const editBtn = screen.getByTitle("重命名会话");
    await user.click(editBtn);

    const input = screen.getByLabelText("重命名当前会话");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("当前对话标题");

    await user.clear(input);
    await user.type(input, "新对话标题{Enter}");

    expect(onRename).toHaveBeenCalledWith("conv-test-1", "新对话标题");
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

    const minBtn = screen.getByRole("button", { name: "最小化窗口" });
    const maxBtn = screen.getByRole("button", { name: "最大化窗口" });
    const closeBtn = screen.getByRole("button", { name: "关闭窗口" });
    // 窗口控件不用原生 title 气泡（透明窗口下会被裁切并残留黑边）
    expect(closeBtn).not.toHaveAttribute("title");
    expect(closeBtn).toHaveAttribute("data-tooltip", "关闭");

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

    expect(screen.queryByRole("button", { name: "最小化窗口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最大化窗口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭窗口" })).not.toBeInTheDocument();

    vi.restoreAllMocks();
  });
});
