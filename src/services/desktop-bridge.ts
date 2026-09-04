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
    return await invoke<string>("get_workspace_root");
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
