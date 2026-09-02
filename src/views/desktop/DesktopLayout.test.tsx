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

  const now = Date.now();
  const mockConversations: Conversation[] = [
    {
      id: "conv-1",
      title: "第一次对话",
      locale: "zh-CN",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "conv-2",
      title: "第二次探索",
      locale: "zh-CN",
      createdAt: now - 86400000 * 10,
      updatedAt: now - 86400000 * 10,
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
    // 验证手风琴时间分组渲染
    expect(screen.getByText("今天")).toBeInTheDocument();
    expect(screen.getByText("更早")).toBeInTheDocument();
  });

  it("calls onNewChat when clicking new chat button", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const newBtn = screen.getByRole("button", { name: /新建对话/i });
    await user.click(newBtn);

    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("opens SettingsModal when clicking bottom settings in sidebar", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.queryByRole("dialog", { name: "设置中心" })).not.toBeInTheDocument();

    // 点击侧边栏底部的设置入口
    const settingsBtn = screen.getByTitle("系统设置与偏好");
    await user.click(settingsBtn);

    expect(screen.getByRole("dialog", { name: "设置中心" })).toBeInTheDocument();
    expect(screen.getByText(/配置智能体执行、排队消息发送以及权限/i)).toBeInTheDocument();
    expect(screen.getByText("当前活跃大模型")).toBeInTheDocument();
    expect(screen.getByText("本地持久化存储")).toBeInTheDocument();

    // 切换到模型配置标签
    const modelsTabBtn = screen.getByRole("tab", { name: /模型配置/i });
    await user.click(modelsTabBtn);
    expect(screen.getByText(/配置各 LLM Provider 厂商 API Key/i)).toBeInTheDocument();

    // 关闭设置
    const closeBtn = screen.getByRole("button", { name: "关闭设置" });
    await user.click(closeBtn);
    expect(screen.queryByRole("dialog", { name: "设置中心" })).not.toBeInTheDocument();
  });

  it("supports inline rename from top header", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const editBtn = screen.getByTitle("重命名会话");
    await user.click(editBtn);

    const input = screen.getByLabelText("重命名当前会话");
    expect(input).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "重命名后的标题{Enter}");

    expect(props.onRename).toHaveBeenCalledWith("conv-1", "重命名后的标题");
  });

  it("handles desktop keyboard shortcuts Ctrl+N, Ctrl+B, Ctrl+,, and Ctrl+[", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    await user.keyboard("{Control>}n{/Control}");
    expect(props.onNewChat).toHaveBeenCalled();

    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("complementary", { name: "桌面多功能工具面板" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "桌面多功能工具面板" })).not.toBeInTheDocument();

    // 快捷键打开设置中心 Ctrl+,
    await user.keyboard("{Control>},{/Control}");
    expect(screen.getByRole("dialog", { name: "设置中心" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "设置中心" })).not.toBeInTheDocument();

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

  it("renders 4 Hero welcome cards in blank conversation and sends prompt on card click", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.getByRole("region", { name: "欢迎体验" })).toBeInTheDocument();
    expect(screen.getByText("查看工作区代码")).toBeInTheDocument();
    expect(screen.getByText("日常陪伴与闲聊")).toBeInTheDocument();
    expect(screen.getByText("联网探索与研究")).toBeInTheDocument();
    expect(screen.getByText("视觉与图片分析")).toBeInTheDocument();

    const workspaceCard = screen.getByText("查看工作区代码").closest("button");
    expect(workspaceCard).not.toBeNull();
    if (workspaceCard) {
      await user.click(workspaceCard);
      expect(props.onSend).toHaveBeenCalledWith(
        expect.stringContaining("八千代，请帮我查看当前工作区根目录下有哪些文件和文件夹"),
      );
    }
  });

  it("opens workspace pane when clicking context chip above composer", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const contextChip = screen.getByTitle(/当前工作区：Yachiyo-chat-desktop/i);
    expect(contextChip).toBeInTheDocument();

    await user.click(contextChip);
    expect(screen.getByRole("complementary", { name: "桌面多功能工具面板" })).toBeInTheDocument();
  });

  it("renders composer centered inside hero in blank conversation and at bottom dock when messages exist", () => {
    const blankProps = createMockProps();
    const { container: blankContainer } = render(<DesktopLayout {...blankProps} />);

    // 空白新对话：居中在 hero 区域内，底部无 dock
    const heroComposer = blankContainer.querySelector(".desktop-hero__composer .dsh-composer-card");
    expect(heroComposer).toBeInTheDocument();
    expect(blankContainer.querySelector(".desktop-composer-dock")).not.toBeInTheDocument();

    // 存在消息状态：hero 不存在，输入框位于底部 dock
    const activeProps = createMockProps();
    activeProps.controller.messages = [
      {
        id: "msg-1",
        conversationId: "conv-1",
        role: "user",
        text: "你好八千代",
        status: "complete",
        createdAt: Date.now(),
      },
    ];
    const { container: activeContainer } = render(<DesktopLayout {...activeProps} />);

    expect(activeContainer.querySelector(".desktop-hero")).not.toBeInTheDocument();
    const bottomComposer = activeContainer.querySelector(".desktop-composer-dock .dsh-composer-card");
    expect(bottomComposer).toBeInTheDocument();
  });
});
