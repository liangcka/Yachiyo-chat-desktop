import { useEffect, useState } from "react";

export interface WhaleWidgetSettings {
  /** 是否在工作台显示余额小鲸鱼；挂件自身的外观、音效与提示设置由其菜单管理 */
  enabled: boolean;
  /** 是否在小鲸鱼头顶扣上可敲的铁盆 */
  bowl: boolean;
}

export interface PluginSettings {
  whaleWidget: WhaleWidgetSettings;
}

const STORAGE_KEY = "yachiyo-plugin-settings";
const CHANGE_EVENT = "yachiyo-plugin-settings-changed";

/** 插件一律默认关闭，由用户在设置的「插件」页主动开启 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  whaleWidget: { enabled: false, bowl: true },
};

function readStorage(): PluginSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLUGIN_SETTINGS;
    const parsed = JSON.parse(raw) as { whaleWidget?: { enabled?: unknown; bowl?: unknown } };
    const { enabled, bowl } = parsed.whaleWidget ?? {};
    const defaults = DEFAULT_PLUGIN_SETTINGS.whaleWidget;
    return {
      whaleWidget: {
        enabled: typeof enabled === "boolean" ? enabled : defaults.enabled,
        bowl: typeof bowl === "boolean" ? bowl : defaults.bowl,
      },
    };
  } catch {
    return DEFAULT_PLUGIN_SETTINGS;
  }
}

export function getPluginSettings(): PluginSettings {
  return readStorage();
}

/** 合并保存余额小鲸鱼的设置，并通知同页面的其他订阅者 */
export function saveWhaleWidgetSettings(partial: Partial<WhaleWidgetSettings>): PluginSettings {
  const current = readStorage();
  const next: PluginSettings = { ...current, whaleWidget: { ...current.whaleWidget, ...partial } };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下 localStorage 不可用，仍在本次会话内生效 */
  }
  window.dispatchEvent(new CustomEvent<PluginSettings>(CHANGE_EVENT, { detail: next }));
  return next;
}

/** 响应式订阅插件设置：设置页改动后挂件立即出现或消失 */
export function usePluginSettings(): PluginSettings {
  const [settings, setSettings] = useState<PluginSettings>(readStorage);

  useEffect(() => {
    const handler = (event: Event) => {
      setSettings((event as CustomEvent<PluginSettings>).detail ?? readStorage());
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  return settings;
}
