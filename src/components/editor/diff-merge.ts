import { applyPatch, reversePatch, structuredPatch } from "diff";

/* ── git status --short 解析 ─────────────────────────────── */

export type GitChangeStatus = "modified" | "added" | "deleted";

export interface GitChangeEntry {
  /** 仓库相对路径（`/` 分隔） */
  path: string;
  status: GitChangeStatus;
}

/**
 * 解析 `git status --short` 输出。
 * XY 两列（X=index / Y=worktree）取信息量更高的一侧：
 * D > A > M；`??` 归入 added（新文件），`!!` ignored 与 rename 详情跳过。
 */
export function parseGitStatusShort(output: string): GitChangeEntry[] {
  const entries: GitChangeEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;

    const x = line[0];
    const y = line[1];
    if (x === undefined || y === undefined || x === "!" || y === "!") continue;

    const pathPart = line.slice(3);
    if (pathPart.length === 0) continue;

    // rename 记录 `old -> new`：本期按新路径的 modified 处理
    const arrowIndex = pathPart.indexOf(" -> ");
    const path = (arrowIndex >= 0 ? pathPart.slice(arrowIndex + 4) : pathPart)
      .replace(/\\/g, "/")
      .replace(/^"|"$/g, "");

    // 未跟踪（??）单独判级；其余按 XY 列取信息量更高的一侧
    const status = x === "?" || y === "?" ? "added" : pickStatus(x) ?? pickStatus(y);
    if (status === undefined || path.length === 0) continue;
    entries.push({ path, status });
  }
  return entries;
}

function pickStatus(code: string): GitChangeStatus | undefined {
  switch (code) {
    case "D":
      return "deleted";
    case "A":
      return "added";
    case "M":
    case "R":
    case "C":
      return "modified";
    default:
      return undefined;
  }
}

/* ── hunk 模型与计算 ─────────────────────────────────────── */

export type DiffLineType = "ctx" | "add" | "del";

export interface DiffHunkLine {
  type: DiffLineType;
  text: string;
}

export interface ReviewHunk {
  /** 原文件起始行（1-based） */
  oldStart: number;
  /** 新文件起始行（1-based） */
  newStart: number;
  lines: DiffHunkLine[];
}

const HUNK_CONTEXT = 3;

export function toReviewHunks(original: string, modified: string): ReviewHunk[] {
  const patch = structuredPatch("", "", original, modified, "", "", { context: HUNK_CONTEXT });
  return patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    // `\ No newline at end of file` 为 jsdiff 的元信息行，不属于内容，直接丢弃
    lines: hunk.lines
      .filter((line) => !line.startsWith("\\"))
      .map((line) => ({
        type: line.startsWith("+") ? ("add" as const) : line.startsWith("-") ? ("del" as const) : ("ctx" as const),
        text: line.slice(1),
      })),
  }));
}

/* ── 按块撤销 ─────────────────────────────────────────── */

/**
 * 撤销所选块：从当前内容出发，把所选块还原为基线一侧，未选择的块保持现状。
 * 块的编号与 toReviewHunks(baseline, current) 一致；补丁无法套用（内容已变化）时返回 undefined，
 * 调用方不得退回整体覆盖
 */
export function revertSelectedHunks(baseline: string, current: string, selected: readonly boolean[]): string | undefined {
  const patch = structuredPatch("", "", baseline, current, "", "", { context: HUNK_CONTEXT });
  const chosen = { ...patch, hunks: patch.hunks.filter((_, index) => selected[index] === true) };
  if (chosen.hunks.length === 0) return current;
  const result = applyPatch(current, reversePatch(chosen));
  return result === false ? undefined : result;
}
