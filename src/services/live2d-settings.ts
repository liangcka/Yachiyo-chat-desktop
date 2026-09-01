import type { YachiyoDatabase } from "../data/db";

export type Live2dPosition = "left" | "right" | "custom";
export type Live2dHomePosition = "left" | "right";
export type Live2dPreload = "ALL" | "IDLE" | "NONE";

export interface Live2dCustomPosition {
  x: number;
  y: number;
}

export interface Live2dSettings {
  enabled: boolean;
  position: Live2dPosition;
  homePosition?: Live2dHomePosition;
  customPosition?: Live2dCustomPosition;
  preload: Live2dPreload;
  widthLimit: number;
  characterIndex: number;
  outfitIndex: number;
  scale: number;
  opacity: number;
  aiReactivity: boolean;
  soundEnabled: boolean;
}

export const LOCAL_LIVE2D_PATH = "/live2d/";

export const defaultLive2dSettings: Live2dSettings = {
  enabled: true,
  position: "left",
  homePosition: "left",
  customPosition: undefined,
  preload: "IDLE",
  widthLimit: 768,
  characterIndex: 0,
  outfitIndex: 0,
  scale: 1.0,
  opacity: 1.0,
  aiReactivity: true,
  soundEnabled: false,
};

const LIVE2D_SETTINGS_KEY = "live2dSettings" as const;

export class Live2dSettingsService {
  constructor(private readonly db: YachiyoDatabase) {}

  async getLive2dSettings(): Promise<Live2dSettings> {
    try {
      const record = await this.db.settings.get(LIVE2D_SETTINGS_KEY);
      if (record?.key === LIVE2D_SETTINGS_KEY && typeof record.value === "object" && record.value !== null) {
        const val = record.value as Partial<Live2dSettings>;
        const position: Live2dPosition =
          val.position === "left" || val.position === "right" || val.position === "custom"
            ? val.position
            : defaultLive2dSettings.position;
        const homePosition: Live2dHomePosition =
          val.homePosition === "left" || val.homePosition === "right"
            ? val.homePosition
            : (position === "right" ? "right" : "left");
        let customPosition: Live2dCustomPosition | undefined = undefined;
        if (
          val.customPosition &&
          typeof val.customPosition.x === "number" &&
          Number.isFinite(val.customPosition.x) &&
          typeof val.customPosition.y === "number" &&
          Number.isFinite(val.customPosition.y)
        ) {
          customPosition = {
            x: Math.round(val.customPosition.x),
            y: Math.round(val.customPosition.y),
          };
        }

        const characterIndex =
          typeof val.characterIndex === "number" && val.characterIndex >= 0 && val.characterIndex < 5
            ? Math.floor(val.characterIndex)
            : defaultLive2dSettings.characterIndex;

        const outfitIndex =
          typeof val.outfitIndex === "number" && val.outfitIndex >= 0
            ? Math.floor(val.outfitIndex)
            : defaultLive2dSettings.outfitIndex;

        const scale =
          typeof val.scale === "number" && Number.isFinite(val.scale) && val.scale >= 0.4 && val.scale <= 2.0
            ? Math.round(val.scale * 100) / 100
            : defaultLive2dSettings.scale;

        const opacity =
          typeof val.opacity === "number" && Number.isFinite(val.opacity) && val.opacity >= 0.2 && val.opacity <= 1.0
            ? Math.round(val.opacity * 100) / 100
            : defaultLive2dSettings.opacity;

        return {
          enabled: typeof val.enabled === "boolean" ? val.enabled : defaultLive2dSettings.enabled,
          position,
          homePosition,
          customPosition,
          preload:
            val.preload === "ALL" || val.preload === "IDLE" || val.preload === "NONE"
              ? val.preload
              : defaultLive2dSettings.preload,
          widthLimit:
            typeof val.widthLimit === "number" && val.widthLimit >= 0
              ? val.widthLimit
              : defaultLive2dSettings.widthLimit,
          characterIndex,
          outfitIndex,
          scale,
          opacity,
          aiReactivity: typeof val.aiReactivity === "boolean" ? val.aiReactivity : defaultLive2dSettings.aiReactivity,
          soundEnabled: typeof val.soundEnabled === "boolean" ? val.soundEnabled : defaultLive2dSettings.soundEnabled,
        };
      }
    } catch {
      // 降级回退默认值
    }
    return defaultLive2dSettings;
  }

  async set(settings: Live2dSettings): Promise<void> {
    await this.db.settings.put({
      key: LIVE2D_SETTINGS_KEY,
      value: settings,
    });
  }

  async clear(): Promise<void> {
    await this.db.settings.delete(LIVE2D_SETTINGS_KEY);
  }
}
