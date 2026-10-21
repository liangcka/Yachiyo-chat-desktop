import type { MessageContentSegment } from "../domain/chat";
import type { ChatAction } from "./chat-reducer";

/**
 * 两次刷新的最小间隔：每次刷新都要整段重渲 Markdown 并重新布局、绘制，
 * 跟随显示器刷新率（高刷屏可达 144 次/秒）会白白占满 CPU，约 30 帧/秒的文字增长已足够顺滑
 */
const MIN_FLUSH_INTERVAL_MS = 32;

/** 流式 delta/thought 用 requestAnimationFrame 合并后再 dispatch，避免逐 chunk 触发全列表 reducer */
interface PendingStreamDelta {
  messageId: string;
  text: string;
  type: "delta" | "thought-delta";
  contentSegments: ReadonlyArray<MessageContentSegment>;
}

export interface StreamBatcher {
  /** 追加一个待合并的流式增量；返回 true 表示本次调度了 rAF 刷新 */
  push(action: PendingStreamDelta): boolean;
  /** 立即同步派发所有未合并的增量（终态/中止/卸载前必须调用） */
  flush(): void;
}

export function createStreamBatcher(
  emitAction: (action: ChatAction) => void,
): StreamBatcher {
  let pending: PendingStreamDelta[] = [];
  let frameHandle: number | undefined;
  let delayHandle: ReturnType<typeof setTimeout> | undefined;
  let lastFlushAt = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (frameHandle !== undefined) {
      cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    }
    if (delayHandle !== undefined) {
      clearTimeout(delayHandle);
      delayHandle = undefined;
    }
    if (pending.length === 0) return;
    lastFlushAt = performance.now();
    const batch = pending;
    pending = [];
    for (const action of batch) {
      emitAction(action);
    }
  };

  const schedule = () => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      flush();
      return false;
    }
    const requestFrame = () => {
      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = undefined;
        flush();
      });
    };
    const wait = lastFlushAt + MIN_FLUSH_INTERVAL_MS - performance.now();
    if (wait > 0) {
      delayHandle = setTimeout(() => {
        delayHandle = undefined;
        requestFrame();
      }, wait);
    } else {
      requestFrame();
    }
    return true;
  };

  return {
    push(action) {
      const last = pending.at(-1);
      if (last?.type === action.type && last.messageId === action.messageId) {
        pending[pending.length - 1] = { ...action, text: last.text + action.text };
      } else {
        pending.push(action);
      }
      if (frameHandle === undefined && delayHandle === undefined) return schedule();
      return false;
    },
    flush,
  };
}
