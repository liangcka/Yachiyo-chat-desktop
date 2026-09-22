import { useEffect, useState } from "react";

export const PRESET_USER_BADGES = ["Lite", "Go", "Plus", "Pro"] as const;
export type PresetUserBadge = (typeof PRESET_USER_BADGES)[number];

export interface LocalUserSettings {
  /** 用户名；留空或未设置时默认展示为“酒寄彩叶” */
  username: string;
  /** 自定义头像 Data URL；留空时使用默认矢量图标 */
  avatar: string;
  /** 用户称号/身份等级；默认为“Lite”，支持快捷预设或自定义输入 */
  badge: string;
  /** Live2D 看板娘显示开关；默认为 true */
  showLive2d: boolean;
}

const STORAGE_KEY = "yachiyo-local-user-settings";
const CHANGE_EVENT = "yachiyo-user-settings-changed";

export const DEFAULT_USER_SETTINGS: LocalUserSettings = {
  username: "酒寄彩叶",
  avatar: "",
  badge: "Lite",
  showLive2d: true,
};

function readStorage(): LocalUserSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_USER_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LocalUserSettings>;
    return {
      username:
        typeof parsed.username === "string" && parsed.username.trim().length > 0
          ? parsed.username.trim()
          : DEFAULT_USER_SETTINGS.username,
      avatar: typeof parsed.avatar === "string" ? parsed.avatar : "",
      badge:
        typeof parsed.badge === "string" && parsed.badge.trim().length > 0
          ? parsed.badge.trim()
          : DEFAULT_USER_SETTINGS.badge,
      showLive2d:
        typeof parsed.showLive2d === "boolean"
          ? parsed.showLive2d
          : DEFAULT_USER_SETTINGS.showLive2d,
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}

/** 读取当前本地用户设置（纯客户端 localStorage，绝不上云） */
export function getLocalUserSettings(): LocalUserSettings {
  return readStorage();
}

/** 保存本地用户设置，并派发同页面多组件同步事件 */
export function saveLocalUserSettings(partial: Partial<LocalUserSettings>): LocalUserSettings {
  const current = readStorage();
  const next: LocalUserSettings = {
    username:
      partial.username !== undefined
        ? partial.username.trim() || DEFAULT_USER_SETTINGS.username
        : current.username,
    avatar:
      partial.avatar !== undefined
        ? partial.avatar
        : current.avatar,
    badge:
      partial.badge !== undefined
        ? partial.badge.trim() || DEFAULT_USER_SETTINGS.badge
        : current.badge,
    showLive2d:
      partial.showLive2d !== undefined
        ? partial.showLive2d
        : current.showLive2d,
  };

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
    } catch {
      /* 存储空间满或隐私模式抛错时静默降级 */
    }
  }

  return next;
}

/** 重置本地用户设置为默认状态 */
export function resetLocalUserSettings(): LocalUserSettings {
  return saveLocalUserSettings(DEFAULT_USER_SETTINGS);
}

/** 将本地选取的头像图片裁剪缩放为轻量 Data URL（防止撑满 LocalStorage） */
export async function processAvatarFile(file: File, targetSize = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片格式文件"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片文件失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("加载图片失败"));
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(reader.result as string);
            return;
          }

          // 正方形居中裁切
          const minDim = Math.min(img.width, img.height);
          const srcX = (img.width - minDim) / 2;
          const srcY = (img.height - minDim) / 2;

          ctx.drawImage(img, srcX, srcY, minDim, minDim, 0, 0, targetSize, targetSize);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve(dataUrl);
        } catch {
          resolve(reader.result as string);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** 响应式订阅本地用户设置变化 Hook */
export function useLocalUserSettings(): [
  LocalUserSettings,
  (partial: Partial<LocalUserSettings>) => LocalUserSettings,
] {
  const [settings, setSettings] = useState<LocalUserSettings>(getLocalUserSettings);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<LocalUserSettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      } else {
        setSettings(getLocalUserSettings());
      }
    };

    window.addEventListener(CHANGE_EVENT, handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
    };
  }, []);

  return [settings, saveLocalUserSettings];
}
