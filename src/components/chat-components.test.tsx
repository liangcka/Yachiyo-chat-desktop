import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { ConversationView } from "./ConversationView";
import { MessageBubble } from "./MessageBubble";
import { SkillsPanel } from "./SkillsPanel";

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    conversationId: "one",
    createdAt: 1,
    id: "assistant-1",
    role: "assistant",
    status: "complete",
    text: "",
    ...overrides,
  };
}

describe("reference chat components", () => {
  it("separates assistant and user messages in a readable live log", () => {
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant",
        role: "assistant",
        status: "complete",
        text: "彩叶~今天也辛苦啦！",
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "user",
        role: "user",
        status: "complete",
        text: "谢谢你",
      },
    ];
    render(<ConversationView locale="zh-CN" messages={messages} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "八千代的回复" })).toHaveTextContent(
      "彩叶~今天也辛苦啦！",
    );
    expect(screen.getByRole("article", { name: "我的消息" })).toHaveClass(
      "message-bubble--user",
    );
  });

  it("assistant 消息按 toolSteps 渲染工具卡片", () => {
    const message = makeAssistantMessage({
      toolSteps: [
        {
          id: "call-1",
          name: "read_file",
          argumentsJson: '{"path":"a.ts"}',
          result: { output: "hi", isError: false, durationMs: 3 },
        },
      ],
    });
    render(<MessageBubble locale="zh-CN" message={message} />);
    expect(screen.getByText("读取 a.ts")).toBeInTheDocument();
  });

  it("旧格式 tool_call 文本不再解析为卡片（按纯文本渲染）", () => {
    const message = makeAssistantMessage({
      text: '```tool_call\n{"name":"read_file"}\n```',
    });
    render(<MessageBubble locale="zh-CN" message={message} />);
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("助手直接展示正文，复制与重试入口位于消息末尾", () => {
    const message = makeAssistantMessage({
      skills: ["深度思维", "Humanizer"],
      text: "你好呀~",
    });
    const { container } = render(<MessageBubble locale="zh-CN" message={message} onRegenerate={vi.fn()} />);
    expect(screen.getByText("你好呀~")).toBeInTheDocument();
    expect(container.querySelector(".message-bubble__header")).toBeNull();
    expect(screen.queryByText("深度思维 · Humanizer")).not.toBeInTheDocument();
    const actions = container.querySelector(".message-bubble__actions") as HTMLElement;
    expect(within(actions).getByRole("button", { name: /复制/ })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "重新生成" })).toBeInTheDocument();
  });

  it.each([
    ["zh-CN", "本次回复未生成。"],
    ["ja-JP", "返信を生成できませんでした。"],
  ] as const)("%s 空失败回复仍可切回旧版本", (locale, placeholder) => {
    const onVersionChange = vi.fn();
    const message = makeAssistantMessage({ status: "failed", branchRootId: "original", branchVersion: 2 });
    render(<MessageBubble locale={locale} message={message} versions={[1, 2]} onVersionChange={onVersionChange} />);

    expect(screen.getByText(placeholder)).toBeVisible();
    const ja = locale === "ja-JP";
    expect(screen.getByLabelText(ja ? "メッセージのバージョン" : "消息版本")).toHaveTextContent("2 / 2");
    expect(screen.getByRole("button", { name: ja ? "次のバージョン" : "下一个版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ja ? "前のバージョン" : "上一个版本" }));
    expect(onVersionChange).toHaveBeenCalledWith(message.id, 1);
  });

  it("空的停止回复保留版本切换入口", () => {
    render(<MessageBubble locale="zh-CN" message={makeAssistantMessage({ status: "stopped", branchVersion: 2 })} versions={[1, 2]} onVersionChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "上一个版本" })).toBeEnabled();
    expect(screen.queryByText("本次回复未生成。")).not.toBeInTheDocument();
  });

  it("流式生成期间隐藏版本切换器", () => {
    const { rerender } = render(
      <MessageBubble
        locale="zh-CN"
        message={makeAssistantMessage({ status: "streaming", branchVersion: 2 })}
        versions={[1, 2]}
        onVersionChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("消息版本")).not.toBeInTheDocument();

    rerender(
      <MessageBubble
        locale="zh-CN"
        message={makeAssistantMessage({ status: "complete", branchVersion: 2 })}
        isGenerating={true}
        versions={[1, 2]}
        onVersionChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("消息版本")).not.toBeInTheDocument();
  });

  it("用户消息超过 12 行时折叠，点击展开显示全文", () => {
    const longText = Array.from({ length: 15 }, (_, i) => `这是第 ${i + 1} 行消息`).join("\n");
    const userMessage: ChatMessage = {
      conversationId: "one",
      id: "u-long",
      role: "user",
      text: longText,
      status: "complete",
      createdAt: Date.now(),
    };
    const { container } = render(<MessageBubble locale="zh-CN" message={userMessage} />);

    expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument();
    expect(container.querySelector(".message-bubble__user-content--collapsed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.queryByRole("button", { name: "展开" })).not.toBeInTheDocument();
    expect(container.querySelector(".message-bubble__user-content--collapsed")).not.toBeInTheDocument();
  });

  it("最后一条助手消息带有 message-bubble--last-assistant 类", () => {
    const message = makeAssistantMessage({ status: "complete", text: "最后一条助手消息" });
    const { container } = render(<MessageBubble locale="zh-CN" message={message} isLastAssistant={true} />);
    expect(container.querySelector(".message-bubble--last-assistant")).toBeInTheDocument();
  });

  it("按事件顺序穿插正文、思考与工具，仅折叠相邻工具", () => {
    const message = makeAssistantMessage({
      text: "执行之前。执行之后。最终结果。",
      thought: "需要检查配置。",
      toolSteps: ["one", "two", "three"].map((id) => ({
        id, name: "run_command", argumentsJson: JSON.stringify({ command: id }),
        result: { output: id, isError: id === "three", durationMs: 10 },
      })),
      contentSegments: [
        { type: "text", start: 0, end: 5 },
        { type: "thought", start: 0, end: 7, startedAtMs: 100, endedAtMs: 6100 },
        { type: "tool", toolId: "one" },
        { type: "tool", toolId: "two" },
        { type: "text", start: 5, end: 10 },
        { type: "tool", toolId: "three" },
        { type: "text", start: 10, end: 15 },
      ],
    });
    const { container } = render(<MessageBubble locale="zh-CN" message={message} />);
    const content = screen.getByRole("article", { name: "八千代的回复" });
    const children = [...content.children].filter((node) => !node.classList.contains("message-bubble__actions"));
    expect(children.map((node) => node.matches("details") ? node.querySelector("summary")!.textContent : node.textContent)).toEqual([
      "运行 3 步· 1 步失败", "最终结果。", "1 个未解决的问题命令 three：失败",
    ]);
    fireEvent.click(screen.getByText("运行 3 步"));
    expect([...container.querySelector(".message-process__content")!.children].map((node) => node.textContent)).toEqual([
      "执行之前。", "思考了 6 秒", expect.stringContaining("已运行 2 步"),
      "执行之后。", expect.stringContaining("已运行 1 步"),
    ]);
    const groups = container.querySelectorAll(".message-tool-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).not.toHaveAttribute("open");
    fireEvent.click(groups[0]!.querySelector("summary")!);
    expect(groups[0]).toHaveAttribute("open");
    expect(screen.queryByText("完成", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("1 步失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "思考了 6 秒" }));
    expect(screen.getByText("需要检查配置。")).toBeVisible();
  });

  it("ToolGroup 在流式运行中自动展开，完成后自动折叠", () => {
    const streamingMessage: ChatMessage = makeAssistantMessage({
      status: "streaming",
      text: "",
      toolSteps: [
        { id: "step1", name: "run_command", argumentsJson: JSON.stringify({ command: "check" }) },
      ],
      contentSegments: [{ type: "tool", toolId: "step1" }],
    });
    const { container, rerender } = render(<MessageBubble locale="zh-CN" message={streamingMessage} />);
    const group = container.querySelector(".message-tool-group");
    expect(group).toHaveAttribute("open");

    const completedMessage: ChatMessage = {
      ...streamingMessage,
      status: "complete",
      toolSteps: [
        {
          id: "step1",
          name: "run_command",
          argumentsJson: JSON.stringify({ command: "check" }),
          result: { output: "content", isError: false, durationMs: 12 },
        },
      ],
    };
    rerender(<MessageBubble locale="zh-CN" message={completedMessage} />);
    expect(group).not.toHaveAttribute("open");
  });

  it("ConversationView 展示已加载技能卡片", () => {
    const skills = [
      { id: "s1", name: "深度思维", description: "多步拆解与逻辑推理", content: "..." },
      { id: "s2", name: "精准事实", description: "严谨事实核对与抗幻觉", content: "..." },
    ];
    render(
      <ConversationView
        activeSkills={skills}
        locale="zh-CN"
        messages={[]}
      />,
    );
    expect(screen.getByText("已加载技能")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("深度思维")[0]).toBeInTheDocument();
    expect(screen.getAllByText("精准事实")[0]).toBeInTheDocument();
  });

  it("follows streaming updates only while the reader stays near the bottom", () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const firstMessage: ChatMessage = {
      conversationId: "one",
      createdAt: 1,
      id: "assistant-one",
      role: "assistant",
      status: "streaming",
      text: "",
    };
    const view = render(<ConversationView locale="zh-CN" messages={[firstMessage]} />);
    const conversation = view.container.querySelector<HTMLElement>(".conversation-view");
    expect(conversation).not.toBeNull();
    Object.defineProperties(conversation, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" });

    fireEvent.scroll(conversation!);
    scrollIntoView.mockClear();
    view.rerender(
      <ConversationView
        locale="zh-CN"
        messages={[{ ...firstMessage, text: "用户正在向上阅读" }]}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    conversation!.scrollTop = 540;
    fireEvent.scroll(conversation!);
    view.rerender(
      <ConversationView
        locale="zh-CN"
        messages={[{ ...firstMessage, text: "回到底部后继续跟随" }]}
      />,
    );
    // 流式增量每帧都会触发，直接定位到底部，不重启平滑滚动
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(conversation!.scrollTop).toBe(1_000);

    const nextMessage: ChatMessage = {
      conversationId: "one",
      createdAt: 2,
      id: "assistant-two",
      role: "assistant",
      status: "streaming",
      text: "",
    };
    conversation!.scrollTop = 0;
    fireEvent.scroll(conversation!);
    scrollIntoView.mockClear();
    view.rerender(
      <ConversationView locale="zh-CN" messages={[firstMessage, nextMessage]} />,
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" });
  });

  it("uses instant scrolling for appended messages when reduced motion is requested", () => {
    const reducedMotionQuery = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    };
    vi.mocked(window.matchMedia)
      .mockReturnValueOnce(reducedMotionQuery)
      .mockReturnValueOnce(reducedMotionQuery);
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const firstMessage: ChatMessage = {
      conversationId: "one",
      createdAt: 1,
      id: "assistant-one",
      role: "assistant",
      status: "complete",
      text: "少一点动态也很好",
    };
    const view = render(<ConversationView locale="zh-CN" messages={[firstMessage]} />);
    const conversation = view.container.querySelector<HTMLElement>(".conversation-view");
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    view.rerender(
      <ConversationView
        locale="zh-CN"
        messages={[
          firstMessage,
          { ...firstMessage, createdAt: 2, id: "assistant-two", text: "第二条回复" },
        ]}
      />,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(conversation!.scrollTop).toBe(1_000);
  });

  it("shows recall in the hover bar of the latest user message; right-click opens no custom menu, touch long-press does", () => {
    const onRecall = vi.fn();
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "user-1",
        role: "user",
        status: "complete",
        text: "第一条用户消息",
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "第一条回复",
      },
      {
        conversationId: "one",
        createdAt: 3,
        id: "user-2",
        role: "user",
        status: "complete",
        text: "第二条用户消息",
      },
      {
        conversationId: "one",
        createdAt: 4,
        id: "assistant-2",
        role: "assistant",
        status: "complete",
        text: "第二条回复",
      },
    ];

    render(<ConversationView locale="zh-CN" messages={messages} onRecall={onRecall} />);

    const [firstUserBubble, latestUserBubble] = screen.getAllByRole("article", { name: "我的消息" });
    expect(within(firstUserBubble!).queryByRole("button", { name: "撤回" })).not.toBeInTheDocument();
    expect(within(latestUserBubble!).getByRole("button", { name: "复制" })).toBeInTheDocument();

    fireEvent.contextMenu(latestUserBubble!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(within(latestUserBubble!).getByRole("button", { name: "撤回" }));
    expect(onRecall).toHaveBeenCalledOnce();

    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(latestUserBubble!, { pointerType: "touch", clientX: 0, clientY: 0 });
      act(() => vi.advanceTimersByTime(450));
      expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "撤回" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies message text to clipboard and calls onToast when the copy button is clicked", async () => {
    const onToast = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "这是八千代的回答",
      },
    ];

    render(<ConversationView locale="zh-CN" messages={messages} onToast={onToast} />);

    const assistantBubble = screen.getByRole("article", { name: "八千代的回复" });
    await userEvent.click(within(assistantBubble).getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith("这是八千代的回答");
    expect(onToast).toHaveBeenCalledWith("已复制");
  });

  it("renders the regenerate button for the latest assistant message", async () => {
    const onRegenerate = vi.fn();
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "user-1",
        role: "user",
        status: "complete",
        text: "你好",
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "你好呀！",
      },
    ];

    render(
      <ConversationView
        locale="zh-CN"
        messages={messages}
        onRegenerate={onRegenerate}
      />,
    );

    const assistantBubble = screen.getByRole("article", { name: "八千代的回复" });
    expect(within(assistantBubble).getByRole("button", { name: "复制" })).toBeInTheDocument();
    fireEvent.click(within(assistantBubble).getByRole("button", { name: "重新生成" }));
    expect(onRegenerate).toHaveBeenCalledWith("assistant-1");
  });

  it("renders source links under assistant replies and respects the showSources switch", () => {
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "基于搜索的回复",
        sources: [
          { title: "必应搜索结果一", url: "https://www.bing.com/" },
          { title: "必应搜索结果二", url: "https://cn.bing.com/" },
        ],
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "user-1",
        role: "user",
        status: "complete",
        text: "用户消息不渲染来源",
        sources: [{ title: "不应出现", url: "https://example.com/" }],
      },
    ];

    const { rerender } = render(<ConversationView locale="zh-CN" messages={messages} />);

    const sourcesRegion = screen.getByLabelText("参考来源");
    const links = within(sourcesRegion).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://www.bing.com/");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[1]).toHaveAttribute("href", "https://cn.bing.com/");

    // 关闭"显示引用来源"后不再渲染列表
    rerender(<ConversationView locale="zh-CN" messages={messages} showSources={false} />);
    expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();
  });

  it("keeps the typing indicator clean while sources arrive before any reply text", () => {
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant-1",
        role: "assistant",
        status: "streaming",
        text: "",
        sources: [{ title: "必应搜索结果一", url: "https://www.bing.com/" }],
      },
    ];

    render(<ConversationView locale="zh-CN" messages={messages} />);

    expect(screen.getByRole("status")).toHaveTextContent("思考中…");
    expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();

    // 正文开始流式输出后，来源区块随正文出现
    const streaming: ChatMessage[] = [
      { ...messages[0]!, text: "彩叶~查到啦", status: "streaming" },
    ];
    cleanup();
    render(<ConversationView locale="zh-CN" messages={streaming} />);
    expect(screen.getByText("彩叶~查到啦")).toBeInTheDocument();
    expect(screen.getByLabelText("参考来源")).toBeInTheDocument();
  });

  it("hides citation markers in the reply text when the showSources switch is off", () => {
    const base: ChatMessage = {
      conversationId: "one",
      createdAt: 1,
      id: "assistant-1",
      role: "assistant",
      status: "complete",
      text: "彩叶~上海今天晴哦！[1][2]",
      sources: [
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ],
    };

    // 开关开启：正文保留 [n] 标记，与来源列表序号对应
    const { rerender } = render(
      <ConversationView locale="zh-CN" messages={[base]} showSources />,
    );
    expect(screen.getByText("彩叶~上海今天晴哦！[1][2]")).toBeInTheDocument();
    expect(screen.getByLabelText("参考来源")).toBeInTheDocument();

    // 开关关闭：正文中的 [n] 标记与来源列表一并隐藏（仅展示层，存储不变）
    rerender(<ConversationView locale="zh-CN" messages={[base]} showSources={false} />);
    expect(screen.getByText("彩叶~上海今天晴哦！")).toBeInTheDocument();
    expect(screen.queryByText(/\[\d\]/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();
  });

  it("renders web search toggles and reports enabled state via callbacks", async () => {
    const user = userEvent.setup();
    const onWebSearchSettingsChange = vi.fn();
    const { rerender } = render(
      <SkillsPanel
        activeIds={[]}
        copy={copyFor("zh-CN")}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onWebSearchSettingsChange={onWebSearchSettingsChange}
        open
        skills={[]}
        webSearchSettings={{
          enabled: false,
          showSources: true,
          smart: false,
        }}
      />,
    );

    expect(screen.getByText("联网搜索")).toBeVisible();
    expect(screen.getByText("发送前先用必应搜索网络资料，回复将基于最新信息")).toBeVisible();
    expect(screen.getByText("显示引用来源")).toBeVisible();
    expect(screen.getByText("在联网回复下方显示参考来源链接")).toBeVisible();
    expect(screen.getByText("智能搜索")).toBeVisible();
    expect(screen.getByText("同时检索国际市场近30天结果，提升时效信息的准确性")).toBeVisible();

    const enabledToggle = screen.getByRole("button", {
      name: "切换技能启用状态: 联网搜索",
    });
    const showSourcesToggle = screen.getByRole("button", {
      name: "切换技能启用状态: 显示引用来源",
    });
    const smartToggle = screen.getByRole("button", {
      name: "切换技能启用状态: 智能搜索",
    });
    expect(enabledToggle).toHaveAttribute("aria-pressed", "false");
    expect(showSourcesToggle).toHaveAttribute("aria-pressed", "true");
    expect(smartToggle).toHaveAttribute("aria-pressed", "false");
    // 联网关闭时"显示引用来源"与"智能搜索"按钮均禁用置灰
    expect(showSourcesToggle).toBeDisabled();
    expect(smartToggle).toBeDisabled();

    await user.click(enabledToggle);
    expect(onWebSearchSettingsChange).toHaveBeenCalledWith({ enabled: true });

    // 联网开启后"显示引用来源"与"智能搜索"均可点击
    rerender(
      <SkillsPanel
        activeIds={[]}
        copy={copyFor("zh-CN")}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onWebSearchSettingsChange={onWebSearchSettingsChange}
        open
        skills={[]}
        webSearchSettings={{
          enabled: true,
          showSources: true,
          smart: false,
        }}
      />,
    );
    expect(showSourcesToggle).toBeEnabled();
    expect(smartToggle).toBeEnabled();

    await user.click(showSourcesToggle);
    expect(onWebSearchSettingsChange).toHaveBeenCalledWith({ showSources: false });
  });

  it("renders refined thinking indicator during streaming wait period", () => {
    const message = makeAssistantMessage({
      status: "streaming",
      text: "",
    });

    const { rerender } = render(<MessageBubble locale="zh-CN" message={message} />);
    expect(screen.getByRole("status")).toHaveTextContent("思考中…");
    expect(screen.getByText("思考中…")).toBeInTheDocument();

    rerender(<MessageBubble locale="ja-JP" message={message} />);
    expect(screen.getByText("考え中…")).toBeInTheDocument();
  });

  it("renders deep thinking block and supports expanding/collapsing thought process", () => {
    const message = makeAssistantMessage({
      status: "streaming",
      text: "",
      thought: "先分析用户的问题，再构思回答...",
    });

    const { rerender } = render(<MessageBubble locale="zh-CN" message={message} />);
    expect(screen.getByText("思考中…")).toBeInTheDocument();
    expect(screen.getByText("先分析用户的问题，再构思回答...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /思考中/ }));
    expect(screen.getAllByText("先分析用户的问题，再构思回答...")).toHaveLength(2);

    // 正文到达且完成思考
    rerender(
      <MessageBubble
        locale="zh-CN"
        message={{
          ...message,
          status: "complete",
          text: "你好呀！",
        }}
      />,
    );
    expect(screen.getByText("查看思考")).toBeInTheDocument();
    expect(screen.getByText("你好呀！")).toBeInTheDocument();
  });

  describe("Agent 未正常收尾的说明", () => {
    const toolStep = { id: "call-1", name: "read_file", argumentsJson: '{"path":"a.ts"}', result: { output: "hi", isError: false, durationMs: 3 } };
    const zh = copyFor("zh-CN");

    it("最后一步是工具调用且之后没有正文时提示并可继续", () => {
      const onContinue = vi.fn();
      const message = makeAssistantMessage({
        text: "先看看",
        toolSteps: [toolStep],
        contentSegments: [{ type: "text", start: 0, end: 3 }, { type: "tool", toolId: "call-1" }],
      });
      render(<MessageBubble locale="zh-CN" message={message} onContinue={onContinue} />);
      expect(screen.getByText(zh.runNoFinalAnswer)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: zh.continueRun }));
      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["stopped", zh.runStopped],
      ["failed", zh.runFailed],
    ] as const)("%s 状态说明原因", (status, note) => {
      const message = makeAssistantMessage({ status, text: "做了一半", toolSteps: [toolStep] });
      render(<MessageBubble locale="zh-CN" message={message} />);
      expect(screen.getByText(note)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: zh.continueRun })).not.toBeInTheDocument();
    });

    it("请求取消后显示正在取消与仍在等待的操作，收尾后区分已确认与结果未知", () => {
      const cancelling = makeAssistantMessage({
        status: "streaming", text: "", toolSteps: [toolStep], cancelRequested: true,
        cancelPending: [{ callId: "m1", name: "mcp__fs__write", detail: "等待 MCP 工具返回" }],
      });
      const { rerender } = render(<MessageBubble locale="zh-CN" message={cancelling} />);
      expect(screen.getByText(`${zh.runCancelling} mcp__fs__write：等待 MCP 工具返回`)).toBeInTheDocument();

      rerender(<MessageBubble locale="zh-CN" message={makeAssistantMessage({ status: "stopped", text: "做了一半", toolSteps: [toolStep], cancellation: { confirmed: true } })} />);
      expect(screen.getByText(zh.runCancelled)).toBeInTheDocument();

      rerender(<MessageBubble locale="zh-CN" message={makeAssistantMessage({
        status: "stopped", text: "做了一半", toolSteps: [toolStep],
        cancellation: { confirmed: false, unknown: [{ callId: "m1", name: "mcp__fs__write", detail: "未返回" }] },
      })} />);
      expect(screen.getByText(zh.runCancelUnknown("mcp__fs__write"))).toBeInTheDocument();
    });

    it("正常以正文收尾时不显示说明", () => {
      const message = makeAssistantMessage({
        text: "结论",
        toolSteps: [toolStep],
        contentSegments: [{ type: "tool", toolId: "call-1" }, { type: "text", start: 0, end: 2 }],
      });
      render(<MessageBubble locale="zh-CN" message={message} onContinue={vi.fn()} />);
      expect(screen.queryByText(zh.runNoFinalAnswer)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: zh.continueRun })).not.toBeInTheDocument();
    });
  });
});
