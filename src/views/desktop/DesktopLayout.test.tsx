import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { useChatController } from "../../app/use-chat-controller";
import type { Conversation } from "../../domain/chat";
import { copyFor } from "../../i18n/messages";
import { defaultWebSearchSettings } from "../../services/web-search-settings";
import { projectManager } from "../../services/project-manager";
import type { SharedViewProps } from "../layout-types";
import { DesktopLayout } from "./DesktopLayout";

const overlayBridge = vi.hoisted(() => ({
  show: vi.fn<(paused: boolean) => Promise<boolean>>(async () => true),
  hide: vi.fn(async () => true),
}));

vi.mock("../../services/desktop-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/desktop-bridge")>();
  return { ...actual, showControlOverlay: overlayBridge.show, hideControlOverlay: overlayBridge.hide };
});

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
    llmActiveEntryId: undefined,
    llmEntries: [],
    onClearData: vi.fn(),
    onDelete: vi.fn(),
    onImage: vi.fn(),
    onLlmActivate: vi.fn(),
    onLlmSetEnabled: vi.fn(),
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
    expect(screen.getByRole("region", { name: "项目" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "对话" })).toBeInTheDocument();
  });

  it("calls onNewChat when clicking new chat button", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const newBtn = screen.getByRole("button", { name: /新建对话/i });
    await user.click(newBtn);

    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("通过侧栏的独立设置入口打开设置并切换分类", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.queryByRole("dialog", { name: "设置中心" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(await screen.findByRole("dialog", { name: "设置中心" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "常规" })).toBeInTheDocument();
    expect(screen.getByText("本地隐私保护模式")).toBeInTheDocument();
    expect(screen.getByText("大语言模型服务 (LLM)")).toBeInTheDocument();

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

    const editBtn = screen.getByTitle(/点击重命名/);
    await user.click(editBtn);

    const input = screen.getByLabelText("重命名当前会话");
    expect(input).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "重命名后的标题{Enter}");

    expect(props.onRename).toHaveBeenCalledWith("conv-1", "重命名后的标题");
  });

  it("按 Escape 取消标题编辑时不保存", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    await user.click(screen.getByTitle(/点击重命名/));
    const input = screen.getByLabelText("重命名当前会话");
    await user.clear(input);
    await user.type(input, "尚未保存的标题");
    await user.keyboard("{Escape}");

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("重命名当前会话")).not.toBeInTheDocument();
  });

  it("标题保存完成前回车后再失焦只提交一次", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    props.onRename = vi.fn(() => new Promise<void>(() => undefined));
    render(<DesktopLayout {...props} />);

    await user.click(screen.getByTitle(/点击重命名/));
    const input = screen.getByLabelText("重命名当前会话");
    await user.clear(input);
    await user.type(input, "新标题{Enter}");
    await user.click(document.body);

    expect(props.onRename).toHaveBeenCalledExactlyOnceWith("conv-1", "新标题");
  });

  it.each(["Enter", "Tab"])("在输入框中用 %s 选择筛选后的快捷指令而不发送消息", async (key) => {
    const user = userEvent.setup();
    const props = createMockProps();
    props.composerValue = "/web";
    render(<DesktopLayout {...props} />);
    const input = screen.getByPlaceholderText(copy.inputHint);
    await user.click(input);
    await user.keyboard(`{${key}}`);

    expect(props.onWebSearchSettingsChange).toHaveBeenCalledExactlyOnceWith({
      enabled: !props.webSearchSettings.enabled,
    });
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.setComposerValue).toHaveBeenCalledWith("");
    expect(screen.queryByRole("listbox", { name: "快捷指令与技能选择" })).not.toBeInTheDocument();
  });

  it("筛选只有一条指令时方向键不会丢失选中项，输入法确认不执行指令", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    props.composerValue = "/web";
    render(<DesktopLayout {...props} />);
    const input = screen.getByPlaceholderText(copy.inputHint);
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(screen.getByRole("option", { name: "切换联网搜索" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(props.onWebSearchSettingsChange).not.toHaveBeenCalled();
    expect(props.onSend).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(props.onWebSearchSettingsChange).toHaveBeenCalledTimes(1);
  });

  it("加载会话时显示加载状态并禁用发送入口", () => {
    const props = createMockProps();
    props.controller.phase = "loading";
    props.composerValue = "待发送草稿";
    render(<DesktopLayout {...props} />);

    expect(screen.getByPlaceholderText("正在加载对话…")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: copy.inputHint })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.send })).toBeDisabled();
  });

  it("为桌面输入框提供日语标签，默认不显示快捷键提示", () => {
    const props = createMockProps();
    props.controller.locale = "ja-JP";
    props.copy = copyFor("ja-JP");
    render(<DesktopLayout {...props} />);

    expect(screen.getByRole("textbox", { name: props.copy.inputHint })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("Enter で送信 · Shift+Enter で改行")).not.toBeInTheDocument();
  });

  it("handles desktop keyboard shortcuts Ctrl+N, Ctrl+1, Ctrl+2, Ctrl+,, and Ctrl+[", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    await user.keyboard("{Control>}n{/Control}");
    expect(props.onNewChat).toHaveBeenCalled();

    // 快捷键中栏视图切换 Ctrl+2 (编辑器) / Ctrl+1 (对话)
    await user.keyboard("{Control>}2{/Control}");
    expect(screen.getByRole("button", { name: copy.editorViewTab })).toBeInTheDocument();

    await user.keyboard("{Control>}1{/Control}");
    expect(screen.getByRole("button", { name: copy.editorTab })).toBeInTheDocument();

    // 快捷键打开设置中心 Ctrl+,
    await user.keyboard("{Control>},{/Control}");
    expect(screen.getByRole("dialog", { name: "设置中心" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "设置中心" })).not.toBeInTheDocument();

    // 折叠侧边栏：不保留任何内容
    fireEvent.keyDown(window, { ctrlKey: true, key: "[" });
    expect(screen.queryByRole("complementary", { name: "桌面导航与历史会话" })).not.toBeInTheDocument();

    // 再次按快捷键展开侧边栏
    fireEvent.keyDown(window, { ctrlKey: true, key: "[" });
    expect(screen.getByRole("complementary", { name: "桌面导航与历史会话" })).toBeInTheDocument();
  });

  it("折叠侧边栏后不显示任何内容，可从标题栏展开", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    const { container } = render(<DesktopLayout {...props} />);

    const collapseBtn = screen.getByTitle("折叠侧边栏 (Ctrl+[)");
    await user.click(collapseBtn);

    const sidebarColumn = container.querySelector(".desktop-shell__sidebar");
    expect(sidebarColumn).toBeEmptyDOMElement();
    expect(container.querySelector<HTMLElement>(".desktop-shell")?.style.gridTemplateColumns).toMatch(/^0px /u);

    const expandBtns = screen.getAllByTitle("展开侧边栏 (Ctrl+[)");
    expect(expandBtns).toHaveLength(1);
    await user.click(expandBtns[0]);

    expect(screen.getByRole("complementary", { name: "桌面导航与历史会话" })).toBeInTheDocument();
  });

  it("窄视口默认折叠，可从标题栏临时展开", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    try {
      const user = userEvent.setup();
      render(<DesktopLayout {...createMockProps()} />);
      expect(screen.queryByRole("complementary", { name: "桌面导航与历史会话" })).not.toBeInTheDocument();
      await user.click(screen.getByTitle("展开侧边栏 (Ctrl+[)"));
      expect(screen.getByRole("complementary", { name: "桌面导航与历史会话" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("空白对话只显示输入框与上方的项目选择", () => {
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    expect(screen.queryByRole("region", { name: "欢迎体验" })).not.toBeInTheDocument();
    const main = screen.getByRole("main", { name: "核心对话工作台" });
    expect(within(main).getByTitle(/当前项目：无项目/)).toBeInTheDocument();
  });

  it("从侧栏项目菜单打开工作区，不进入设置", async () => {
    const user = userEvent.setup();
    await projectManager.switchProject("D:\\projects\\Yachiyo-chat-desktop");
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    const projects = screen.getByRole("region", { name: "项目" });
    expect(within(projects).getByText("Yachiyo-chat-desktop").closest("button")).toHaveAttribute("aria-current", "true");

    const gearBtn = within(projects).getByRole("button", { name: "打开文件与终端" });
    await user.click(gearBtn);
    expect(screen.queryByRole("dialog", { name: "设置中心" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "工作区" })).toHaveAttribute("aria-selected", "true");
  });



  it("首次发送后保留输入节点与焦点，并切换到底部布局", () => {
    const blankProps = createMockProps();
    const { container, rerender } = render(<DesktopLayout {...blankProps} />);

    const input = screen.getByRole("textbox", { name: copy.inputHint });
    input.focus();
    expect(container.querySelector(".desktop-chat-body--welcome")).toBeInTheDocument();
    expect(container.querySelectorAll(".desktop-composer-dock")).toHaveLength(1);

    const activeProps = { ...blankProps, controller: { ...blankProps.controller } };
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
    rerender(<DesktopLayout {...activeProps} />);

    expect(container.querySelector(".desktop-chat-body--welcome")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".desktop-composer-dock")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: copy.inputHint })).toBe(input);
    expect(input).toHaveFocus();
  });

  it("opens SettingsModal on custom tab when clicking manage all skills in skill popover", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    await user.click(screen.getByRole("button", { name: "添加文件、项目或技能" }));
    await user.click(screen.getByRole("button", { name: "加载技能" }));

    // 点击管理全部技能
    const manageSkillsBtn = screen.getByRole("button", { name: /管理全部技能/i });
    await user.click(manageSkillsBtn);

    // 应唤起设置中心，且直达“自定义”标签页（技能与个性化记忆）
    expect(await screen.findByRole("dialog", { name: "设置中心" })).toBeInTheDocument();
    expect(screen.getByText("技能与个性化记忆")).toBeInTheDocument();
    expect(screen.getByText("技能扩展")).toBeInTheDocument();
  });

  it("does not render capture or settings buttons in top bar and removes desktop-chat-header", () => {
    const props = createMockProps();
    const { container } = render(<DesktopLayout {...props} />);

    // 验证纯双栏架构：右侧多功能工具面板不存在
    expect(screen.queryByRole("complementary", { name: "桌面多功能工具面板" })).not.toBeInTheDocument();

    // 验证中栏已移除旧的 desktop-chat-header
    expect(container.querySelector(".desktop-chat-header")).not.toBeInTheDocument();

    // 验证顶栏不再渲染设置与拍摄按钮
    const topbar = screen.getByRole("banner", { name: "应用顶栏" });
    expect(topbar).toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "设置与偏好" })).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "拍摄" })).not.toBeInTheDocument();
  });

  it("toggles right artifacts and review pane via Ctrl+B and header button", async () => {
    const user = userEvent.setup();
    const props = createMockProps();
    render(<DesktopLayout {...props} />);

    // 初始状态：右侧面板关闭
    expect(screen.queryByRole("complementary", { name: "成果与多功能审阅面板" })).not.toBeInTheDocument();

    // 1. 点击顶栏成果审阅按钮展开
    const toggleBtn = screen.getByRole("button", { name: "展开成果面板" });
    await user.click(toggleBtn);

    expect(screen.getByRole("complementary", { name: "成果与多功能审阅面板" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "代码审阅" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "成果工件" })).toBeInTheDocument();

    // 2. 使用快捷键 Ctrl+B 关闭
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.queryByRole("complementary", { name: "成果与多功能审阅面板" })).not.toBeInTheDocument();

    // 3. 再次使用快捷键 Ctrl+B 重新展开
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("complementary", { name: "成果与多功能审阅面板" })).toBeInTheDocument();

    // 4. 点击面板右上角关闭按钮收起
    const closeBtn = screen.getByRole("button", { name: "关闭成果面板" });
    await user.click(closeBtn);
    expect(screen.queryByRole("complementary", { name: "成果与多功能审阅面板" })).not.toBeInTheDocument();
  });

  it("keeps the control status bar but pauses control while a permission card is pending", () => {
    overlayBridge.show.mockClear();
    const props = createMockProps();
    props.controller.phase = "streaming";
    props.controller.pendingPermission = {
      toolName: "mcp__windows_mcp__click",
      toolArgs: { x: 100, y: 100 },
      reason: "模拟点击屏幕",
    } as never;
    props.controller.messages = [
      {
        id: "msg-1",
        conversationId: "conv-1",
        role: "assistant",
        text: "正在执行点击...",
        status: "streaming",
        createdAt: Date.now(),
        toolSteps: [
          {
            id: "step-1",
            name: "mcp__windows_mcp__click",
            argumentsJson: JSON.stringify({ x: 100, y: 100 }),
          },
        ],
      },
    ];

    render(<DesktopLayout {...props} />);
    expect(overlayBridge.show).toHaveBeenCalledWith(true);
  });

  it("shows the system control overlay and lets Esc cancel while a control tool runs", () => {
    overlayBridge.show.mockClear();
    const props = createMockProps();
    props.controller.phase = "streaming";
    props.controller.pendingPermission = undefined;
    props.controller.messages = [
      {
        id: "msg-1",
        conversationId: "conv-1",
        role: "assistant",
        text: "正在执行点击...",
        status: "streaming",
        createdAt: Date.now(),
        toolSteps: [
          {
            id: "step-1",
            name: "mcp__windows_mcp__click",
            argumentsJson: JSON.stringify({ x: 100, y: 100 }),
          },
        ],
      },
    ];

    render(<DesktopLayout {...props} />);
    expect(overlayBridge.show).toHaveBeenCalledWith(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.controller.stop).toHaveBeenCalled();
  });

  it("does not show the control overlay for run_command during streaming", () => {
    overlayBridge.show.mockClear();
    const props = createMockProps();
    props.controller.phase = "streaming";
    props.controller.pendingPermission = undefined;
    props.controller.messages = [
      {
        id: "msg-1",
        conversationId: "conv-1",
        role: "assistant",
        text: "正在执行终端命令...",
        status: "streaming",
        createdAt: Date.now(),
        toolSteps: [
          {
            id: "step-1",
            name: "run_command",
            argumentsJson: JSON.stringify({ command: "dir" }),
          },
        ],
      },
    ];

    render(<DesktopLayout {...props} />);
    expect(overlayBridge.show).not.toHaveBeenCalled();
  });
});
