import { useEffect, useState } from "react";
import { DEFAULT_WHALE_ASSET_VERSION, isWhaleAssetVersion } from "../features/whale-widget/assets";

export interface WhaleWidgetSettings {
  /** 是否在工作台显示余额小鲸鱼 */
  enabled: boolean;
  /** DeepSeek 回复结束后是否冒泡提示本轮余额变化 */
  turnCostBubble: boolean;
  /** 鲸鱼娘素材所用的上游 npm 包版本，由「检查更新」推进 */
  assetVersion: string;
}

export interface PluginSettings {
  whaleWidget: WhaleWidgetSettings;
}

const STORAGE_KEY = "yachiyo-plugin-settings";
const CHANGE_EVENT = "yachiyo-plugin-settings-changed";

/** 插件一律默认关闭，由用户在设置的「插件」页主动开启 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  whaleWidget: { enabled: false, turnCostBubble: true, assetVersion: DEFAULT_WHALE_ASSET_VERSION },
};

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStorage(): PluginSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLUGIN_SETTINGS;
    const parsed = JSON.parse(raw) as { whaleWidget?: Partial<Record<keyof WhaleWidgetSettings, unknown>> };
    const whale = parsed.whaleWidget ?? {};
    const defaults = DEFAULT_PLUGIN_SETTINGS.whaleWidget;
    return {
      whaleWidget: {
        enabled: readBoolean(whale.enabled, defaults.enabled),
        turnCostBubble: readBoolean(whale.turnCostBubble, defaults.turnCostBubble),
        assetVersion: isWhaleAssetVersion(whale.assetVersion) ? whale.assetVersion : defaults.assetVersion,
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
