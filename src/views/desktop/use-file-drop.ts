import { useEffect, useRef, useState, type DragEvent } from "react";
import { isDesktopApp } from "../../services/app-platform";
import { onDesktopFileDrop } from "../../services/desktop-bridge";

interface FileDropOptions {
  enabled: boolean;
  /** 桌面端：系统拖入的文件路径 */
  onPaths: (paths: string[]) => void;
  /** 网页端：HTML5 拖放得到的 File */
  onFiles: (files: File[]) => void;
}

/**
 * 文件拖入聊天区。桌面端由 webview 原生拖放事件给出路径（落点在窗口任意位置都算），
 * 网页端用挂在聊天区上的 HTML5 事件；active 驱动放置区高亮
 */
export function useFileDrop({ enabled, onPaths, onFiles }: FileDropOptions) {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);
  const optionsRef = useRef({ enabled, onPaths, onFiles });
  useEffect(() => { optionsRef.current = { enabled, onPaths, onFiles }; });

  useEffect(() => {
    if (!isDesktopApp()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onDesktopFileDrop((event) => {
      if (event.type === "enter") {
        setActive(optionsRef.current.enabled && event.paths.length > 0);
        return;
      }
      setActive(false);
      if (event.type === "drop" && optionsRef.current.enabled && event.paths.length > 0) optionsRef.current.onPaths(event.paths);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  // dragenter/leave 会在子元素间反复触发，按层数计数才能判断是否真正离开聊天区
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!enabled || !carriesFiles(event)) return;
      depthRef.current += 1;
      setActive(true);
    },
    onDragOver: (event: DragEvent) => {
      if (enabled && carriesFiles(event)) event.preventDefault();
    },
    onDragLeave: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setActive(false);
    },
    onDrop: (event: DragEvent) => {
      depthRef.current = 0;
      setActive(false);
      if (!enabled || !carriesFiles(event)) return;
      event.preventDefault();
      onFiles(Array.from(event.dataTransfer.files));
    },
  };

  return { active: active && enabled, handlers };
}
