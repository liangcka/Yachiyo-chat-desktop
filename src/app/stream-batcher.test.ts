import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatAction } from "./chat-reducer";
import { createStreamBatcher } from "./stream-batcher";

const delta = (text: string) => ({ messageId: "m", text, type: "delta" as const, contentSegments: [] });

function collect(): { texts: string[]; emit: (action: ChatAction) => void } {
  const texts: string[] = [];
  return {
    texts,
    emit: (action) => {
      if (action.type === "delta") texts.push(action.text);
    },
  };
}

describe("createStreamBatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("合并同一消息的增量，两次刷新之间至少间隔约 32ms", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { texts, emit } = collect();
    const batcher = createStreamBatcher(emit);

    batcher.push(delta("a"));
    batcher.push(delta("b"));
    vi.advanceTimersByTime(16);
    expect(texts).toEqual(["ab"]);

    batcher.push(delta("c"));
    batcher.push(delta("d"));
    vi.advanceTimersByTime(16);
    expect(texts).toEqual(["ab"]);
    vi.advanceTimersByTime(32);
    expect(texts).toEqual(["ab", "cd"]);
  });

  it("flush 立即派发并取消已排程的刷新", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { texts, emit } = collect();
    const batcher = createStreamBatcher(emit);

    batcher.push(delta("a"));
    vi.advanceTimersByTime(16);
    batcher.push(delta("b"));
    batcher.flush();
    expect(texts).toEqual(["a", "b"]);
    vi.advanceTimersByTime(100);
    expect(texts).toEqual(["a", "b"]);
  });
});
