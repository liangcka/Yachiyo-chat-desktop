import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "yachiyo-theme";
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
  return "dark";
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
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
}

/**
 * 快照引用缓存——仅当值真正变化时才创建新对象，
 * 避免 useSyncExternalStore 在引用不等时触发不必要的重渲染。
 */
let cachedSnapshot: ThemeSnapshot | null = null;

function getSnapshot(): ThemeSnapshot {
  const theme = readStoredTheme();
  const resolved = resolveTheme(theme);

  if (
    cachedSnapshot &&
    cachedSnapshot.theme === theme &&
    cachedSnapshot.resolved === resolved
  ) {
    return cachedSnapshot;
  }

  cachedSnapshot = { theme, resolved };
  return cachedSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return { theme: "dark", resolved: "dark" };
}

// ── Hook ───────────────────────────────────────────────────────

/**
 * 主题管理 Hook（基于 useSyncExternalStore）：
 * 1. 从 localStorage 读取用户偏好（light / dark / system），无值时默认 system；
 * 2. system 模式实时跟随系统配色方案（prefers-color-scheme）；
 * 3. 将解析后的主题写入 document.documentElement.dataset.theme 供 CSS 消费。
 */
export function useTheme(): {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
} {
  const { theme, resolved } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // 将 resolved 主题同步到 DOM，供全局 CSS 变量 / 选择器使用
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = useCallback((t: Theme) => {
    writeStoredTheme(t);
    // 清除快照缓存，确保下次 getSnapshot 重新计算
    cachedSnapshot = null;
    // 通知所有订阅者触发重渲染
    listeners.forEach((cb) => cb());
  }, []);

  return { theme, resolved, setTheme };
}
