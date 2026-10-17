import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

interface PendingTransition {
  bounds: DOMRect;
  conversationId: string | undefined;
}

interface ComposerDockTransition {
  composerRef: RefObject<HTMLDivElement | null>;
  prepareTransition: () => void;
}

/** 只在空白会话的首次发送时连接输入区的两个位置；历史切换不播放位移动画。 */
export function useComposerDockTransition(
  isBlank: boolean,
  conversationId: string | undefined,
): ComposerDockTransition {
  const composerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingTransition | null>(null);

  const prepareTransition = (): void => {
    const element = composerRef.current;
    pendingRef.current = isBlank && element
      ? { bounds: element.getBoundingClientRect(), conversationId }
      : null;
  };

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (pending?.conversationId !== undefined && pending.conversationId !== conversationId) {
      pendingRef.current = null;
      return;
    }
    if (isBlank || !pending) return;
    pendingRef.current = null;

    const element = composerRef.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || !element.animate || preference.matches) return;

    const target = element.getBoundingClientRect();
    if (!pending.bounds.width || !target.width) return;
    const x = pending.bounds.left - target.left;
    const y = pending.bounds.top - target.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;

    const style = getComputedStyle(element);
    const durationToken = style.getPropertyValue("--motion-duration-panel").trim();
    const duration = parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
    const animation = element.animate(
      [
        { transform: `translate(${x}px, ${y}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: Number.isFinite(duration) ? duration : 250,
        easing: style.getPropertyValue("--ease-in-out").trim() || "cubic-bezier(0.77, 0, 0.175, 1)",
      },
    );

    const release = (): void => {
      window.removeEventListener("resize", cancel);
      preference.removeEventListener("change", cancel);
      animation.onfinish = null;
      animation.oncancel = null;
    };
    const cancel = (): void => {
      animation.cancel();
      release();
    };
    animation.onfinish = release;
    animation.oncancel = release;
    window.addEventListener("resize", cancel);
    preference.addEventListener("change", cancel);

    return cancel;
  }, [isBlank, conversationId]);

  return { composerRef, prepareTransition };
}
