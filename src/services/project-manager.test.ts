import { beforeEach, describe, expect, it, vi } from "vitest";
import * as desktopBridge from "./desktop-bridge";
import {
  getProjectDisplayName,
  projectManager,
  STORAGE_ACTIVE_PROJECT,
} from "./project-manager";

describe("project-manager", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("getProjectDisplayName", () => {
    it("returns '无项目' for null, undefined, or empty string", () => {
      expect(getProjectDisplayName(null)).toBe("无项目");
      expect(getProjectDisplayName(undefined)).toBe("无项目");
      expect(getProjectDisplayName("")).toBe("无项目");
      expect(getProjectDisplayName("   ")).toBe("无项目");
    });

    it("extracts folder name from windows and posix paths", () => {
      expect(getProjectDisplayName("D:\\web\\Yachiyo-chat-desktop")).toBe("Yachiyo-chat-desktop");
      expect(getProjectDisplayName("D:/web/Yachiyo-chat-desktop/")).toBe("Yachiyo-chat-desktop");
      expect(getProjectDisplayName("/Users/name/projects/my-cool-app")).toBe("my-cool-app");
    });
  });

  describe("ProjectManager operations", () => {
    it("switches project and persists to storage and recent list", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue(true);

      const success = await projectManager.switchProject("D:\\projects\\demo");
      expect(success).toBe(true);

      const state = projectManager.getState();
      expect(state.activeProject).toBe("D:\\projects\\demo");
      expect(state.recentProjects).toContain("D:\\projects\\demo");
      expect(localStorage.getItem(STORAGE_ACTIVE_PROJECT)).toBe("D:\\projects\\demo");
    });

    it("switches to null for '无项目'", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue(true);

      await projectManager.switchProject(null);
      const state = projectManager.getState();
      expect(state.activeProject).toBeNull();
      expect(localStorage.getItem(STORAGE_ACTIVE_PROJECT)).toBeNull();
    });

    it("picks folder via pickAndOpenProject", async () => {
      vi.spyOn(desktopBridge, "pickDesktopFolder").mockResolvedValue("E:\\workspace\\AliceInCradle");
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue(true);

      const result = await projectManager.pickAndOpenProject("Open workspace");
      expect(result).toBe("E:\\workspace\\AliceInCradle");

      const state = projectManager.getState();
      expect(state.activeProject).toBe("E:\\workspace\\AliceInCradle");
      expect(state.recentProjects[0]).toBe("E:\\workspace\\AliceInCradle");
    });

    it("removes a project from recent list", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue(true);
      await projectManager.switchProject("D:\\a");
      await projectManager.switchProject("D:\\b");

      projectManager.removeRecentProject("D:\\a");
      const state = projectManager.getState();
      expect(state.recentProjects).not.toContain("D:\\a");
      expect(state.recentProjects).toContain("D:\\b");
    });

    it("clears recent projects list via clearRecentProjects()", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue(true);
      await projectManager.switchProject("D:\\a");
      await projectManager.switchProject("D:\\b");

      projectManager.clearRecentProjects();
      const state = projectManager.getState();
      expect(state.recentProjects).toEqual([]);
      expect(localStorage.getItem("yachiyo_recent_projects")).toBeNull();
    });

    it("clears all project state and storage via clear()", async () => {
      const setRootSpy = vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue(true);
      await projectManager.switchProject("D:\\work\\project-1");

      await projectManager.clear();
      const state = projectManager.getState();
      expect(state.activeProject).toBeNull();
      expect(state.recentProjects).toEqual([]);
      expect(localStorage.getItem(STORAGE_ACTIVE_PROJECT)).toBeNull();
      expect(localStorage.getItem("yachiyo_recent_projects")).toBeNull();
      expect(setRootSpy).toHaveBeenCalledWith("");
    });
  });
});
