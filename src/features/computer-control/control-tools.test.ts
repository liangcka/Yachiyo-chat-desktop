import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../domain/chat";
import { deriveControlSession, isComputerControlTool } from "./control-tools";

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
  const base = { running: true, awaitingPermission: false };

  it("本次运行执行过电脑控制后成立，中途的检查、读取与思考都不中断", () => {
    expect(deriveControlSession({ ...base, messages: [assistantWith([{ name: "mcp__windows_mcp__click" }])] })).toEqual({
      paused: false,
    });

    const afterInspect = assistantWith([
      { name: "mcp__windows_mcp__app", done: true },
      { name: "mcp__windows_mcp__inspect", done: true },
      { name: "read_file" },
    ]);
    expect(deriveControlSession({ ...base, messages: [afterInspect] })).toEqual({ paused: false });
  });

  it("等待审批时保留会话但标记为暂停", () => {
    const messages = [assistantWith([{ name: "mcp__windows_mcp__click", done: true }, { name: "run_command" }])];
    expect(deriveControlSession({ ...base, messages, awaitingPermission: true })).toEqual({ paused: true });
  });

  it("运行结束、尚未执行控制动作或没有助手消息时不成立", () => {
    const messages = [assistantWith([{ name: "mcp__windows_mcp__click", done: true }])];
    expect(deriveControlSession({ ...base, messages, running: false })).toBeNull();
    expect(
      deriveControlSession({
        ...base,
        messages: [assistantWith([{ name: "mcp__windows_mcp__inspect" }, { name: "read_file" }])],
      }),
    ).toBeNull();
    expect(deriveControlSession({ ...base, messages: [] })).toBeNull();
  });
});
