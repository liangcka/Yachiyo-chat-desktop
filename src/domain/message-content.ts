import type { MessageContentSegment } from "./chat";

/** 思考片段在下一类事件到达或回复终止时结束，不计入后续工具与正文耗时。 */
export function finishThoughtSegment(
  segments: ReadonlyArray<MessageContentSegment>,
  atMs: number,
): ReadonlyArray<MessageContentSegment> {
  const last = segments.at(-1);
  return last?.type === "thought" && last.endedAtMs === undefined
    ? [...segments.slice(0, -1), { ...last, endedAtMs: atMs }]
    : segments;
}

export function appendContentSegment(
  segments: ReadonlyArray<MessageContentSegment>,
  segment: MessageContentSegment,
  atMs: number,
): ReadonlyArray<MessageContentSegment> {
  const last = segments.at(-1);
  if (segment.type !== "tool" && last?.type === segment.type && last.end === segment.start) {
    return [...segments.slice(0, -1), { ...last, end: segment.end }];
  }
  return [...finishThoughtSegment(segments, atMs), segment];
}
