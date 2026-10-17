import { describe, expect, it } from "vitest";
import type { MessageContentSegment } from "../../domain/chat";
import { processDurationMs, splitContentSegments } from "./content-segments";

describe("splitContentSegments", () => {
  const segments: ReadonlyArray<MessageContentSegment> = [
    { type: "thought", start: 0, end: 4, startedAtMs: 100, endedAtMs: 2100 },
    { type: "text", start: 0, end: 4 },
    { type: "tool", toolId: "one" },
    { type: "text", start: 4, end: 8 },
    { type: "tool", toolId: "two" },
    { type: "thought", start: 4, end: 8, startedAtMs: 24100, endedAtMs: 25100 },
    { type: "text", start: 8, end: 12 },
  ];

  it("把最后一段正文之前的所有过程按原顺序拆出，且不修改输入", () => {
    const input = Object.freeze([...segments]);
    const result = splitContentSegments(input);
    expect(result.processSegments).toEqual(segments.slice(0, -1));
    expect(result.finalSegments).toEqual(segments.slice(-1));
    expect(input).toEqual(segments);
  });

  it.each([
    [],
    [{ type: "text", start: 0, end: 4 }],
    [{ type: "tool", toolId: "one" }],
    [{ type: "thought", start: 0, end: 4 }, { type: "text", start: 0, end: 4 }],
    [{ type: "tool", toolId: "one" }, { type: "tool", toolId: "two" }],
  ] satisfies MessageContentSegment[][])("没有可折叠过程时保留全部内容：%j", (...input) => {
    const result = splitContentSegments(input);
    expect(result.processSegments).toEqual([]);
    expect(result.finalSegments).toEqual(input);
  });

  it("保留最终正文后的片段，避免遗漏未形成完整答案的记录", () => {
    const tail: MessageContentSegment = { type: "tool", toolId: "tail" };
    expect(splitContentSegments([...segments, tail]).finalSegments).toEqual([segments.at(-1), tail]);
  });

  it("耗时包含过程中的过渡文字和工具等待，截止最后一个思考片段结束", () => {
    expect(processDurationMs(segments.slice(0, -1))).toBe(25000);
  });

  it("不把末尾过渡文字算入耗时", () => {
    expect(processDurationMs(segments.slice(0, -1).concat({ type: "text", start: 8, end: 9 }))).toBe(25000);
  });

  it("工具结束时使用接收结果的时间戳，包含批准等待且不计最终回答", () => {
    expect(processDurationMs([
      { type: "text", start: 0, end: 4 },
      { type: "tool", toolId: "one" },
    ], [{ id: "one", name: "read_file", argumentsJson: "{}", startedAtMs: 1100,
      result: { output: "ok", isError: false, durationMs: 10, endedAtMs: 25100 } }], 100)).toBe(25000);
  });

  it("以工具开始的过程可直接使用工具起止时间戳", () => {
    expect(processDurationMs([{ type: "tool", toolId: "one" }], [
      { id: "one", name: "read_file", argumentsJson: "{}", startedAtMs: 100,
        result: { output: "ok", isError: false, durationMs: 10, endedAtMs: 25100 } },
    ])).toBe(25000);
  });

  it.each([
    segments.slice(1, -1),
    segments.slice(0, -2),
    [{ type: "thought", start: 0, end: 4 }],
    [{ type: "thought", start: 0, end: 4, startedAtMs: 100, endedAtMs: 50 }],
    [{ type: "thought", start: 0, end: 4, startedAtMs: Number.NaN, endedAtMs: 100 }],
  ] satisfies ReadonlyArray<MessageContentSegment>[])("起止时间戳不完整或无效时省略耗时：%j", (...input) => {
    expect(processDurationMs(input)).toBeUndefined();
  });
});
