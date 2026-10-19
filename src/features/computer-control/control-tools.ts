import type { ChatMessage, Locale } from "../../domain/chat";
import { parseMcpToolName } from "../../services/mcp-manager";

/**
 * 只把真正操作鼠标、键盘与窗口的工具视为电脑控制；截图、窗口列表与 shell 等只读或另有权限卡片的工具不算。
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

/** 遮罩上展示的当前动作描述 */
export function formatComputerControlAction(
  toolName: string,
  args?: Record<string, unknown>,
  locale: Locale = "zh-CN",
): string {
  const ja = locale === "ja-JP";
  switch (controlAction(toolName)) {
    case "click":
      if (args && (args.x !== undefined || args.y !== undefined)) {
        return ja
          ? `マウスクリックを実行中 (${String(args.x ?? 0)}, ${String(args.y ?? 0)})`
          : `正在模拟鼠标点击 (${String(args.x ?? 0)}, ${String(args.y ?? 0)})`;
      }
      return ja ? "マウスクリックを実行中" : "正在模拟鼠标点击";
    case "type":
      return ja ? "キーボード入力を実行中" : "正在模拟键盘键入文本";
    case "move":
      return ja ? "マウスカーソルを移動中" : "正在移动鼠标光标";
    case "scroll":
      return ja ? "画面をスクロール中" : "正在滚动页面视口";
    case "shortcut":
      if (typeof args?.shortcut === "string") {
        return ja ? `ショートカット [${args.shortcut}] を実行中` : `正在触发系统快捷键 [${args.shortcut}]`;
      }
      return ja ? "ショートカットを実行中" : "正在触发快捷键组合";
    case "app":
      if (typeof args?.name === "string") {
        return ja ? `アプリ [${args.name}] を切り替え／起動中` : `正在切换/启动应用 [${args.name}]`;
      }
      return ja ? "アプリのウィンドウを操作中" : "正在管理应用程序窗口";
    case "clipboard":
      return ja ? "クリップボードを操作中" : "正在操作系统剪贴板";
    case "multiselect":
      return ja ? "複数の項目を選択中" : "正在进行多项选择";
    case "multiedit":
      return ja ? "まとめて編集中" : "正在进行批量编辑";
    default:
      return ja ? `操作を実行中：${toolName}` : `正在执行操作：${toolName}`;
  }
}

export interface ComputerControlSession {
  readonly toolName: string;
  readonly detail: string;
}

function parseArgs(argumentsJson: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 控制会话：运行中且最近一次工具调用是电脑控制时成立，覆盖连续动作之间的模型思考间隙，
 * 避免全屏遮罩在两次点击之间反复闪烁；等待权限审批时让出屏幕，便于彩叶操作审批卡片
 */
export function deriveControlSession(input: {
  readonly messages: readonly ChatMessage[];
  readonly running: boolean;
  readonly awaitingPermission: boolean;
  readonly locale: Locale;
}): ComputerControlSession | null {
  if (!input.running || input.awaitingPermission) return null;
  const last = input.messages[input.messages.length - 1];
  if (last === undefined || last.role !== "assistant") return null;
  const step = last.toolSteps?.[last.toolSteps.length - 1];
  if (step === undefined || !isComputerControlTool(step.name)) return null;
  return {
    toolName: step.name,
    detail: formatComputerControlAction(step.name, parseArgs(step.argumentsJson), input.locale),
  };
}
