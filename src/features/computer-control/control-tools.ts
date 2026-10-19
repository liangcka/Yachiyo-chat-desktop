import type { ChatMessage } from "../../domain/chat";
import { parseMcpToolName } from "../../services/mcp-manager";

/**
 * 只把真正操作鼠标、键盘与窗口的工具视为电脑控制；截图、窗口列表、元素检查与 shell 等只读或另有权限卡片的工具不算。
 * 兼容内置 `mcp__windows_mcp__*` 与第三方 Windows 控制 MCP 的常见命名（`windows_click`、`windows-type`）。
 */
const CONTROL_ACTIONS: ReadonlySet<string> = new Set([
  "click",
  "type",
  "move",
  "scroll",
  "shortcut",
  "clipboard",
  "multiselect",
  "multiedit",
  "app",
]);

function controlAction(toolName: string): string {
  const parsed = parseMcpToolName(toolName);
  const base = parsed.isMcp && parsed.originalToolName ? parsed.originalToolName : toolName;
  return base.toLowerCase().replace(/^(?:mcp_)?(?:windows[-_])?/u, "");
}

export function isComputerControlTool(toolName: string): boolean {
  return CONTROL_ACTIONS.has(controlAction(toolName));
}

export interface ComputerControlSession {
  /** 等待彩叶审批：状态条保留，鼠标交还给彩叶 */
  readonly paused: boolean;
}

/**
 * 控制会话：本次运行中一旦执行过电脑控制动作就成立，一直持续到运行结束。
 * 中途的元素检查、窗口列表与模型思考都不中断会话，遮罩不会在两步之间闪断
 */
export function deriveControlSession(input: {
  readonly messages: readonly ChatMessage[];
  readonly running: boolean;
  readonly awaitingPermission: boolean;
}): ComputerControlSession | null {
  if (!input.running) return null;
  const last = input.messages[input.messages.length - 1];
  if (last === undefined || last.role !== "assistant") return null;
  const controlling = last.toolSteps?.some((step) => isComputerControlTool(step.name)) ?? false;
  return controlling ? { paused: input.awaitingPermission } : null;
}
