import { isDesktopApp } from "./app-platform";
import { apiFetch } from "./api-origins";

export type McpTransportType = "stdio" | "sse";

export interface McpTransportStdio {
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpTransportSse {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpTransportConfig = McpTransportStdio | McpTransportSse;

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  transport: McpTransportConfig;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpServerStatus {
  config: McpServerConfig;
  is_online: boolean;
  tool_count: number;
  tools: McpTool[];
  last_error?: string;
}

/** 常用内置 MCP 模版预设 */
export interface McpPreset {
  id: string;
  name: string;
  description: string;
  category: "database" | "filesystem" | "developer" | "web" | "general";
  config: McpServerConfig;
}

/** 判定给定工具是否属于电脑/桌面控制类行为 */
export function isComputerControlTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replace(/^(?:mcp_)?(?:windows[-_])?/, "");
  const controlNames = new Set([
    "click",
    "type",
    "move",
    "scroll",
    "shortcut",
    "screenshot",
    "snapshot",
    "app",
    "process",
    "powershell",
    "shell",
    "clipboard",
    "multiselect",
    "multiedit",
    "displayinventory",
    "run_command",
    "wait",
    "waitfor",
  ]);
  return controlNames.has(normalized) || toolName.toLowerCase().includes("windows");
}

/** 格式化电脑控制动作名称，向用户直观展示当前操作 */
export function formatComputerControlAction(toolName: string, args?: Record<string, unknown>): string {
  const normalized = toolName.toLowerCase().replace(/^(?:mcp_)?(?:windows[-_])?/, "");
  switch (normalized) {
    case "click":
      if (args && (args.x !== undefined || args.y !== undefined)) {
        return `正在模拟鼠标点击 (${args.x ?? 0}, ${args.y ?? 0})`;
      }
      return "正在模拟鼠标点击";
    case "type":
      return "正在模拟键盘键入文本";
    case "move":
      return "正在移动鼠标光标";
    case "scroll":
      return "正在滚动页面视口";
    case "shortcut":
      return args?.shortcut ? `正在触发系统快捷键 [${args.shortcut}]` : "正在触发快捷键组合";
    case "screenshot":
      return "正在截取桌面屏幕画面";
    case "snapshot":
      return "正在获取窗口状态快照";
    case "app":
      return args?.name ? `正在切换/启动应用 [${args.name}]` : "正在管理应用程序窗口";
    case "powershell":
    case "shell":
    case "run_command":
      return "正在执行系统终端指令";
    case "process":
      return "正在调度系统后台进程";
    case "clipboard":
      return "正在操作系统剪贴板";
    default:
      return `正在执行操作：${toolName}`;
  }
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "windows_mcp",
    name: "Windows 桌面控制 (Windows MCP)",
    description: "内置 Windows MCP 服务，支持控制应用程序、模拟鼠标点击、键盘输入、屏幕捕获与 PowerShell 执行",
    category: "general",
    config: {
      id: "windows_mcp",
      name: "Windows 桌面控制",
      description: "控制 Windows 桌面与窗口应用，支持鼠标键盘交互与屏幕捕获",
      enabled: true,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-windows"],
        env: {},
      },
    },
  },
  {
    id: "sqlite",
    name: "SQLite 数据库",
    description: "通过只读/写入能力查询与分析本地 SQLite 数据库文件",
    category: "database",
    config: {
      id: "sqlite",
      name: "SQLite 数据库",
      description: "本地 SQLite 数据库访问与查询",
      enabled: true,
      transport: {
        type: "stdio",
        command: "uvx",
        args: ["mcp-server-sqlite", "--db-path", "./app.db"],
        env: {},
      },
    },
  },
  {
    id: "fetch",
    name: "Web Fetch 网页内容抓取",
    description: "抓取并转换指定网页为 Markdown 格式，提取页面信息",
    category: "web",
    config: {
      id: "fetch",
      name: "网页内容抓取",
      description: "转换网络 HTML 网页为 Markdown 并提取核心内容",
      enabled: true,
      transport: {
        type: "stdio",
        command: "uvx",
        args: ["mcp-server-fetch"],
        env: {},
      },
    },
  },
  {
    id: "filesystem",
    name: "文件系统扩展 (Filesystem)",
    description: "官方 MCP 文件系统服务，支持目录与文件高级读写",
    category: "filesystem",
    config: {
      id: "filesystem",
      name: "文件系统服务",
      description: "官方本地文件系统扩展工具集",
      enabled: true,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        env: {},
      },
    },
  },
  {
    id: "git",
    name: "Git 仓库服务",
    description: "官方 Git 仓库工具，支持日志、分支与差异检索",
    category: "developer",
    config: {
      id: "git",
      name: "Git 仓库服务",
      description: "官方 Git 本地版本库分析与操作",
      enabled: true,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-git"],
        env: {},
      },
    },
  },
  {
    id: "remote_sse",
    name: "远程 SSE / HTTP 服务",
    description: "连接局域网或云端提供的标准 MCP SSE 端点",
    category: "general",
    config: {
      id: "remote_sse",
      name: "远程 MCP 服务",
      description: "通过 HTTP/SSE 协议连接的独立 MCP 服务端",
      enabled: true,
      transport: {
        type: "sse",
        url: "http://127.0.0.1:8000/sse",
        headers: {},
      },
    },
  },
];

