import type { ChatMessage, CommandRecord } from "./chat";
import { projectToolStep } from "./tool-projection";

/**
 * 运行结束时仍未解决的问题，只依据执行记录：命令以网关回报的结论为准，
 * 文件写入以工具结果为准；模型回复里的“已修复”“已通过”不会消除这里的条目。
 */
export type UnresolvedIssue =
  /** 同一命令最后一次执行失败、超时或未能确认退出 */
  | { readonly kind: "command"; readonly command: string; readonly record?: CommandRecord; readonly unknown: boolean }
  /** 同一文件最后一次写入失败 */
  | { readonly kind: "write"; readonly path: string }
  /** 运行结束时没有返回结果的操作（包括取消收尾时无法确认的外部调用） */
  | { readonly kind: "unknown_operation"; readonly name: string; readonly detail?: string }
  /** 运行中追加却没有送达模型的补充要求 */
  | { readonly kind: "supplement"; readonly text: string };

export function collectUnresolvedIssues(message: ChatMessage): UnresolvedIssue[] {
  if (message.role !== "assistant" || message.status === "streaming") return [];
  const commands = new Map<string, UnresolvedIssue | null>();
  const writes = new Map<string, boolean>();
  const unknown: UnresolvedIssue[] = [];
  const unknownIds = new Set<string>();

  for (const step of message.toolSteps ?? []) {
    const projection = projectToolStep(step);
    if (projection.kind === "command" && projection.command !== undefined) {
      // 同一命令以最后一次为准：重跑通过即视为已解决；用户主动停止的命令不算失败
      commands.delete(projection.command);
      commands.set(
        projection.command,
        projection.status === "failed" || projection.status === "unknown"
          ? { kind: "command", command: projection.command, ...(projection.record !== undefined ? { record: projection.record } : {}), unknown: projection.status === "unknown" }
          : null,
      );
      continue;
    }
    if (projection.kind === "file_write" && projection.path !== undefined && projection.status !== "unknown") {
      writes.delete(projection.path);
      writes.set(projection.path, projection.status === "failed");
      continue;
    }
    if (projection.status === "unknown") {
      unknownIds.add(step.id);
      unknown.push({ kind: "unknown_operation", name: step.name });
    }
  }
  for (const operation of message.cancellation?.unknown ?? []) {
    if (unknownIds.has(operation.callId)) continue;
    unknown.push({ kind: "unknown_operation", name: operation.name, detail: operation.detail });
  }

  return [
    ...[...commands.values()].filter((issue): issue is UnresolvedIssue => issue !== null),
    ...[...writes.entries()].filter(([, failed]) => failed).map(([path]): UnresolvedIssue => ({ kind: "write", path })),
    ...unknown,
    ...(message.supplements ?? []).filter((item) => item.state === "undelivered").map((item): UnresolvedIssue => ({ kind: "supplement", text: item.text })),
  ];
}

/** 运行结束时没有确认结果的操作：没有返回结果的工具调用、未能确认退出的命令、取消收尾时无法确认的外部调用 */
export interface UnconfirmedOperation {
  readonly name: string;
  /** 文件路径或命令 */
  readonly target?: string;
  /** 是否可能有副作用（写文件、命令、MCP 等）；只读工具不影响重新尝试 */
  readonly sideEffect: boolean;
}

export function unconfirmedOperations(message: ChatMessage): UnconfirmedOperation[] {
  const operations: UnconfirmedOperation[] = [];
  const seen = new Set<string>();
  for (const step of message.toolSteps ?? []) {
    const projection = projectToolStep(step);
    if (projection.status !== "unknown") continue;
    seen.add(step.id);
    const target = projection.path ?? projection.command;
    const sideEffect = projection.kind !== "file_read" && projection.kind !== "search" && projection.kind !== "git" && projection.kind !== "web" && projection.kind !== "plan" && projection.kind !== "guideline";
    operations.push({ name: step.name, ...(target !== undefined ? { target } : {}), sideEffect });
  }
  for (const operation of message.cancellation?.unknown ?? []) {
    if (!seen.has(operation.callId)) operations.push({ name: operation.name, sideEffect: true });
  }
  return operations;
}
