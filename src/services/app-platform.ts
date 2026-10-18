import { Capacitor } from "@capacitor/core";
import { currentApiOrigin } from "./api-origins";

/** 是否运行在 Capacitor 原生壳（APK）中 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** 是否运行在 Tauri 桌面独立应用中 */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/** API 请求基址：网页版同源（空串相对路径），APK 走当前生效线路；桌面端由 apiFetch 直连本地网关端口 */
export function apiOrigin(): string {
  return currentApiOrigin();
}

/** fetch 凭据模式：APK 跨源需 include 才能携带会话 cookie；网页同源，桌面网关以 token 头鉴权不依赖 cookie */
export function apiCredentials(): RequestCredentials {
  return isNativeApp() ? "include" : "same-origin";
}
