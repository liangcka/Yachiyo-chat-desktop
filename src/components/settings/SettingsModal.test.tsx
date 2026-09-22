import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useChatController } from "../../app/use-chat-controller";
import type { Conversation } from "../../domain/chat";
import { copyFor } from "../../i18n/messages";
import { defaultWebSearchSettings } from "../../services/web-search-settings";
import { projectManager } from "../../services/project-manager";
import type { SharedViewProps } from "../../views/layout-types";
import { SettingsModal } from "./SettingsModal";

describe("SettingsModal", () => {
  const copy = copyFor("zh-CN");
  const now = Date.now();

  const mockConversations: Conversation[] = [
    {
      id: "c-1",
      title: "关于算法重构",
      locale: "zh-CN",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "c-2",
      title: "关于星空画布",
      locale: "zh-CN",
      createdAt: now - 3600000,
      updatedAt: now - 3600000,
    },
  ];

  const createMockSharedProps = (overrides?: Partial<SharedViewProps>): SharedViewProps => ({
    activeProviderSupportsImage: true,
    activeSkillIds: ["skill-search"],
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
      userMemory: "八千代是一名温柔可靠的少女助手",
    } as unknown as ReturnType<typeof useChatController>,
    conversations: mockConversations,
    copy,
    imageUrls: new Map(),
    isOnline: true,
    llmActiveProvider: "deepseek",
    llmEntries: [
      {
        provider: "deepseek",
        apiKey: "sk-test",
        model: "deepseek-chat",
      },
    ],
    onClearData: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onImage: vi.fn(),
    onLlmActivate: vi.fn().mockResolvedValue(undefined),
    onLlmClear: vi.fn().mockResolvedValue(undefined),
    onLlmSave: vi.fn().mockResolvedValue(undefined),
    onLocale: vi.fn().mockResolvedValue(undefined),
    onNewChat: vi.fn().mockResolvedValue(undefined),
    onRecall: vi.fn().mockResolvedValue(undefined),
    onRegenerate: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onSend: vi.fn(),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    onSkillToggle: vi.fn().mockResolvedValue(undefined),
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
    refreshHistory: vi.fn().mockResolvedValue(undefined),
    refreshLlm: vi.fn().mockResolvedValue(undefined),
    setComposerValue: vi.fn(),
    setPendingImageDataUrl: vi.fn(),
    showToast: vi.fn(),
    webSearchSettings: defaultWebSearchSettings,
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("默认渲染常规（General）面板并展示真实的系统状态与隐私模式", () => {
    const shared = createMockSharedProps();
    const onClose = vi.fn();

    render(
      <SettingsModal
        open={true}
        onClose={onClose}
        shared={shared}
        initialTab="general"
      />
    );

    // 标题与描述
    expect(screen.getByRole("heading", { name: "常规" })).toBeInTheDocument();
    expect(screen.getByText(/速览客户端运行环境、隐私保护策略与各项服务连接状态/)).toBeInTheDocument();

    // 隐私模式开关
    const privacySwitch = screen.getByRole("switch", { name: "切换隐私模式" });
    expect(privacySwitch).toBeInTheDocument();
    expect(privacySwitch).toHaveAttribute("aria-checked", "true");

    // 点击切换隐私模式
    fireEvent.click(privacySwitch);
    expect(privacySwitch).toHaveAttribute("aria-checked", "false");

    // 活跃大模型与会话数量
    expect(screen.getByText(/DeepSeek/)).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("当前共保存") && content.includes("组历史会话"))
    ).toBeInTheDocument();

    // 确保不再包含假账号信息与假手机号
    expect(screen.queryByText("安魂曲")).not.toBeInTheDocument();
    expect(screen.queryByText("152*******49")).not.toBeInTheDocument();
    expect(screen.queryByText("会员 Lite")).not.toBeInTheDocument();
    expect(screen.queryByText("xychunliang@gmail.com")).not.toBeInTheDocument();
  });

  it("当存在活跃工作区时，项目面板与侧边栏展示真实工作区名称与脱离逻辑", async () => {
    const user = userEvent.setup();
    const shared = createMockSharedProps();
    const onClose = vi.fn();

    // 模拟 projectManager 的活跃工作区
    await projectManager.switchProject("D:/projects/MyGameStudio");

    render(
      <SettingsModal
        open={true}
        onClose={onClose}
        shared={shared}
        initialTab="project"
      />
    );

    // 侧边栏和面板标题展示真实项目名称
    const projectNameElements = screen.getAllByText("MyGameStudio");
    expect(projectNameElements.length).toBeGreaterThan(0);
    expect(screen.getAllByText("D:/projects/MyGameStudio").length).toBeGreaterThanOrEqual(1);

    // 点击脱离工作区
    const detachBtn = screen.getByRole("button", { name: "脱离工作区" });
    await user.click(detachBtn);

    // 出现二次确认按钮
    const confirmBtn = screen.getByRole("button", { name: "确认脱离" });
    expect(confirmBtn).toBeInTheDocument();

    // 点击确认脱离
    await user.click(confirmBtn);
    expect(shared.showToast).toHaveBeenCalledWith("已分离当前工作区，返回独立会话模式", "info");

    // 活跃项目已被清空，并从最近列表脱离
    expect(projectManager.getState().activeProject).toBeNull();
    expect(projectManager.getState().recentProjects).not.toContain("D:/projects/MyGameStudio");
    expect(screen.getByText("暂未打开任何项目目录")).toBeInTheDocument();
    expect(screen.getByText("未绑定工作区")).toBeInTheDocument();
  });

  it("支持在侧栏与项目面板中移除历史项目及清空历史记录", async () => {
    const user = userEvent.setup();
    const shared = createMockSharedProps();
    const onClose = vi.fn();

    // 预设两个最近项目，但当前处于未绑定状态
    await projectManager.switchProject("D:/projects/AppAlpha");
    await projectManager.switchProject("D:/projects/AppBeta");
    await projectManager.switchProject(null);

    render(
      <SettingsModal
        open={true}
        onClose={onClose}
        shared={shared}
        initialTab="project"
      />
    );

    // 侧栏展示未绑定工作区以及「最近项目」微型标题
    expect(screen.getByText("未绑定工作区")).toBeInTheDocument();
    expect(screen.getByText("最近项目")).toBeInTheDocument();

    // 侧边栏显示移除按钮，点击可移除单个项目
    const removeAlphaBtn = screen.getByRole("button", {
      name: "从历史记录移除 AppAlpha",
    });
    await user.click(removeAlphaBtn);
    expect(shared.showToast).toHaveBeenCalledWith("已从历史记录移除 AppAlpha", "info");
    expect(projectManager.getState().recentProjects).not.toContain("D:/projects/AppAlpha");

    // 右侧面板中点击「清空历史」
    const clearAllBtn = screen.getByRole("button", { name: "清空历史" });
    await user.click(clearAllBtn);
    expect(shared.showToast).toHaveBeenCalledWith("已清空全部工作区历史记录", "info");
    expect(projectManager.getState().recentProjects).toEqual([]);
    expect(screen.queryByText("最近项目")).not.toBeInTheDocument();
  });

  it("点击各导航 Tab 能在面板之间流畅切换", async () => {
    const user = userEvent.setup();
    const shared = createMockSharedProps();
    const onClose = vi.fn();

    render(
      <SettingsModal
        open={true}
        onClose={onClose}
        shared={shared}
        initialTab="general"
      />
    );

    // 切到应用面板
    await user.click(screen.getByRole("tab", { name: "存储与维护" }));
    expect(screen.getByRole("heading", { name: "数据管理与系统维护" })).toBeInTheDocument();

    // 切到快捷键面板
    await user.click(screen.getByRole("tab", { name: "快捷键速查" }));
    expect(screen.getByRole("heading", { name: "键盘快捷键速查" })).toBeInTheDocument();
    expect(screen.getByText("Ctrl + N")).toBeInTheDocument();
  });

  it("按 Esc 键或点击关闭按钮会触发 onClose", async () => {
    const user = userEvent.setup();
    const shared = createMockSharedProps();
    const onClose = vi.fn();

    render(
      <SettingsModal
        open={true}
        onClose={onClose}
        shared={shared}
        initialTab="general"
      />
    );

    // 点击右上角关闭按钮
    await user.click(screen.getByRole("button", { name: "关闭设置" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // 按 Esc 键
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("点击左下角用户设置能够进入用户设置面板并配置与保存用户名", async () => {
    const user = userEvent.setup();
    const shared = createMockSharedProps();
    const onClose = vi.fn();

    render(
      <SettingsModal
        open={true}
        onClose={onClose}
        shared={shared}
        initialTab="general"
      />
    );

    // 左下角展示用户设置 Tab（默认用户名：酒寄彩叶）
    const userTab = screen.getByRole("tab", { name: "用户设置" });
    expect(userTab).toBeInTheDocument();
    expect(userTab).toHaveTextContent("酒寄彩叶");
    expect(userTab).toHaveTextContent("本地专属 · 个人资料");

    // 点击切换到用户设置
    await user.click(userTab);
    expect(screen.getByRole("heading", { name: "用户设置" })).toBeInTheDocument();
    expect(screen.getByText(/管理您的本地个人资料、头像与用户名/)).toBeInTheDocument();

    // 自定义用户名测试
    const usernameInput = screen.getByRole("textbox", { name: "用户名" });
    expect(usernameInput).toHaveValue("酒寄彩叶");
    await user.clear(usernameInput);
    await user.type(usernameInput, "小彩叶");
    const saveUsernameBtn = screen.getByRole("button", { name: "保存名称" });
    await user.click(saveUsernameBtn);
    expect(shared.showToast).toHaveBeenCalledWith("用户名已更新为「小彩叶」（本地保存）", "info");
    expect(userTab).toHaveTextContent("小彩叶");

    // 不再展示称呼相关输入框与语气预览
    expect(screen.queryByRole("textbox", { name: "八千代对您的称呼" })).not.toBeInTheDocument();
    expect(screen.queryByText(/八千代语气预览/)).not.toBeInTheDocument();
  });
});
