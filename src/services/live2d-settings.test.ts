import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YachiyoDatabase } from "../data/db";
import {
  Live2dSettingsService,
  defaultLive2dSettings,
  type Live2dSettings,
} from "./live2d-settings";

describe("Live2dSettingsService", () => {
  let db: YachiyoDatabase;
  let service: Live2dSettingsService;

  beforeEach(() => {
    db = new YachiyoDatabase(`yachiyo-live2d-test-${crypto.randomUUID()}`);
    service = new Live2dSettingsService(db);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("returns default settings when nothing is stored", async () => {
    const settings = await service.getLive2dSettings();
    expect(settings).toEqual(defaultLive2dSettings);
  });

  it("saves and retrieves settings correctly", async () => {
    const customSettings: Live2dSettings = {
      enabled: false,
      position: "custom",
      homePosition: "right",
      customPosition: { x: 120, y: 340 },
      preload: "ALL",
      widthLimit: 800,
      characterIndex: 2,
      outfitIndex: 3,
      scale: 1.2,
      opacity: 0.85,
      aiReactivity: false,
      soundEnabled: true,
    };

    await service.set(customSettings);
    const retrieved = await service.getLive2dSettings();
    expect(retrieved).toEqual(customSettings);
  });

  it("falls back gracefully when partial or invalid values are stored", async () => {
    await db.settings.put({
      key: "live2dSettings",
      value: {
        enabled: "not-a-bool",
        position: "middle",
        homePosition: "center",
        customPosition: { x: "invalid", y: NaN },
        preload: "INVALID",
        widthLimit: -10,
        characterIndex: 99,
        outfitIndex: -1,
        scale: 999,
        opacity: -5,
        aiReactivity: "yes",
      },
    } as never);

    const retrieved = await service.getLive2dSettings();
    expect(retrieved).toEqual(defaultLive2dSettings);
  });

  it("clears stored settings", async () => {
    await service.set({
      enabled: false,
      position: "right",
      homePosition: "right",
      customPosition: undefined,
      preload: "NONE",
      widthLimit: 768,
      characterIndex: 1,
      outfitIndex: 2,
      scale: 0.8,
      opacity: 0.9,
      aiReactivity: true,
      soundEnabled: false,
    });

    await service.clear();
    const retrieved = await service.getLive2dSettings();
    expect(retrieved).toEqual(defaultLive2dSettings);
  });
});
