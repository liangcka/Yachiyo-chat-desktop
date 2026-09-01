import { useSyncExternalStore } from "react";

export type DeviceMode = "mobile" | "desktop";

function getSnapshot(): DeviceMode {
  return "desktop";
}

function getServerSnapshot(): DeviceMode {
  return "desktop";
}

function subscribe(): () => void {
  return () => {};
}

/**
 * 响应式设备形态检测 Hook：
 * 当前全平台统一采用桌面端现代化架构与响应式工作区布局。
 */
export function useDeviceMode(): DeviceMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
