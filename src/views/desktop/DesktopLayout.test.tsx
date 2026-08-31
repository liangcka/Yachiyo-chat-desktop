import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { useChatController } from "../../app/use-chat-controller";
import type { Conversation } from "../../domain/chat";
import { copyFor } from "../../i18n/messages";
import { defaultWebSearchSettings } from "../../services/web-search-settings";
import type { SharedViewProps } from "../layout-types";
import { DesktopLayout } from "./DesktopLayout";

describe("DesktopLayout", () => {
  const copy = copyFor("zh-CN");

  const mockConversations: Conversation[] = [
    {
      id: "conv-1",
      title: "第一次对话",
      locale: "zh-CN",
      createdAt: 1756512000000,
      updatedAt: 1756512000000,
    },
    {
      id: "conv-2",
      title: "第二次探索",
      locale: "zh-CN",
      createdAt: 1756515600000,
      updatedAt: 1756515600000,
    },
  ];

  const createMockProps = (): SharedViewProps => ({
    activeProviderSupportsImage: true,
    activeSkillIds: [],
    composerValue: "",
    controller: {
      activeConversation: mockConversations[0],
      compressConversation: vi.fn().mockResolvedValue(true),
      errorCode: undefined,
      hasMoreHistory: false,
      loadEarlier: vi.fn(),
      locale: "zh-CN",
      messages: [],
      newConversation: vi.fn(),
      phase: "idle",
      recall: vi.fn(),
      regenerate: vi.fn(),
      selectConversation: vi.fn(),
      send: vi.fn(),
      setLocale: vi.fn(),
      setOnline: vi.fn(),
      setPendingImage: vi.fn(),
      stop: vi.fn(),
      updateUserMemory: vi.fn().mockResolvedValue(true),
      userMemory: "",
    } as unknown as ReturnType<typeof useChatController>,
    conversations: mockConversations,
    copy,
    imageUrls: new Map(),
    isOnline: true,
    llmActiveProvider: undefined,
    llmEntries: [],
    onClearData: vi.fn(),
    onDelete: vi.fn(),
    onImage: vi.fn(),
    onLlmActivate: vi.fn(),
    onLlmClear: vi.fn(),
    onLlmSave: vi.fn(),
    onLocale: vi.fn(),
    onNewChat: vi.fn(),
    onRecall: vi.fn(),
    onRegenerate: vi.fn(),
    onRename: vi.fn(),
    onSend: vi.fn(),
    onSignOut: vi.fn(),
    onSkillToggle: vi.fn(),
    onWebSearchSettingsChange: vi.fn(),
    pendingImageDataUrl: undefined,
    processImage: vi.fn(),
    pwa: {
      needRefresh: false,
      offlineReady: false,
      setNeedRefresh: vi.fn(),
      setOfflineReady: vi.fn(),
      updateServiceWorker: vi.fn(),
    },
    refreshHistory: vi.fn(),
    refreshLlm: vi.fn(),
    setComposerValue: vi.fn(),
    setPendingImageDataUrl: vi.fn(),
    showToast: vi.fn(),
    webSearchSettings: defaultWebSearchSettings,
  });

  it("renders desktop sidebar with conversations and main chat workspace", () => {
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.getByRole("complementary", { name: "桌面导航与历史会话" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "核心对话工作台" })).toBeInTheDocument();
    expect(screen.getAllByText("第一次对话").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("第二次探索")).toBeInTheDocument();
  });

  it("calls onNewChat when clicking new chat button", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const newBtn = screen.getByRole("button", { name: /新建对话/i });
    await user.click(newBtn);

    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("switches right pane when clicking tools in sidebar", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.queryByRole("complementary", { name: "桌面多功能工具面板" })).not.toBeInTheDocument();

    const workspaceBtn = screen.getByTitle(copy.workspaceEntry);
    await user.click(workspaceBtn);

    expect(screen.getByRole("complementary", { name: "桌面多功能工具面板" })).toBeInTheDocument();

    const llmBtn = screen.getByTitle(copy.llmSettingsEntry);
    await user.click(llmBtn);

    expect(screen.getByRole("complementary", { name: "桌面多功能工具面板" })).toBeInTheDocument();
  });

  it("handles desktop keyboard shortcuts Ctrl+N, Ctrl+B, and Ctrl+[", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    await user.keyboard("{Control>}n{/Control}");
    expect(props.onNewChat).toHaveBeenCalled();

    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("complementary", { name: "桌面多功能工具面板" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "桌面多功能工具面板" })).not.toBeInTheDocument();

    // 折叠侧边栏为 Rail 模式
    fireEvent.keyDown(window, { ctrlKey: true, key: "[" });
    expect(screen.getByRole("complementary", { name: "紧凑导航栏" })).toBeInTheDocument();

    // 再次按快捷键展开侧边栏
    fireEvent.keyDown(window, { ctrlKey: true, key: "[" });
    expect(screen.getByRole("complementary", { name: "桌面导航与历史会话" })).toBeInTheDocument();
  });

  it("toggles rail sidebar mode via collapse button and restores wide mode", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const collapseBtn = screen.getByTitle("折叠侧边栏 (Ctrl+[)");
    await user.click(collapseBtn);

    expect(screen.getByRole("complementary", { name: "紧凑导航栏" })).toBeInTheDocument();

    const expandBtns = screen.getAllByTitle("展开侧边栏 (Ctrl+[)");
    expect(expandBtns.length).toBeGreaterThanOrEqual(1);
    await user.click(expandBtns[0]);

    expect(screen.getByRole("complementary", { name: "桌面导航与历史会话" })).toBeInTheDocument();
  });

  it("renders DSH Hero welcome cards in blank conversation and sends prompt on card click", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.getByRole("region", { name: "欢迎体验" })).toBeInTheDocument();
    expect(screen.getByText("查看工作区代码")).toBeInTheDocument();

    const workspaceCard = screen.getByText("查看工作区代码").closest("button");
    expect(workspaceCard).not.toBeNull();
    if (workspaceCard) {
      await user.click(workspaceCard);
      expect(props.onSend).toHaveBeenCalledWith(
        expect.stringContaining("八千代，请帮我查看当前工作区根目录下有哪些文件和文件夹"),
      );
    }
  });
});
