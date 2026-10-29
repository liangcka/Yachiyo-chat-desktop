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

/** 更新检查原始结果（对应 Rust `UpdateInfo`；仓库尚无正式版时 latestTag 为 null） */
export interface DesktopUpdateInfo {
  currentVersion: string;
  latestTag: string | null;
  releaseUrl: string | null;
}

/** 查询当前版本与 GitHub 最新正式版；非桌面端或网络失败返回 undefined */
export async function checkDesktopUpdate(): Promise<DesktopUpdateInfo | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DesktopUpdateInfo>("check_for_update");
  } catch {
    return undefined;
  }
}

export interface ComputerControlState {
  supported: boolean;
  enabled: boolean;
  /** 不支持时的原因（如非 Windows 系统） */
  reason: string | null;
}

/** 电脑控制插件状态；非桌面端或调用失败返回 undefined */
export async function getComputerControlState(): Promise<ComputerControlState | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ComputerControlState>("get_computer_control_state");
  } catch {
    return undefined;
  }
}

export async function setComputerControlEnabled(enabled: boolean): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_computer_control_enabled", { enabled });
    return true;
  } catch {
    return false;
  }
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

/** 原生切换项目的结果：成功时 path 为原生层校验后的规范路径（关闭项目时为 null） */
export type WorkspaceSwitchResult =
  | { ok: true; path: string | null }
  | { ok: false; error: string };

/**
 * 原生切换项目。桌面端以原生层返回的规范路径作为项目身份；
 * Web 端没有本地执行能力，项目只是界面上的标识，按原样接受。
 */
export async function setDesktopWorkspaceRoot(path: string): Promise<WorkspaceSwitchResult> {
  const requested = path.trim();
  if (!isDesktopApp()) return { ok: true, path: requested.length > 0 ? requested : null };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const canonical = await invoke<string | null>("set_workspace_root", { path: requested });
    return { ok: true, path: canonical ?? null };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * 界面发起的工具调用。工作区必须显式给出：编辑器标签、审阅与终端各自属于某个项目，
 * 不跟随界面当前选中的项目；null 表示不针对任何项目（读取只接受绝对路径）。
 */
export async function executeDesktopAgentTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string | null,
): Promise<ToolExecutionResult> {
  if (!isDesktopApp()) {
    return { output: "Desktop agent runtime not available in web mode", isError: true };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const output = await invoke<string>("execute_agent_tool", { name, arguments: args, workspace });
    return { output, isError: false };
  } catch (error) {
    return { output: String(error), isError: true };
  }
}

/** 文件树懒加载：列出工作区某目录的结构化条目（目录优先 + 名称排序由 Rust 侧保证） */
export async function listWorkspaceEntries(workspace: string, path: string): Promise<WorkspaceEntry[] | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<WorkspaceEntry[]>("list_workspace_entries", { workspace, path });
  } catch {
    return undefined;
  }
}

/** 快速检索工作区文件（用于 @ 引用文件模糊搜索浮层） */
export async function searchWorkspaceFiles(
  workspace: string | null,
  query?: string,
  limit?: number,
): Promise<string[] | undefined> {
  if (!isDesktopApp() || workspace === null) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("search_workspace_files", { workspace, query, limit });
  } catch {
    return undefined;
  }
}


/** 读取文件在 git HEAD 的基线内容（diff 审阅 original 侧） */
export async function readHeadFile(workspace: string, path: string): Promise<HeadFile | undefined> {
  if (!isDesktopApp()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<HeadFile>("read_head_file", { workspace, path });
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

/** 电脑控制遮罩的状态，与 Rust 端 ControlOverlayPayload 对齐；paused 表示等待审批，状态条保留但交还鼠标 */
export interface ControlOverlayState {
  active: boolean;
  paused: boolean;
}

/** 显示系统级全屏控制遮罩；后端对相同状态去重 */
export async function showControlOverlay(paused: boolean): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_control_overlay", { paused });
    return true;
  } catch {
    return false;
  }
}

