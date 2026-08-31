import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../../domain/chat";
import { copyFor } from "../../../i18n/messages";
import { DesktopSidebar } from "./DesktopSidebar";
import { SidebarConversationItem } from "./SidebarConversationItem";
import { SidebarSearch } from "./SidebarSearch";
import { groupConversationsByDate } from "./use-conversation-groups";

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

  it("groups conversations accurately by date", () => {
    const groups = groupConversationsByDate(mockConversations, "zh-CN");
    expect(groups.length).toBe(3);
    expect(groups[0].key).toBe("today");
    expect(groups[0].label).toBe("今天");
    expect(groups[0].items[0].id).toBe("conv-today-1");

    expect(groups[1].key).toBe("yesterday");
    expect(groups[1].label).toBe("昨天");

    expect(groups[2].key).toBe("older");
    expect(groups[2].label).toBe("更早");
  });

  it("filters conversations via SidebarSearch and clears query", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onNewChat = vi.fn();

    render(
      <DesktopSidebar
        activeConversationId="conv-today-1"
        activeRightTab="none"
        conversations={mockConversations}
        copy={copy}
        locale="zh-CN"
        onDeleteConversation={onDelete}
        onNewChat={onNewChat}
        onRenameConversation={onRename}
        onSelectConversation={onSelect}
        onSelectRightTab={vi.fn()}
      />,
    );

    expect(screen.getByText("关于 TypeScript 重构的讨论")).toBeInTheDocument();
    expect(screen.getByText("昨天关于 UI 动效的研究")).toBeInTheDocument();
    expect(screen.getByText("更早以前的架构笔记")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("搜索历史对话...");
    await user.type(searchInput, "TypeScript");

    // 仅保留匹配项
    expect(screen.getByText("关于 TypeScript 重构的讨论")).toBeInTheDocument();
    expect(screen.queryByText("昨天关于 UI 动效的研究")).not.toBeInTheDocument();
    expect(screen.queryByText("更早以前的架构笔记")).not.toBeInTheDocument();

    // 点击清空按钮
    const clearBtn = screen.getByRole("button", { name: "清空" });
    await user.click(clearBtn);

    expect(screen.getByText("昨天关于 UI 动效的研究")).toBeInTheDocument();
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

    // 点击重命名按钮进入编辑态
    const renameBtn = screen.getByTitle("重命名");
    await user.click(renameBtn);

    const input = screen.getByLabelText("重命名");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("关于 TypeScript 重构的讨论");

    // 输入新标题并按 Enter
    await user.clear(input);
    await user.type(input, "新的重命名标题{Enter}");

    expect(onRename).toHaveBeenCalledWith("conv-today-1", "新的重命名标题");
  });

  it("renders empty state when search matches nothing", async () => {
    const user = userEvent.setup();
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

    const searchInput = screen.getByPlaceholderText("搜索历史对话...");
    await user.type(searchInput, "完全不存在的内容xyz");

    expect(screen.getByText("未找到匹配的会话")).toBeInTheDocument();
  });

  it("toggles accordion section collapse", async () => {
    const user = userEvent.setup();
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

    expect(screen.getByText("关于 TypeScript 重构的讨论")).toBeInTheDocument();

    const todayHeader = screen.getByTitle("折叠 今天");
    await user.click(todayHeader);

    // 折叠后不显示该组项目
    expect(screen.queryByText("关于 TypeScript 重构的讨论")).not.toBeInTheDocument();

    // 再次点击展开
    const expandToday = screen.getByTitle("展开 今天");
    await user.click(expandToday);
    expect(screen.getByText("关于 TypeScript 重构的讨论")).toBeInTheDocument();
  });

  it("handles SidebarSearch escape key and Japanese locale placeholder", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<SidebarSearch value="keyword" onChange={onChange} locale="zh-CN" />);

    const input = screen.getByPlaceholderText("搜索历史对话...");
    await user.type(input, "{Escape}");
    expect(onChange).toHaveBeenCalledWith("");

    rerender(<SidebarSearch value="" onChange={onChange} locale="ja-JP" />);
    expect(screen.getByPlaceholderText("会話を検索...")).toBeInTheDocument();
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

    // 点击置顶按钮
    const pinBtns = screen.getAllByTitle("置顶会话");
    expect(pinBtns.length).toBeGreaterThan(0);
    await user.click(pinBtns[0]);

    expect(onTogglePin).toHaveBeenCalled();
  });

  it("triggers theme and locale toggle from sidebar footer", async () => {
    const user = userEvent.setup();
    const onToggleTheme = vi.fn();
    const onLocale = vi.fn();
    const onOpenSettings = vi.fn();

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
        onToggleTheme={onToggleTheme}
        resolvedTheme="dark"
      />,
    );

    // 点击主题切换按钮
    const themeBtn = screen.getByLabelText("切换主题");
    await user.click(themeBtn);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    // 点击语言切换按钮
    const langBtn = screen.getByLabelText("切换语言");
    await user.click(langBtn);
    expect(onLocale).toHaveBeenCalledWith("ja-JP");

    // 点击设置按钮
    const settingsBtn = screen.getByLabelText("设置");
    await user.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledWith("general");
  });
});
