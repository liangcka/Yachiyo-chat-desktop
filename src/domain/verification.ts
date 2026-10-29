import type { ChatMessage, ToolStep } from "./chat";
import { commandStatus, projectToolStep, type CommandStatus } from "./tool-projection";

export { commandStatus };

/**
 * 验证证据只来自网关回报的命令执行记录：模型声称“测试通过”、计划清单全部完成，
 * 都不构成证据。没有结构化记录的旧消息一律视为结果未知。
 */
export type VerificationStatus = CommandStatus;

export interface VerificationRecord {
  readonly callId: string;
  readonly command: string;
  readonly status: VerificationStatus;
  readonly exitCode?: number;
  readonly durationMs?: number;
  /** 验证之后本次运行又成功修改了文件，结论不再对应当前代码 */
  readonly stale: boolean;
}

export type VerificationState = "not_run" | "passed" | "failed" | "stale" | "incomplete";

export interface VerificationSummary {
  readonly state: VerificationState;
  /** 每条不同命令的最后一次执行 */
  readonly latest: ReadonlyArray<VerificationRecord>;
  /** 验证之后修改过的文件（state 为 stale 时用于说明） */
  readonly modifiedAfter: ReadonlyArray<string>;
}

/** 构建、测试、类型检查与静态检查类命令；只读查询（git status、ls 等）不算验证 */
const VERIFICATION_PATTERN =
  /(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?(?:test|lint|typecheck|check|build|verify|e2e)\b|(?:^|[\s;&|(])(?:vitest|jest|mocha|pytest|tox|tsc|eslint|ruff|mypy|flake8|playwright)\b|(?:^|[\s;&|(])cargo\s+(?:test|check|clippy|build|nextest)\b|(?:^|[\s;&|(])go\s+(?:test|vet|build)\b|(?:^|[\s;&|(])(?:mvn|gradle|gradlew|\.\/gradlew)\b.*\b(?:test|check|build|verify)\b|(?:^|[\s;&|(])(?:dotnet)\s+(?:test|build)\b|(?:^|[\s;&|(])make\s+(?:test|check|lint|build)\b|(?:^|[\s;&|(])python3?\s+-m\s+(?:pytest|unittest|mypy)\b|(?:^|[;&|(]\s*)(?:(?:sh|bash|zsh|pwsh|powershell(?:\.exe)?)\s+(?:-\S+\s+)*)?(?:\.{0,2}[\\/])?(?:[\w.-]+[\\/])*[\w.-]*(?:test|tests|check|lint|verify)[\w.-]*\.(?:sh|bash|ps1|bat|cmd)\b/iu;

export function isVerificationCommand(command: string): boolean {
  return VERIFICATION_PATTERN.test(command);
}


/** 按执行顺序汇总验证命令：同一命令以最后一次为准，验证后又改了文件则标记需要重新验证 */
export function summarizeVerification(steps: ReadonlyArray<ToolStep>): VerificationSummary {
  const latest = new Map<string, VerificationRecord>();
  const modifiedAfter = new Set<string>();
  for (const step of steps) {
    const projection = projectToolStep(step);
    const path = projection.kind === "file_write" && projection.status === "succeeded" ? projection.path : undefined;
    if (path !== undefined) {
      modifiedAfter.add(path);
      for (const [key, record] of latest) latest.set(key, { ...record, stale: true });
      continue;
    }
    const command = projection.command;
    if (command === undefined || !isVerificationCommand(command)) continue;
    const record = step.result?.command;
    // 新的验证结论覆盖同一命令之前的结论，也清空它之前的修改记录
    latest.delete(command);
    latest.set(command, {
      callId: step.id,
      command,
      status: step.result === undefined ? "unknown" : commandStatus(record),
      ...(record?.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      ...(record !== undefined ? { durationMs: record.durationMs } : {}),
      stale: false,
    });
    if ([...latest.values()].every((item) => !item.stale)) modifiedAfter.clear();
  }
  const records = [...latest.values()];
  let state: VerificationState;
  if (records.length === 0) state = "not_run";
  else if (records.some((record) => record.status === "failed" || record.status === "timed_out")) state = "failed";
  else if (records.some((record) => record.stale)) state = "stale";
  else if (records.some((record) => record.status !== "passed")) state = "incomplete";
  else state = "passed";
  return { state, latest: records, modifiedAfter: state === "stale" ? [...modifiedAfter] : [] };
}

export function summarizeMessageVerification(message: ChatMessage): VerificationSummary {
  return summarizeVerification(message.toolSteps ?? []);
}
