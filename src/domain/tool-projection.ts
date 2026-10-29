import type { CommandRecord, ToolStep } from "./chat";

/**
 * 工具步骤的统一投影：消息过程、改动汇总、验证、结果区与成果面板都从这里读取
 * 工具类别、目标路径、命令与执行结论，不各自解析参数，也不认网关不存在的工具名。
 */
export type ToolKind =
  | "file_write"
  | "file_read"
  | "search"
  | "command"
  | "git"
  | "web"
  | "plan"
  | "subagent"
  | "guideline"
  | "mcp"
  | "other";

/** running 尚未返回；unknown 运行已结束却没有结果，或命令未能确认退出 */
export type ToolStepStatus = "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface ToolProjection {
  readonly id: string;
  readonly name: string;
  readonly kind: ToolKind;
  /** 文件类工具的目标，统一为 `/` 分隔、去掉开头的 `./` */
  readonly path?: string;
  /** run_command 的命令文本 */
  readonly command?: string;
  readonly status: ToolStepStatus;
  readonly record?: CommandRecord;
}

const KINDS: Readonly<Record<string, ToolKind>> = {
  write_file: "file_write",
  edit_file: "file_write",
  read_file: "file_read",
  list_directory: "file_read",
  glob: "search",
  grep: "search",
  run_command: "command",
  git_status: "git",
  git_diff: "git",
  web_fetch: "web",
  web_search: "web",
  todo_write: "plan",
  task: "subagent",
  read_guideline: "guideline",
};

export function toolKind(name: string): ToolKind {
  if (name.startsWith("mcp__")) return "mcp";
  return KINDS[name] ?? "other";
}

export function parseToolArguments(json: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeToolPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "");
}

/** 命令结论只看网关回报的结束原因与退出码；未能确认进程退出的一律视为结果未知 */
export type CommandStatus = "passed" | "failed" | "timed_out" | "cancelled" | "unknown";

export function commandStatus(record: CommandRecord | undefined): CommandStatus {
  if (record === undefined || !record.exitConfirmed) return "unknown";
  switch (record.endReason) {
    case "exited":
      return record.exitCode === 0 ? "passed" : "failed";
    case "timed_out":
      return "timed_out";
    case "cancelled":
      return "cancelled";
    case "spawn_failed":
    case "blocked":
      return "failed";
  }
}

function stepStatus(step: ToolStep, settled: boolean): ToolStepStatus {
  if (step.result === undefined) return settled ? "unknown" : "running";
  if (step.result.command !== undefined) {
    switch (commandStatus(step.result.command)) {
      case "passed":
        return "succeeded";
      case "cancelled":
        return "cancelled";
      case "unknown":
        return "unknown";
      default:
        return "failed";
    }
  }
  return step.result.isError ? "failed" : "succeeded";
}

/** settled：所属消息已结束（没有结果的步骤不再可能返回） */
export function projectToolStep(step: ToolStep, settled = true): ToolProjection {
  const kind = toolKind(step.name);
  const args = parseToolArguments(step.argumentsJson);
  const rawPath = kind === "file_write" || kind === "file_read" ? args?.path : undefined;
  const rawCommand = kind === "command" ? args?.command : undefined;
  const path = typeof rawPath === "string" && rawPath.trim().length > 0 ? normalizeToolPath(rawPath.trim()) : undefined;
  const command = typeof rawCommand === "string" && rawCommand.trim().length > 0 ? rawCommand.trim() : undefined;
  return {
    id: step.id,
    name: step.name,
    kind,
    ...(path !== undefined ? { path } : {}),
    ...(command !== undefined ? { command } : {}),
    status: stepStatus(step, settled),
    ...(step.result?.command !== undefined ? { record: step.result.command } : {}),
  };
}
