import { Capacitor } from "@capacitor/core";

/**
 * 原生壳（APK）API 线路表：优选域名在前，pages.dev 直连兜底。
 * 优选域名依赖第三方 CF 边缘 IP，在部分运营商网络可能不可达；
 * pages.dev 由 Cloudflare 官方解析，两条线路服务端行为完全一致。
 */
const nativeApiOrigins: readonly string[] = [
  "https://yachiyochat.amtale.cn",
  "https://yachiyo-chat-brn.pages.dev",
];

/** 网页版线路：同源相对路径（空串），无回退需求 */
const webApiOrigins: readonly string[] = [""];

/** 线路偏好持久化键（localStorage） */
const originStorageKey = "yachiyo-api-origin-v1";

function candidateOrigins(): readonly string[] {
  return Capacitor.isNativePlatform() ? nativeApiOrigins : webApiOrigins;
}

function readStoredOrigin(storage: StorageLike | undefined): string | null {
  try {
    return storage?.getItem(originStorageKey) ?? null;
  } catch {
    return null;
  }
}

function writeStoredOrigin(storage: StorageLike | undefined, origin: string): void {
  try {
    storage?.setItem(originStorageKey, origin);
  } catch {
    // 存储不可用时静默忽略：每次请求仍会尝试首选线路
  }
}

/** 测试注入用的最小存储接口（与 localStorage 结构兼容） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** 当前生效线路：已保存且仍在候选表内则沿用，否则取首选 */
export function currentApiOrigin(storage: StorageLike | undefined = defaultStorage()): string {
  const candidates = candidateOrigins();
  if (candidates.length === 1) {
    return candidates[0]!;
  }
  const stored = readStoredOrigin(storage);
  return stored !== null && candidates.includes(stored) ? stored : candidates[0]!;
}

/** 网络层失败判定：浏览器 fetch 连接失败抛 TypeError；中止（AbortError）不算 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/** 桌面端本地网关鉴权头名，与 src-tauri/src/server/http.rs 的 GATEWAY_TOKEN_HEADER 严格一致 */
const gatewayTokenHeader = "x-yachiyo-gateway-token";

/** 已取到的网关 token：null 表示尚未成功获取，空串表示本次获取不可用（不写入缓存，留待下次重试） */
let cachedGatewayToken: string | null = null;

/** 进行中的获取：并发首请求共用同一次 invoke，避免同时向 IPC 发起多趟调用 */
let pendingGatewayToken: Promise<string> | null = null;

/**
 * 桌面端判定就地内联而不复用 app-platform 的 isDesktopApp：
 * app-platform 依赖本模块的 currentApiOrigin，反向 import 会形成模块环。
 */
function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

async function resolveGatewayToken(): Promise<string> {
  if (cachedGatewayToken !== null) {
    return cachedGatewayToken;
  }
  // 失败不写缓存：IPC 尚未就绪或动态分包加载失败时若固化空值，此后整个会话的每个请求都会缺失 token
  pendingGatewayToken ??= import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<string>("get_gateway_token"))
    .then(
      (token) => {
        cachedGatewayToken = token;
        pendingGatewayToken = null;
        return token;
      },
      () => {
        pendingGatewayToken = null;
        return "";
      },
    );
  return pendingGatewayToken;
}

/** 为桌面端请求附加网关 token 头，其余调用点与请求体形态保持不变 */
async function withGatewayToken(init: RequestInit): Promise<RequestInit> {
  const token = await resolveGatewayToken();
  if (!token) {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.set(gatewayTokenHeader, token);
  return { ...init, headers };
}

/** 请求体可安全重发时才允许线路回退（字符串体未被消费；流式体不可重发） */
function isRetryableBody(init: RequestInit): boolean {
  return init.body === undefined || typeof init.body === "string";
}

export interface ApiFetchOptions {
  /** 请求发起函数；本模块只会以字符串 URL 调用（真实 fetch 与字符串 mock 均可注入） */
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  storage?: StorageLike;
}

/**
 * 统一 API 请求出口：带网络失败自动换线。
 * - 走当前线路发起请求；仅当「网络层失败（TypeError）且请求体可重发」时
 *   切换到下一条候选线路重试一次并记住新线路；
 * - HTTP 错误（4xx/5xx）是服务端正常响应，不换线，原样返回；
 * - 中止信号原样上抛，不重试；
 * - 桌面端额外注入本地网关 token 头（Web/PWA 与 APK 轨道完全走原路径）。
 */
export async function apiFetch(
  path: string,
  init: RequestInit,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const storage = options.storage ?? defaultStorage();
  const candidates = candidateOrigins();
  const primary = currentApiOrigin(storage);
  const requestInit = isDesktopRuntime() ? await withGatewayToken(init) : init;

  try {
    return await fetcher(primary + path, requestInit);
  } catch (error) {
    if (!isNetworkFailure(error) || !isRetryableBody(requestInit)) {
      throw error;
    }
    const currentIndex = candidates.indexOf(primary);
    const next = candidates[currentIndex + 1] ?? candidates[0];
    if (next === undefined || next === primary) {
      throw error;
    }
    writeStoredOrigin(storage, next);
    return await fetcher(next + path, requestInit);
  }
}

/** 手动切换到下一条线路（访问码页「切换线路」按钮：循环候选表） */
export function cycleApiOrigin(storage: StorageLike | undefined = defaultStorage()): string {
  const candidates = candidateOrigins();
  if (candidates.length === 1) {
    return candidates[0]!;
  }
  const current = currentApiOrigin(storage);
  const index = candidates.indexOf(current);
  const next = candidates[(index + 1) % candidates.length] ?? candidates[0]!;
  writeStoredOrigin(storage, next);
  return next;
}

/** 清空缓存存储与 Service Worker 注册（原生壳启动自愈 + 手动修复共用）；失败静默忽略 */
export async function clearWebCaches(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
  } catch {
    // 环境不支持或注销失败均忽略
  }
  try {
    const keys = await globalThis.caches?.keys();
    await Promise.all((keys ?? []).map((key) => globalThis.caches!.delete(key)));
  } catch {
    // 环境不支持或删除失败均忽略
  }
}

/**
 * 手动修复连接：清理 SW 与缓存 → 刷新页面重走启动流程。
 * 是否切换线路由调用方决定（先 cycleApiOrigin 再调用即可「换线重试」）。
 */
export async function recoverConnection(): Promise<void> {
  await clearWebCaches();
  globalThis.location.reload();
}
