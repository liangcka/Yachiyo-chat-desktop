import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { deriveControlSession, formatComputerControlAction, isComputerControlTool } from "./control-tools";

describe("isComputerControlTool 电脑控制工具判定", () => {
  it("run_command 返回 false", () => {
    expect(isComputerControlTool("run_command")).toBe(false);
    expect(isComputerControlTool("mcp__terminal__run_command")).toBe(false);
  });

  it("Windows MCP 的 click 返回 true", () => {
    expect(isComputerControlTool("mcp__windows_mcp__click")).toBe(true);
    expect(isComputerControlTool("mcp__windows__click")).toBe(true);
    expect(isComputerControlTool("windows_click")).toBe(true);
    expect(isComputerControlTool("windows-click")).toBe(true);
    expect(isComputerControlTool("click")).toBe(true);
  });

  it("名字里只是带 windows 的其他工具返回 false", () => {
    expect(isComputerControlTool("windows_info")).toBe(false);
    expect(isComputerControlTool("get_windows_status")).toBe(false);
    expect(isComputerControlTool("windows_network")).toBe(false);
    expect(isComputerControlTool("mcp__windows_mcp__powershell")).toBe(false);
    expect(isComputerControlTool("mcp__windows_mcp__screenshot")).toBe(false);
    expect(isComputerControlTool("mcp__windows_mcp__snapshot")).toBe(false);
  });

  it("只把真正操作鼠标、键盘、窗口的工具判定为电脑控制", () => {
    // 允许的 9 个工具
    expect(isComputerControlTool("click")).toBe(true);
    expect(isComputerControlTool("type")).toBe(true);
    expect(isComputerControlTool("move")).toBe(true);
    expect(isComputerControlTool("scroll")).toBe(true);
    expect(isComputerControlTool("shortcut")).toBe(true);
    expect(isComputerControlTool("clipboard")).toBe(true);
    expect(isComputerControlTool("multiselect")).toBe(true);
    expect(isComputerControlTool("multiedit")).toBe(true);
    expect(isComputerControlTool("app")).toBe(true);

    // 移除的工具
    expect(isComputerControlTool("shell")).toBe(false);
    expect(isComputerControlTool("powershell")).toBe(false);
    expect(isComputerControlTool("process")).toBe(false);
    expect(isComputerControlTool("wait")).toBe(false);
    expect(isComputerControlTool("waitfor")).toBe(false);
    expect(isComputerControlTool("screenshot")).toBe(false);
    expect(isComputerControlTool("snapshot")).toBe(false);
    expect(isComputerControlTool("displayinventory")).toBe(false);
  });
});

describe("formatComputerControlAction", () => {
  it("描述带参数的动作", () => {
    expect(formatComputerControlAction("mcp__windows_mcp__click", { x: 10, y: 20 })).toBe("正在模拟鼠标点击 (10, 20)");
    expect(formatComputerControlAction("mcp__windows_mcp__shortcut", { shortcut: "ctrl+v" }, "ja-JP")).toBe(
      "ショートカット [ctrl+v] を実行中",
    );
    expect(formatComputerControlAction("mcp__windows_mcp__app", { name: "QQ" })).toBe("正在切换/启动应用 [QQ]");
  });
});

function assistantWith(steps: Array<{ name: string; args?: unknown; done?: boolean }>): ChatMessage {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "assistant",
    text: "",
    status: "streaming",
    createdAt: 0,
    toolSteps: steps.map((step, index) => ({
      id: `step-${index}`,
      name: step.name,
      argumentsJson: JSON.stringify(step.args ?? {}),
      ...(step.done === true ? { result: { output: "ok", isError: false } } : {}),
    })),
  } as ChatMessage;
}

describe("deriveControlSession", () => {
  const base = { running: true, awaitingPermission: false, locale: "zh-CN" as const };

  it("最近一次工具调用是电脑控制时成立，并覆盖动作完成后的思考间隙", () => {
    const running = deriveControlSession({ ...base, messages: [assistantWith([{ name: "mcp__windows_mcp__click", args: { x: 1, y: 2 } }])] });
    expect(running).toEqual({ toolName: "mcp__windows_mcp__click", detail: "正在模拟鼠标点击 (1, 2)" });

    const between = deriveControlSession({
      ...base,
      messages: [assistantWith([{ name: "mcp__windows_mcp__type", args: { text: "hi" }, done: true }])],
    });
    expect(between?.toolName).toBe("mcp__windows_mcp__type");
  });

  it("等待审批、运行结束或最近一步不是电脑控制时不成立", () => {
    const messages = [assistantWith([{ name: "mcp__windows_mcp__click" }])];
    expect(deriveControlSession({ ...base, messages, awaitingPermission: true })).toBeNull();
    expect(deriveControlSession({ ...base, messages, running: false })).toBeNull();
    expect(
      deriveControlSession({
        ...base,
        messages: [assistantWith([{ name: "mcp__windows_mcp__click", done: true }, { name: "read_file" }])],
      }),
    ).toBeNull();
    expect(deriveControlSession({ ...base, messages: [] })).toBeNull();
  });

  it("参数无法解析时仍给出通用描述", () => {
    const message = assistantWith([{ name: "mcp__windows_mcp__click" }]);
    const broken = { ...message, toolSteps: [{ id: "s", name: "mcp__windows_mcp__click", argumentsJson: "{" }] } as ChatMessage;
    expect(deriveControlSession({ ...base, messages: [broken] })?.detail).toBe("正在模拟鼠标点击");
  });
});
