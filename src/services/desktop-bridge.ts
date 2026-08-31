import { isDesktopApp } from "./app-platform";

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
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
