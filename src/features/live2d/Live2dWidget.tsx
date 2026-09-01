import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LOCAL_LIVE2D_PATH,
  type Live2dHomePosition,
  type Live2dPosition,
  type Live2dSettings,
} from "../../services/live2d-settings";
import { getCharacter, getOutfit, MYGO_CHARACTERS } from "./data/models";
import { useLive2dController } from "./hooks/use-live2d-controller";
import { Live2dSpeechBubble } from "./components/Live2dSpeechBubble";
import { Live2dQuickBar } from "./components/Live2dQuickBar";
import { Live2dOutfitPicker } from "./components/Live2dOutfitPicker";
import "./live2d.css";

declare global {
  interface Window {
    initWidget?: (config: {
      cdnPath: string;
      preload?: string;
      tools?: string[];
      apiPath?: string;
    }) => Promise<void> | void;
    live2dInstance?: {
      loadModel: (charIndex: number, outfitIndex: number) => Promise<void>;
      model?: {
        motion?: (name?: string) => void;
        expression?: (name?: string) => void;
      };
    };
  }
}

export interface Live2dWidgetProps {
  settings: Live2dSettings;
  onSettingsChange?: (partial: Partial<Live2dSettings>) => void;
  chatPhase?: "loading" | "idle" | "streaming" | "offline" | "error" | "compressing";
}

