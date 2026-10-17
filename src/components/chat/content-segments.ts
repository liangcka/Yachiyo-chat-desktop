import type { MessageContentSegment, ToolStep } from "../../domain/chat";

export function splitContentSegments(contentSegments: ReadonlyArray<MessageContentSegment>): {
  processSegments: ReadonlyArray<MessageContentSegment>;
  finalSegments: ReadonlyArray<MessageContentSegment>;
} {
  let finalTextIndex = contentSegments.length - 1;
  while (finalTextIndex >= 0 && contentSegments[finalTextIndex].type !== "text") finalTextIndex--;
  const processSegments = contentSegments.slice(0, Math.max(0, finalTextIndex));
  if (contentSegments.length <= 1 || !processSegments.some((segment) => segment.type === "tool")) {
    return { processSegments: [], finalSegments: contentSegments };
  }
  return { processSegments, finalSegments: contentSegments.slice(finalTextIndex) };
}

/** 仅使用完整的边界时间戳；工具时长和整条回复延迟无法确定过程结束时刻。 */
export function processDurationMs(
  processSegments: ReadonlyArray<MessageContentSegment>,
  toolSteps: ReadonlyArray<ToolStep> = [],
  contentStartedAtMs?: number,
): number | undefined {
  const first = processSegments[0];
  const last = [...processSegments].reverse().find((segment) => segment.type !== "text");
  const start = contentStartedAtMs ?? (first?.type === "thought" ? first.startedAtMs
    : first?.type === "tool" ? toolSteps.find((step) => step.id === first.toolId)?.startedAtMs : undefined);
  const end = last?.type === "thought" ? last.endedAtMs
    : last?.type === "tool" ? toolSteps.find((step) => step.id === last.toolId)?.result?.endedAtMs : undefined;
  return start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start : undefined;
}
