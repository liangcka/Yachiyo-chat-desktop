import { useSyncExternalStore } from "react";
import { isDesktopApp, isNativeApp } from "../services/app-platform";

export type DeviceMode = "mobile" | "desktop";

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function getSnapshot(): DeviceMode {
  if (isNativeApp()) return "mobile";
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches ? "desktop" : "mobile";
  }
  return isDesktopApp() ? "desktop" : "mobile";
}

function getServerSnapshot(): DeviceMode {
  return "mobile";
}

function subscribe(callback: () => void): () => void {
  if (isNativeApp()) {
    return () => {};
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const mediaQueryList = window.matchMedia(DESKTOP_MEDIA_QUERY);
  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", callback);
    return () => {
      mediaQueryList.removeEventListener("change", callback);
    };
  } else {
    mediaQueryList.addListener(callback);
    return () => {
      mediaQueryList.removeListener(callback);
    };
  }
}

/**
 * 响应式设备形态检测 Hook（基于 useSyncExternalStore，零同步 setState 级联渲染）：
 * 1. Capacitor 原生壳（APK）强制为 "mobile"；
 * 2. 桌面应用（Tauri）与 Web 浏览器环境依据 1024px 媒体查询动态响应视口宽度自适应。
 */
export function useDeviceMode(): DeviceMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