/** 隐藏系统级全屏控制遮罩 */
export async function hideControlOverlay(): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_control_overlay");
    return true;
  } catch {
    return false;
  }
}

/** 遮罩窗口加载时拉取当前状态，补上加载前错过的推送 */
export async function getControlOverlayState(): Promise<ControlOverlayState | null> {
  if (!isDesktopApp()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ControlOverlayState>("get_control_overlay_state");
  } catch {
    return null;
  }
}

/** 订阅后端推送的遮罩状态变化 */
export async function onControlOverlayStateChange(
  callback: (state: ControlOverlayState) => void,
): Promise<() => void> {
  if (!isDesktopApp()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<ControlOverlayState>("control_state_change", (event) => callback(event.payload));
  } catch {
    return () => {};
  }
}

/** 遮罩客户区内的光标位置，物理像素 */
export interface OverlayCursorPosition {
  x: number;
  y: number;
}

/** 订阅后端推送的光标位置，用于渲染跟随动作的独立光标 */
export async function onOverlayCursorMove(
  callback: (position: OverlayCursorPosition) => void,
): Promise<() => void> {
  if (!isDesktopApp()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<OverlayCursorPosition>("control_cursor_move", (event) => callback(event.payload));
  } catch {
    return () => {};
  }
}

/** 监听后端检测到全局 Esc 时广播的取消控制事件 */
export async function onEmergencyStopControl(callback: () => void): Promise<() => void> {
  if (!isDesktopApp()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen("emergency_stop_control", () => {
      callback();
    });
    return unlisten;
  } catch {
    return () => {};
  }
}

/** 已放行到 asset 协议的本地文件 */
export interface AssetFile {
  path: string;
  name: string;
  size: number;
}

/** 放行本地文件到 asset 协议；目录、相对路径与不存在的文件不会出现在结果里 */
export async function allowAssetFiles(paths: string[]): Promise<AssetFile[]> {
  if (!isDesktopApp() || paths.length === 0) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AssetFile[]>("allow_asset_files", { paths });
  } catch {
    return [];
  }
}

/** 本地文件对应的 asset 协议地址，需先经 allowAssetFiles 放行才能读取 */
export async function assetUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

export type DesktopFileDropEvent = { type: "enter"; paths: string[] } | { type: "leave" } | { type: "drop"; paths: string[] };

/**
 * 订阅系统文件拖入窗口。webview 的原生拖放默认开启，HTML5 drop 收不到系统文件，
 * 只能从这里拿到文件路径
 */
export async function onDesktopFileDrop(callback: (event: DesktopFileDropEvent) => void): Promise<() => void> {
  if (!isDesktopApp()) return () => {};
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    return await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "drop") callback({ type: payload.type, paths: payload.paths });
      else if (payload.type === "leave") callback({ type: "leave" });
    });
  } catch {
    return () => {};
  }
}

/** 界面读取的文件版本：完整原文与版本摘要；lossless 为 false 时不是 UTF-8，只能只读查看或整体替换 */
export interface WorkspaceFileView {
  present: boolean;
  content: string;
  digest?: string;
  lossless: boolean;
  bom: boolean;
}

export type FileWriteResult = { ok: true; digest: string | null } | { ok: false; conflict: boolean; error: string };

/** 冲突错误以固定前缀返回，界面据此提示重新加载而不是笼统失败 */
const VERSION_CONFLICT = "FILE_VERSION_CONFLICT";

function writeFailure(error: unknown): { ok: false; conflict: boolean; error: string } {
  const message = String(error);
  return { ok: false, conflict: message.includes(VERSION_CONFLICT), error: message.replace(`${VERSION_CONFLICT}: `, "") };
}

export async function readWorkspaceFile(workspace: string, path: string): Promise<WorkspaceFileView | { error: string }> {
  if (!isDesktopApp()) return { error: "Desktop runtime not available in web mode" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<WorkspaceFileView>("read_workspace_file", { workspace, path });
  } catch (error) {
    return { error: String(error) };
  }
}