/** 获取所有配置的 MCP 服务列表 */
export async function listMcpServers(): Promise<McpServerConfig[]> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<McpServerConfig[]>("list_mcp_servers");
    } catch (e) {
      console.warn("Tauri list_mcp_servers 调用失败，回退到 HTTP API:", e);
    }
  }

  try {
    const res = await apiFetch("/api/mcp/servers", { method: "GET" });
    if (!res.ok) return [];
    const data = (await res.json()) as { servers?: McpServerConfig[] };
    return data.servers ?? [];
  } catch {
    return [];
  }
}

/** 保存或新增单个 MCP 服务 */
export async function saveMcpServer(config: McpServerConfig): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_mcp_server", { config });
      return true;
    } catch (e) {
      console.warn("Tauri save_mcp_server 失败，尝试 HTTP API:", e);
    }
  }

  try {
    const res = await apiFetch("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 删除 MCP 服务 */
export async function deleteMcpServer(id: string): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_mcp_server", { id });
      return true;
    } catch (e) {
      console.warn("Tauri delete_mcp_server 失败，尝试 HTTP API:", e);
    }
  }

  try {
    const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 启用或禁用 MCP 服务 */
export async function toggleMcpServer(id: string, enabled: boolean): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("toggle_mcp_server", { id, enabled });
      return true;
    } catch (e) {
      console.warn("Tauri toggle_mcp_server 失败，尝试 HTTP API:", e);
    }
  }

  try {
    const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 测试连接 MCP 服务并获取发现的工具列表 */
export async function testMcpServer(
  config: McpServerConfig,
): Promise<{ success: boolean; tools?: McpTool[]; error?: string }> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const tools = await invoke<McpTool[]>("test_mcp_server", { config });
      return { success: true, tools };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  try {
    const res = await apiFetch("/api/mcp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = (await res.json()) as { success: boolean; tools?: McpTool[]; error?: string };
    return data;
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** 获取特定服务的状态与已缓存工具 */
export async function getMcpServerStatus(id: string): Promise<McpServerStatus | null> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<McpServerStatus>("get_mcp_server_status", { id });
    } catch {
      return null;
    }
  }
  return null;
}

/** 从 Claude Desktop 兼容 JSON 中导入配置 */
export async function importClaudeMcpConfig(
  jsonStr: string,
): Promise<{ success: boolean; count?: number; error?: string }> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const count = await invoke<number>("import_claude_mcp_config", { json: jsonStr });
      return { success: true, count };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  try {
    const res = await apiFetch("/api/mcp/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: jsonStr }),
    });
    const data = (await res.json()) as { success: boolean; count?: number; error?: string };
    return data;
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** 导出为 Claude Desktop 兼容 JSON 配置 */
export async function exportClaudeMcpConfig(): Promise<string | null> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("export_claude_mcp_config");
    } catch {
      return null;
    }
  }

  try {
    const res = await apiFetch("/api/mcp/export", { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as { success: boolean; config?: string };
    return data.config ?? null;
  } catch {
    return null;
  }
}

/** 解析形如 mcp__server_id__tool_name 的工具名 */
export function parseMcpToolName(
  toolName: string,
): { isMcp: boolean; serverId?: string; originalToolName?: string } {
  if (!toolName.startsWith("mcp__")) {
    return { isMcp: false };
  }
  const parts = toolName.split("__");
  if (parts.length >= 3) {
    return {
      isMcp: true,
      serverId: parts[1],
      originalToolName: parts.slice(2).join("__"),
    };
  }
  return { isMcp: true };
}