function loadResource(url: string, type: "css" | "js"): Promise<void> {
  return new Promise((resolve, reject) => {
    const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
    if (type === "css") {
      const existing = document.querySelector(`link[href="${url}"]`);
      if (existing) {
        resolve();
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load stylesheet: ${url}`));
      document.head.appendChild(link);
      if (isJsdom) {
        setTimeout(resolve, 0);
      }
    } else {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.head.appendChild(script);
      if (isJsdom) {
        setTimeout(resolve, 0);
      }
    }
  });
}

function cleanupLive2dDom(): void {
  const waifu = document.getElementById("waifu");
  if (waifu) waifu.remove();
  const toggle = document.getElementById("waifu-toggle");
  if (toggle) toggle.remove();
}

function setupDragging(
  waifu: HTMLElement,
  onDragEnd: (pos: { x: number; y: number }) => void,
): () => void {
  let isDown = false;
  let hasMoved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let width = 300;
  let targetX = 0;
  let targetY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let rafId: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(".live2d-quick-bar") ||
      target?.closest(".live2d-speech-bubble") ||
      target?.closest("#model-selection-panel") ||
      target?.closest("#texture-selection-panel")
    ) {
      return;
    }

    isDown = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;

    const domRect = waifu.getBoundingClientRect();
    originLeft = domRect.left;
    originTop = domRect.top;
    width = domRect.width || 300;
    targetX = originLeft;
    targetY = originTop;
    deltaX = 0;
    deltaY = 0;

    try {
      waifu.setPointerCapture(e.pointerId);
    } catch {
      // 忽略测试环境
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDown) return;
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;

    if (!hasMoved) {
      if (Math.hypot(moveX, moveY) >= 5) {
        hasMoved = true;
        waifu.classList.add("waifu-dragging");
      } else {
        return;
      }
    }

    const minTop = 0;
    const maxTop = Math.max(0, window.innerHeight - 80);
    const minLeft = 0;
    const maxLeft = Math.max(0, window.innerWidth - 80);

    targetX = Math.max(minLeft, Math.min(originLeft + moveX, maxLeft));
    targetY = Math.max(minTop, Math.min(originTop + moveY, maxTop));
    deltaX = targetX - originLeft;
    deltaY = targetY - originTop;

    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        waifu.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        const isRightSide = targetX + width / 2 > window.innerWidth / 2;
        waifu.classList.toggle("waifu-side-right", isRightSide);
        waifu.classList.toggle("waifu-side-left", !isRightSide);
      });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!isDown) return;
    isDown = false;
    try {
      waifu.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    waifu.classList.remove("waifu-dragging");
    waifu.style.transform = "";

    if (hasMoved) {
      const suppressClick = (clickEvent: MouseEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      };
      window.addEventListener("click", suppressClick, { capture: true, once: true });

      const finalX = Math.round(targetX);
      const finalY = Math.round(targetY);

      waifu.style.left = `${finalX}px`;
      waifu.style.top = `${finalY}px`;
      waifu.style.right = "auto";
      waifu.style.bottom = "auto";

      onDragEnd({ x: finalX, y: finalY });
    }
  };

  waifu.addEventListener("pointerdown", onPointerDown);
  waifu.addEventListener("pointermove", onPointerMove);
  waifu.addEventListener("pointerup", onPointerUp);
  waifu.addEventListener("pointercancel", onPointerUp);

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    waifu.removeEventListener("pointerdown", onPointerDown);
    waifu.removeEventListener("pointermove", onPointerMove);
    waifu.removeEventListener("pointerup", onPointerUp);
    waifu.removeEventListener("pointercancel", onPointerUp);
  };
}

export function Live2dWidget({ settings, onSettingsChange, chatPhase }: Live2dWidgetProps) {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  const [waifuContainer, setWaifuContainer] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("waifu") : null,
  );
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const {
    speech,
    speak,
    triggerRandomQuote,
    switchCharacter,
    isPickerOpen,
    setPickerOpen,
    activeCharacter,
  } = useLive2dController({
    settings,
    onSettingsChange,
    chatPhase,
  });

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const shouldRender =
    settings.enabled && viewportWidth >= (settings.widthLimit || 768);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });
  const currentModelRef = useRef<{ char: number; outfit: number } | null>(null);

  const mascotSide: "left" | "right" =
    settings.position === "custom"
      ? (settings.customPosition?.x ?? 0) + 150 > viewportWidth / 2
        ? "right"
        : "left"
      : settings.position === "right"
        ? "right"
        : "left";

  const localBase = LOCAL_LIVE2D_PATH;

  const handleHomeClick = useCallback(() => {
    const targetHome: Live2dHomePosition =
      settingsRef.current.homePosition ?? (settingsRef.current.position === "right" ? "right" : "left");
    speak("我回家啦~ 🏠", "smile01", 2500);
    applyPosition(targetHome, undefined, targetHome);
    onSettingsChange?.({
      position: targetHome,
    });
  }, [onSettingsChange, speak]);

  const handleDragEnd = useCallback(
    (customPos: { x: number; y: number }) => {
      onSettingsChange?.({
        position: "custom",
        customPosition: customPos,
      });
    },
    [onSettingsChange],
  );

  const attachDragging = useCallback((el: HTMLElement) => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
    }
    dragCleanupRef.current = setupDragging(el, handleDragEnd);
  }, [handleDragEnd]);

  // 1. 初始化或挂载 Live2D 底座（仅在首次加载或切换 enabled 时初始化）
  useEffect(() => {
    if (!shouldRender) {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
      cleanupLive2dDom();
      return;
    }

    let cancelled = false;

    // 清除历史 waifu-display 状态，确保模型可渲染
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("waifu-display");
        localStorage.setItem("modelId", (settingsRef.current.characterIndex ?? 0).toString());
        localStorage.setItem("modelTexturesId", (settingsRef.current.outfitIndex ?? 0).toString());
      } catch {
        // ignore
      }
    }

    const init = async () => {
      try {
        await Promise.all([
          loadResource(`${localBase}waifu.css`, "css"),
          loadResource(`${localBase}live2d.min.js`, "js"),
        ]);
        if (cancelled) return;

        await loadResource(`${localBase}index.js`, "js");
        if (cancelled) return;

        const existingWaifu = document.getElementById("waifu");
        if (!existingWaifu && typeof window.initWidget === "function") {
          cleanupLive2dDom();

          await window.initWidget({
            cdnPath: localBase,
            preload: settingsRef.current.preload,
            tools: ["switch-model", "info", "quit"],
          });
        }

        const currentSettings = settingsRef.current;
        const charIdx = currentSettings.characterIndex ?? 0;
        const outfitIdx = currentSettings.outfitIndex ?? 0;
        currentModelRef.current = { char: charIdx, outfit: outfitIdx };

        if (window.live2dInstance?.loadModel) {
          try {
            await window.live2dInstance.loadModel(charIdx, outfitIdx);
          } catch {
            // ignore
          }
        }

        const waifu = document.getElementById("waifu");
        if (waifu && !cancelled) {
          setWaifuContainer(waifu);
          applyVisuals(waifu, currentSettings.scale, currentSettings.opacity);
          applyPosition(currentSettings.position, currentSettings.customPosition, currentSettings.homePosition);
          attachDragging(waifu);
        }
      } catch (err) {
        console.warn("[Live2D] Failed to initialize local live2d-widget-mygo:", err);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
      cleanupLive2dDom();
    };
  }, [
    attachDragging,
    localBase,
    shouldRender,
  ]);

  // 2. 当模型或服装设置变更时，直接热更新模型
  useEffect(() => {
    if (!shouldRender) return;
    const charIdx = settings.characterIndex ?? 0;
    const outfitIdx = settings.outfitIndex ?? 0;

    if (
      currentModelRef.current?.char === charIdx &&
      currentModelRef.current?.outfit === outfitIdx
    ) {
      return;
    }

    if (window.live2dInstance?.loadModel) {
      currentModelRef.current = { char: charIdx, outfit: outfitIdx };
      void window.live2dInstance.loadModel(charIdx, outfitIdx);
    }
  }, [settings.characterIndex, settings.outfitIndex, shouldRender]);

  // 3. 当缩放、透明度、位置变更时即时同步样式
  useEffect(() => {
    if (shouldRender) {
      const waifu = document.getElementById("waifu");
      if (waifu) {
        applyVisuals(waifu, settings.scale, settings.opacity);
        applyPosition(settings.position, settings.customPosition, settings.homePosition);
        attachDragging(waifu);
      }
    }
  }, [
    attachDragging,
    settings.customPosition,
    settings.homePosition,
    settings.opacity,
    settings.position,
    settings.scale,
    shouldRender,
  ]);

  const handleSelectOutfit = useCallback(
    (charIdx: number, outfitIdx: number) => {
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("modelId", charIdx.toString());
          localStorage.setItem("modelTexturesId", outfitIdx.toString());
        } catch {
          // ignore
        }
      }
      onSettingsChange?.({
        characterIndex: charIdx,
        outfitIndex: outfitIdx,
      });
      const targetChar = getCharacter(charIdx);
      const outfit = getOutfit(charIdx, outfitIdx);
      speak(`换上「${outfit.name}」啦！`, "smile02", 3000, targetChar);
    },
    [onSettingsChange, speak],
  );

  // 快捷循环切换下一位角色
  const handleNextCharacter = useCallback(() => {
    const nextCharIndex = ((settings.characterIndex ?? 0) + 1) % MYGO_CHARACTERS.length;
    switchCharacter(nextCharIndex);
  }, [settings.characterIndex, switchCharacter]);

  if (!shouldRender || !waifuContainer) {
    return null;
  }

  return (
    <>
      {/* 挂件内现代化台词气泡 */}
      {createPortal(
        <Live2dSpeechBubble
          speech={speech}
          character={activeCharacter}
          side={mascotSide}
          onDismiss={() => speak("", undefined, 0)}
        />,
        waifuContainer,
      )}

      {/* 挂件内现代化快捷操作栏 */}
      {createPortal(
        <Live2dQuickBar
          character={activeCharacter}
          side={mascotSide}
          onNextCharacter={handleNextCharacter}
          onOpenPicker={() => setPickerOpen(true)}
          onInteract={triggerRandomQuote}
          onHome={handleHomeClick}
          onHide={() => onSettingsChange?.({ enabled: false })}
        />,
        waifuContainer,
      )}

      {/* 角色与换装立绘工坊弹窗 */}
      {isPickerOpen && typeof document !== "undefined"
        ? createPortal(
            <Live2dOutfitPicker
              characterIndex={settings.characterIndex ?? 0}
              outfitIndex={settings.outfitIndex ?? 0}
              onSelect={handleSelectOutfit}
              onClose={() => setPickerOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function applyVisuals(waifu: HTMLElement, scale = 1.0, opacity = 1.0) {
  waifu.style.setProperty("--mascot-scale", String(scale));
  waifu.style.setProperty("--mascot-opacity", String(opacity));
}

function applyPosition(
  position: Live2dPosition,
  customPosition?: { x: number; y: number },
  homePosition: Live2dHomePosition = "left",
) {
  const waifu = document.getElementById("waifu");
  const toggle = document.getElementById("waifu-toggle");
  if (!waifu) return;

  waifu.classList.remove(
    "waifu-position-left",
    "waifu-position-right",
    "waifu-position-custom",
    "waifu-side-left",
    "waifu-side-right",
  );

  if (position === "custom") {
    waifu.classList.add("waifu-position-custom");
    if (customPosition && Number.isFinite(customPosition.x) && Number.isFinite(customPosition.y)) {
      const maxLeft = Math.max(0, window.innerWidth - 80);
      const maxTop = Math.max(0, window.innerHeight - 80);
      const clampedX = Math.max(0, Math.min(customPosition.x, maxLeft));
      const clampedY = Math.max(0, Math.min(customPosition.y, maxTop));
      waifu.style.left = `${clampedX}px`;
      waifu.style.top = `${clampedY}px`;
      waifu.style.right = "auto";
      waifu.style.bottom = "auto";

      const isRightSide = clampedX + (waifu.getBoundingClientRect().width || 300) / 2 > window.innerWidth / 2;
      waifu.classList.toggle("waifu-side-right", isRightSide);
      waifu.classList.toggle("waifu-side-left", !isRightSide);
    }
  } else {
    waifu.style.left = "";
    waifu.style.top = "";
    waifu.style.right = "";
    waifu.style.bottom = "-60px";
    waifu.classList.add(`waifu-position-${position}`);
  }

  if (toggle) {
    toggle.classList.remove("waifu-toggle-right");
    const effectiveSide = position === "custom" ? homePosition : position;
    if (effectiveSide === "right") {
      toggle.classList.add("waifu-toggle-right");
    }
  }
}