/** 界面写入：当前版本必须与 expectedDigest 一致，否则返回冲突且不覆盖 */
export async function writeWorkspaceFile(
  workspace: string,
  path: string,
  content: string,
  expectedDigest: string | undefined,
  bom?: boolean,
): Promise<FileWriteResult> {
  if (!isDesktopApp()) return { ok: false, conflict: false, error: "Desktop runtime not available in web mode" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const digest = await invoke<string | null>("write_workspace_file", { workspace, path, content, expectedDigest: expectedDigest ?? null, bom });
    return { ok: true, digest };
  } catch (error) {
    return writeFailure(error);
  }
}

export type RunChangeKind = "added" | "modified" | "deleted";
export type RunChangeState = "agent" | "reviewed" | "reverted" | "conflict";

/** 运行改动账本中的一个文件（对应 Rust `RunFileChange`） */
export interface RunFileChange {
  path: string;
  kind: RunChangeKind;
  state: RunChangeState;
  source: "file_tool" | "command";
  calls: string[];
  baseline: { present: boolean; digest?: string };
  current: { present: boolean; digest?: string };
}

export interface RunChangeContent {
  change: RunFileChange;
  baseline: WorkspaceFileView;
  current: WorkspaceFileView;
}

export async function listRunChanges(workspace: string, runId: string): Promise<RunFileChange[] | { error: string }> {
  if (!isDesktopApp()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<RunFileChange[]>("list_run_changes", { workspace, runId });
  } catch (error) {
    return { error: String(error) };
  }
}

export async function readRunChange(workspace: string, runId: string, path: string): Promise<RunChangeContent | { error: string }> {
  if (!isDesktopApp()) return { error: "Desktop runtime not available in web mode" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<RunChangeContent>("read_run_change", { workspace, runId, path });
  } catch (error) {
    return { error: String(error) };
  }
}

export type RunChangeResult = { ok: true; change: RunFileChange } | { ok: false; conflict: boolean; error: string };

async function runChangeAction(command: string, args: Record<string, unknown>): Promise<RunChangeResult> {
  if (!isDesktopApp()) return { ok: false, conflict: false, error: "Desktop runtime not available in web mode" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return { ok: true, change: await invoke<RunFileChange>(command, args) };
  } catch (error) {
    return writeFailure(error);
  }
}

/** 撤销运行对某文件的改动：content 缺省时整体恢复改动前版本，否则写入按所选块合并后的文本 */
export function revertRunChange(workspace: string, runId: string, path: string, expectedDigest: string | undefined, content?: string): Promise<RunChangeResult> {
  return runChangeAction("revert_run_change", { workspace, runId, path, content: content ?? null, expectedDigest: expectedDigest ?? null });
}

export type RunChangesResult = { ok: true; changes: RunFileChange[] } | { ok: false; conflict: boolean; error: string };

/** 整体撤销多个文件：原生层先核对全部版本，再按“修改 → 删除 → 新增”的顺序恢复 */
export async function revertRunChanges(
  workspace: string,
  runId: string,
  items: ReadonlyArray<{ path: string; expectedDigest: string | undefined }>,
): Promise<RunChangesResult> {
  if (!isDesktopApp()) return { ok: false, conflict: false, error: "Desktop runtime not available in web mode" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = items.map((item) => ({ path: item.path, expectedDigest: item.expectedDigest ?? null }));
    return { ok: true, changes: await invoke<RunFileChange[]>("revert_run_changes", { workspace, runId, items: payload }) };
  } catch (error) {
    return writeFailure(error);
  }
}

export function keepRunChange(workspace: string, runId: string, path: string, expectedDigest: string | undefined): Promise<RunChangeResult> {
  return runChangeAction("keep_run_change", { workspace, runId, path, expectedDigest: expectedDigest ?? null });
}

/** 撤销之后反悔：恢复为运行写入的版本 */
export function restoreRunChange(workspace: string, runId: string, path: string, expectedDigest: string | undefined): Promise<RunChangeResult> {
  return runChangeAction("restore_run_change", { workspace, runId, path, expectedDigest: expectedDigest ?? null });
}
