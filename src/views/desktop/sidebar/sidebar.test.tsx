import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../../domain/chat";
import { copyFor } from "../../../i18n/messages";
import { DesktopSidebar } from "./DesktopSidebar";
import { SidebarConversationItem } from "./SidebarConversationItem";
import { projectManager } from "../../../services/project-manager";
import { formatRelativeTime, orderConversations } from "./use-conversation-groups";

describe("DesktopSidebar & Submodules", () => {
  const copy = copyFor("zh-CN");
  const now = Date.now();

  const mockConversations: Conversation[] = [
    {
      id: "conv-today-1",
      title: "关于 TypeScript 重构的讨论",
      locale: "zh-CN",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "conv-yesterday-1",
      title: "昨天关于 UI 动效的研究",
      locale: "zh-CN",
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
    },
    {
      id: "conv-older-1",
      title: "更早以前的架构笔记",
      locale: "zh-CN",
      createdAt: now - 86400000 * 15,
      updatedAt: now - 86400000 * 15,
    },
  ];

  it("formats compact relative times", () => {
    const base = Date.UTC(2026, 9, 20, 12);
    expect(formatRelativeTime(base - 10_000, "zh-CN", base)).toBe("刚刚");
    expect(formatRelativeTime(base - 5 * 60_000, "zh-CN", base)).toBe("5m");
    expect(formatRelativeTime(base - 3 * 3_600_000, "zh-CN", base)).toBe("3h");
    expect(formatRelativeTime(base - 2 * 86_400_000, "zh-CN", base)).toBe("2天");
    expect(formatRelativeTime(base - 2 * 86_400_000, "ja-JP", base)).toBe("2日");
    const old = base - 40 * 86_400_000;
    const date = new Date(old);
    expect(formatRelativeTime(old, "zh-CN", base)).toBe(`${date.getMonth() + 1}/${date.getDate()}`);
  });

  it("places pinned conversations first and keeps the rest in order", () => {
    const ordered = orderConversations(mockConversations, new Set(["conv-older-1"]));
    expect(ordered.map((c) => c.id)).toEqual(["conv-older-1", "conv-today-1", "conv-yesterday-1"]);
  });

  it("renders a flat conversation list with relative times", () => {
    render(
      <DesktopSidebar
        activeConversationId="conv-today-1"
        activeRightTab="none"
        conversations={mockConversations}
        copy={copy}
        locale="zh-CN"
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectRightTab={vi.fn()}
      />,
    );

    const history = screen.getByRole("region", { name: "对话" });
    const items = within(history).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("关于 TypeScript 重构的讨论")).toBeInTheDocument();
    expect(within(items[1]).getByText("1天")).toBeInTheDocument();
    expect(within(items[2]).getByText("15天")).toBeInTheDocument();
  });

  it("lists recent projects and switches project with a new chat", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn(async () => undefined);
    const onSelectRightTab = vi.fn();
    await projectManager.switchProject("D:\\work\\beta");
    await projectManager.switchProject("D:\\work\\alpha");

    render(
      <DesktopSidebar
        activeRightTab="none"
        conversations={mockConversations}
        copy={copy}
        locale="zh-CN"
        onDeleteConversation={vi.fn()}
        onNewChat={onNewChat}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectRightTab={onSelectRightTab}
      />,
    );

    const projects = screen.getByRole("region", { name: "项目" });
    expect(within(projects).getByText("alpha").closest("button")).toHaveAttribute("aria-current", "true");

    await user.click(within(projects).getByRole("button", { name: "打开文件与终端" }));
    expect(onSelectRightTab).toHaveBeenCalledWith("workspace");

    await user.click(within(projects).getByText("beta"));
    expect(projectManager.getState().activeProject).toBe("D:\\work\\beta");
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(within(projects).getAllByRole("button", { name: "打开文件夹" })).toHaveLength(1);

    await projectManager.clear();
  });

  it("shows a single open-folder entry when there are no recent projects", async () => {
    await projectManager.clear();
    render(
      <DesktopSidebar
        activeRightTab="none"
        conversations={mockConversations}
        copy={copy}
        locale="zh-CN"
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectRightTab={vi.fn()}
      />,
    );

    const projects = screen.getByRole("region", { name: "项目" });
    expect(within(projects).getAllByRole("button", { name: "打开文件夹" })).toHaveLength(1);
  });

  it("supports inline rename and cancellation in SidebarConversationItem", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onSelect = vi.fn();

    render(
      <SidebarConversationItem
        active={false}
        conversation={mockConversations[0]}
        copy={copy}
        onDelete={onDelete}
        onRename={onRename}
        onSelect={onSelect}
      />,
    );

    // 从操作菜单进入编辑态
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByLabelText("重命名");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("关于 TypeScript 重构的讨论");

    // 输入新标题并按 Enter
    await user.clear(input);
    await user.type(input, "新的重命名标题{Enter}");

    expect(onRename).toHaveBeenCalledWith("conv-today-1", "新的重命名标题");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: copy.confirm })).not.toBeInTheDocument();
  });

  it("saves the rename on blur and discards it on Escape", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(async () => undefined);

    render(
      <>
        <SidebarConversationItem
          active={false}
          conversation={mockConversations[0]}
          copy={copy}
          onDelete={vi.fn()}
          onRename={onRename}
          onSelect={vi.fn()}
        />
        <button type="button">外部</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    await user.clear(screen.getByLabelText("重命名"));
    await user.type(screen.getByLabelText("重命名"), "取消的标题{Escape}");
    expect(screen.queryByLabelText("重命名")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    await user.clear(screen.getByLabelText("重命名"));
    await user.type(screen.getByLabelText("重命名"), "失焦保存的标题");
    await user.click(screen.getByRole("button", { name: "外部" }));
    expect(onRename).toHaveBeenCalledWith("conv-today-1", "失焦保存的标题");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("重命名")).not.toBeInTheDocument();
  });

  it("supports pinning conversations and rendering pinned section", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    render(
      <DesktopSidebar
        activeRightTab="none"
        conversations={mockConversations}
        copy={copy}
        locale="zh-CN"
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectRightTab={vi.fn()}
        onTogglePinConversation={onTogglePin}
      />,
    );

    // 从操作菜单置顶
    await user.click(screen.getAllByRole("button", { name: "对话操作" })[0]!);
    await user.click(screen.getByRole("menuitem", { name: "置顶会话" }));

    expect(onTogglePin).toHaveBeenCalled();
  });

  it("archives from the item menu and lists archived conversations in a collapsed group", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn(async () => undefined);
    const archivedConversation = { ...mockConversations[1]!, archivedAt: 100 };
    render(
      <DesktopSidebar
        activeRightTab="none"
        conversations={[mockConversations[0]!, archivedConversation]}
        copy={copy}
        locale="zh-CN"
        onArchiveConversation={onArchive}
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectRightTab={vi.fn()}
        runningConversations={new Map([[mockConversations[0]!.id, "approval" as const]])}
      />,
    );

    const history = screen.getByRole("region", { name: "对话" });
    expect(within(history).queryByText(archivedConversation.title)).not.toBeInTheDocument();
    expect(within(history).getByRole("status", { name: "等待确认" })).toBeInTheDocument();

    await user.click(within(history).getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(onArchive).toHaveBeenCalledWith(mockConversations[0]!.id, true);

    const archive = screen.getByRole("region", { name: "已归档" });
    await user.click(within(archive).getByRole("button", { name: /已归档/ }));
    expect(within(archive).getByText(archivedConversation.title)).toBeInTheDocument();
    await user.click(within(archive).getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "取消归档" }));
    expect(onArchive).toHaveBeenCalledWith(archivedConversation.id, false);
  });

  it("asks for in-app confirmation before deleting", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => undefined);
    render(
      <SidebarConversationItem
        active={false}
        conversation={mockConversations[0]!}
        copy={copy}
        onDelete={onDelete}
        onRename={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("alertdialog", { name: "确定删除这段对话吗？" });
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "对话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith(mockConversations[0]!.id);
  });

  it("opens user popover from sidebar footer and triggers account, theme, locale, settings and signout", async () => {
    const user = userEvent.setup();
    const onToggleTheme = vi.fn();
    const onLocale = vi.fn();
    const onOpenSettings = vi.fn();
    const onSignOut = vi.fn();
    const showToast = vi.fn();

    render(
      <DesktopSidebar
        activeRightTab="none"
        conversations={mockConversations}
        copy={copy}
        locale="zh-CN"
        onDeleteConversation={vi.fn()}
        onLocale={onLocale}
        onNewChat={vi.fn()}
        onOpenSettings={onOpenSettings}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectRightTab={vi.fn()}
        onSignOut={onSignOut}
        onToggleTheme={onToggleTheme}
        resolvedTheme="dark"
        showToast={showToast}
      />,
    );

    // 1. 默认状态下浮层未打开
    expect(screen.queryByRole("dialog", { name: "用户账户与设置菜单" })).not.toBeInTheDocument();

    // 2. 点击底部常驻用户条展开浮层
    const userBar = screen.getByLabelText("用户资料与菜单");
    await user.click(userBar);

    const popover = screen.getByRole("dialog", { name: "用户账户与设置菜单" });
    expect(popover).toBeInTheDocument();
    expect(within(popover).getByText("Lite")).toBeInTheDocument();
    // 确认已无积分元素
    expect(screen.queryByTitle(/当前可用积分/)).not.toBeInTheDocument();
    expect(screen.queryByText(/每日签到/)).not.toBeInTheDocument();

    // 3. 点击称号徽章展开称号选择器，并切换为 Pro 称号
    const badgeBtn = screen.getByLabelText("切换称号，当前为 Lite");
    await user.click(badgeBtn);
    const proBtn = screen.getByRole("button", { name: "Pro" });
    await user.click(proBtn);
    expect(showToast).toHaveBeenCalledWith("已切换称号为「Pro」", "info");

    // 5. 点击语言切换
    const langBtn = screen.getByLabelText("选择语言");
    await user.click(langBtn);
    expect(onLocale).toHaveBeenCalledWith("ja-JP");

    // 6. 点击主题切换
    const themeBtn = screen.getByLabelText("切换主题");
    await user.click(themeBtn);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    // 7. 点击管理账户打开用户设置
    const accountBtn = screen.getByLabelText("管理账户");
    await user.click(accountBtn);
    expect(onOpenSettings).toHaveBeenCalledWith("user");
    // 点击后浮层自动关闭
    expect(screen.queryByRole("dialog", { name: "用户账户与设置菜单" })).not.toBeInTheDocument();

    // 8. 再次打开并点击偏好设置
    await user.click(userBar);
    const settingsBtn = screen.getByLabelText("设置");
    await user.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledWith("general");
    expect(screen.queryByRole("dialog", { name: "用户账户与设置菜单" })).not.toBeInTheDocument();

    // 9. 再次打开并点击报告问题（直接跳到 GitHub 仓库主页）
    await user.click(userBar);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const reportBtn = screen.getByLabelText("报告问题");
    await user.click(reportBtn);
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/liangcka/Yachiyo-chat-desktop",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.queryByRole("dialog", { name: "用户账户与设置菜单" })).not.toBeInTheDocument();
    openSpy.mockRestore();

    // 10. 再次打开并点击关闭应用（从原样板退出登录升级）
    await user.click(userBar);
    const closeAppBtn = screen.getByLabelText("关闭应用");
    await user.click(closeAppBtn);
    expect(onSignOut).toHaveBeenCalledTimes(1);

    // 11. 再次打开并测试 Esc 关闭
    await user.click(userBar);
    expect(screen.getByRole("dialog", { name: "用户账户与设置菜单" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "用户账户与设置菜单" })).not.toBeInTheDocument();
  });
});
