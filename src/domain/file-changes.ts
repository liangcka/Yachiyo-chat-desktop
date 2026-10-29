import type { ChatMessage } from "./chat";
import { projectToolStep } from "./tool-projection";

/** 仅从已完成的助手消息中提取成功写入的路径，按首次出现顺序去重。 */
export function collectModifiedFiles(message: ChatMessage): string[] {
  if (message.role !== "assistant" || message.status !== "complete") return [];
  const paths = new Set<string>();
  for (const step of message.toolSteps ?? []) {
    const projection = projectToolStep(step);
    if (projection.kind === "file_write" && projection.status === "succeeded" && projection.path !== undefined) paths.add(projection.path);
  }
  return [...paths];
}

/** 会话中可审阅改动的一次运行（绑定了项目的 Agent 运行） */
export interface ReviewableRun {
  readonly runId: string;
  readonly workspace: string;
  readonly startedAt: number;
  /** 触发该运行的用户请求摘要，供选择时辨认 */
  readonly request: string;
}

/** 按时间倒序列出会话中绑定了项目的运行；同一运行（重试复用同一身份时）只保留一次 */
export function reviewableRuns(messages: readonly ChatMessage[]): ReviewableRun[] {
  const runs: ReviewableRun[] = [];
  const seen = new Set<string>();
  let request = "";
  for (const message of messages) {
    if (message.role === "user") {
      request = message.text.replace(/\s+/gu, " ").trim().slice(0, 60);
      continue;
    }
    const run = message.run;
    if (run === undefined || run.workspace === null || seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push({ runId: run.id, workspace: run.workspace, startedAt: run.startedAt, request });
  }
  return runs.reverse();
}
