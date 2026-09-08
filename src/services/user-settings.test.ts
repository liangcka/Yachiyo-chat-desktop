import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_USER_SETTINGS,
  getLocalUserSettings,
  resetLocalUserSettings,
  saveLocalUserSettings,
} from "./user-settings";

describe("user-settings 本地用户设置服务", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("默认情况下具有默认用户名和默认Lite称号，头像为空", () => {
    const settings = getLocalUserSettings();
    expect(settings.username).toBe(DEFAULT_USER_SETTINGS.username);
    expect(settings.avatar).toBe("");
    expect(settings.badge).toBe("Lite");
  });

  it("能够将自定义用户名、头像和称号保存到 localStorage", () => {
    const saved = saveLocalUserSettings({
      username: "  彩叶酱  ",
      avatar: "data:image/jpeg;base64,mockavatar",
      badge: "Pro",
    });
    expect(saved.username).toBe("彩叶酱");
    expect(saved.avatar).toBe("data:image/jpeg;base64,mockavatar");
    expect(saved.badge).toBe("Pro");

    const retrieved = getLocalUserSettings();
    expect(retrieved.username).toBe("彩叶酱");
    expect(retrieved.avatar).toBe("data:image/jpeg;base64,mockavatar");
    expect(retrieved.badge).toBe("Pro");
  });

  it("当保存空用户名或空称号时自动回退为默认值", () => {
    saveLocalUserSettings({ username: "   ", badge: "   " });
    const current = getLocalUserSettings();
    expect(current.username).toBe(DEFAULT_USER_SETTINGS.username);
    expect(current.badge).toBe(DEFAULT_USER_SETTINGS.badge);
  });

  it("能够重置用户设置为默认状态", () => {
    saveLocalUserSettings({ username: "测试用户", avatar: "data:...", badge: "Go" });
    expect(getLocalUserSettings().username).toBe("测试用户");
    expect(getLocalUserSettings().badge).toBe("Go");

    resetLocalUserSettings();
    const current = getLocalUserSettings();
    expect(current.username).toBe(DEFAULT_USER_SETTINGS.username);
    expect(current.avatar).toBe("");
    expect(current.badge).toBe("Lite");
  });
});
