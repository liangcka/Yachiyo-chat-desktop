import { isDesktopApp } from "./app-platform";

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
}

/** UI 文件树的结构化目录条目（对应 Rust `WorkspaceEntry`） */
export interface WorkspaceEntry {
  name: string;
  isDir: boolean;
}

/** diff 审阅的 HEAD 基线（对应 Rust `HeadFile`；present=false 表示无 HEAD 或文件不在 HEAD） */
export interface HeadFile {
  present: boolean;
  content: string;
}

export async function getDesktopWorkspaceRoot(): Promise<string | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const root = await invoke<string | null>("get_workspace_root");
    return root && root.trim().length > 0 ? root : undefined;
  } catch {
    return undefined;
  }
}

export async function setDesktopWorkspaceRoot(path: string): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_workspace_root", { path });
    return true;
  } catch {
    return false;
  }
}

export async function executeDesktopAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  if (!isDesktopApp()) {
    return { output: "Desktop agent runtime not available in web mode", isError: true };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const output = await invoke<string>("execute_agent_tool", { name, arguments: args });
    return { output, isError: false };
  } catch (error) {
    return { output: String(error), isError: true };
  }
}

/** 文件树懒加载：列出工作区某目录的结构化条目（目录优先 + 名称排序由 Rust 侧保证） */
export async function listWorkspaceEntries(path: string): Promise<WorkspaceEntry[] | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<WorkspaceEntry[]>("list_workspace_entries", { path });
  } catch {
    return undefined;
  }
}

/** 快速检索工作区文件（用于 @ 引用文件模糊搜索浮层） */
export async function searchWorkspaceFiles(
  query?: string,
  limit?: number,
): Promise<string[] | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("search_workspace_files", { query, limit });
  } catch {
    return undefined;
  }
}


/** 读取文件在 git HEAD 的基线内容（diff 审阅 original 侧） */
export async function readHeadFile(path: string): Promise<HeadFile | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<HeadFile>("read_head_file", { path });
  } catch {
    return undefined;
  }
}

/** 弹出原生系统文件夹选择器（对标 "Open workspace" 对话框） */
export async function pickDesktopFolder(title = "Open workspace"): Promise<string | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<string | null>("pick_folder", { title });
    return res ?? undefined;
  } catch {
    return undefined;
  }
}

/** 安全退出并关闭桌面应用（在桌面端终止进程与窗口，在浏览器端优雅降级） */
export async function exitDesktopApp(): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("exit_app");
      return true;
    } catch {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
        return true;
      } catch {
        return false;
      }
    }
  }

  // Web 浏览器环境降级尝试
  if (typeof window !== "undefined") {
    try {
      window.close();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 在系统默认外部独立浏览器中打开链接（避免在 IDE 内置视图或应用内打开） */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url });
      return true;
    } catch {
      /* 静默降级至普通新窗口打开 */
    }
  }

  if (typeof window !== "undefined") {
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      return win !== null;
    } catch {
      return false;
    }
  }
  return false;
}

/** 最小化桌面窗口 */
export async function minimizeDesktopWindow(): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
      return true;
    } catch {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("minimize_window");
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** 切换桌面窗口最大化 / 还原 */
export async function toggleMaximizeDesktopWindow(): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
      return true;
    } catch {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("toggle_maximize_window");
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** 查询桌面窗口是否处于最大化状态 */
export async function isDesktopWindowMaximized(): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return await getCurrentWindow().isMaximized();
    } catch {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<boolean>("is_window_maximized");
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** 关闭桌面窗口 */
export async function closeDesktopWindow(): Promise<boolean> {
  return exitDesktopApp();
}

