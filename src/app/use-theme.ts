import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "yachiyo-theme";
const GLASS_STORAGE_KEY = "yachiyo-dark-glass";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const VALID_THEMES: readonly Theme[] = ["light", "dark", "system"];

// ── localStorage 读写 ──────────────────────────────────────────

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_THEMES as readonly string[]).includes(raw)) {
      return raw as Theme;
    }
  } catch {
    // SSR 或隐私模式下 localStorage 不可用，静默降级
  }
  return "system";
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 写入失败时静默降级
  }
}

/** 深色毛玻璃默认开启，仅显式关闭时才落盘为 "false" */
function readStoredGlass(): boolean {
  try {
    return localStorage.getItem(GLASS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredGlass(enabled: boolean): void {
  try {
    localStorage.setItem(GLASS_STORAGE_KEY, String(enabled));
  } catch {
    // 写入失败时静默降级
  }
}

// ── 外部存储协议（useSyncExternalStore） ───────────────────────

/** 全局监听器集合，用于在 setTheme 时通知所有订阅者 */
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);

  // 监听系统配色切换，以便 theme === "system" 时实时刷新 resolved 值
  const mql = window.matchMedia(DARK_MEDIA_QUERY);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", callback);
  } else {
    mql.addListener(callback);
  }

  return () => {
    listeners.delete(callback);
    if (typeof mql.removeEventListener === "function") {
      mql.removeEventListener("change", callback);
    } else {
      mql.removeListener(callback);
    }
  };
}

/** 根据系统偏好判断实际应用的亮/暗主题 */
function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

interface ThemeSnapshot {
  theme: Theme;
  resolved: "light" | "dark";
  glass: boolean;
}

/**
 * 快照引用缓存——仅当值真正变化时才创建新对象，
 * 避免 useSyncExternalStore 在引用不等时触发不必要的重渲染。
 */
let cachedSnapshot: ThemeSnapshot | null = null;

function getSnapshot(): ThemeSnapshot {
  const theme = readStoredTheme();
  const resolved = resolveTheme(theme);
  const glass = readStoredGlass();

  if (
    cachedSnapshot &&
    cachedSnapshot.theme === theme &&
    cachedSnapshot.resolved === resolved &&
    cachedSnapshot.glass === glass
  ) {
    return cachedSnapshot;
  }

  cachedSnapshot = { theme, resolved, glass };
  return cachedSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return { theme: "system", resolved: "light", glass: true };
}

/** 偏好写入后清除快照缓存并通知所有订阅者重渲染 */
function notifyListeners(): void {
  cachedSnapshot = null;
  listeners.forEach((cb) => cb());
}

// ── Hook ───────────────────────────────────────────────────────

/**
 * 主题管理 Hook（基于 useSyncExternalStore）：
 * 1. 从 localStorage 读取用户偏好（light / dark / system），无值时默认 system；
 * 2. system 模式实时跟随系统配色方案（prefers-color-scheme）；
 * 3. 将解析后的主题写入 document.documentElement.dataset.theme 供 CSS 消费；
 * 4. 深色毛玻璃偏好写入 dataset.glass（"on" / "off"），由 tokens.css 在深色主题下切换浮层材质。
 */
export function useTheme(): {
  theme: Theme;
  resolved: "light" | "dark";
  glass: boolean;
  setTheme: (t: Theme) => void;
  setGlass: (enabled: boolean) => void;
} {
  const { theme, resolved, glass } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // 将 resolved 主题同步到 DOM，供全局 CSS 变量 / 选择器使用
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    document.documentElement.dataset.glass = glass ? "on" : "off";
  }, [glass]);

  const setTheme = useCallback((t: Theme) => {
    writeStoredTheme(t);
    notifyListeners();
  }, []);

  const setGlass = useCallback((enabled: boolean) => {
    writeStoredGlass(enabled);
    notifyListeners();
  }, []);

  return { theme, resolved, glass, setTheme, setGlass };
}
