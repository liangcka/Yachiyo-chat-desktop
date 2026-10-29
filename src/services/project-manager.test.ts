import { beforeEach, describe, expect, it, vi } from "vitest";
import * as desktopBridge from "./desktop-bridge";
import {
  getProjectDisplayName,
  projectManager,
  sameWorkspace,
  STORAGE_ACTIVE_PROJECT,
} from "./project-manager";

/** 模拟原生层校验成功：返回规范路径（测试中即原路径） */
async function acceptWorkspace(path: string): Promise<desktopBridge.WorkspaceSwitchResult> {
  return { ok: true, path: path.trim() || null };
}

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
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);

      const success = await projectManager.switchProject("D:\\projects\\demo");
      expect(success).toBe(true);

      const state = projectManager.getState();
      expect(state.activeProject).toBe("D:\\projects\\demo");
      expect(state.recentProjects).toContain("D:\\projects\\demo");
      expect(localStorage.getItem(STORAGE_ACTIVE_PROJECT)).toBe("D:\\projects\\demo");
    });

    it("switches to null for '无项目'", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);

      await projectManager.switchProject(null);
      const state = projectManager.getState();
      expect(state.activeProject).toBeNull();
      expect(localStorage.getItem(STORAGE_ACTIVE_PROJECT)).toBeNull();
    });

    it("picks folder via pickAndOpenProject", async () => {
      vi.spyOn(desktopBridge, "pickDesktopFolder").mockResolvedValue("E:\\workspace\\AliceInCradle");
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);

      const result = await projectManager.pickAndOpenProject("Open workspace");
      expect(result).toBe("E:\\workspace\\AliceInCradle");

      const state = projectManager.getState();
      expect(state.activeProject).toBe("E:\\workspace\\AliceInCradle");
      expect(state.recentProjects[0]).toBe("E:\\workspace\\AliceInCradle");
    });

    it("removes a project from recent list", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);
      await projectManager.switchProject("D:\\a");
      await projectManager.switchProject("D:\\b");

      projectManager.removeRecentProject("D:\\a");
      const state = projectManager.getState();
      expect(state.recentProjects).not.toContain("D:\\a");
      expect(state.recentProjects).toContain("D:\\b");
    });

    it("clears recent projects list via clearRecentProjects()", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);
      await projectManager.switchProject("D:\\a");
      await projectManager.switchProject("D:\\b");

      projectManager.clearRecentProjects();
      const state = projectManager.getState();
      expect(state.recentProjects).toEqual([]);
      expect(localStorage.getItem("yachiyo_recent_projects")).toBeNull();
    });

    it("原生切换失败时前端项目保持不变并记录失败原因", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);
      await projectManager.switchProject("D:\\work\\alpha");
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue({ ok: false, error: "工作区不可用: 系统找不到指定的路径" });

      const switched = await projectManager.switchProject("D:\\work\\missing");
      expect(switched).toBe(false);
      const state = projectManager.getState();
      expect(state.activeProject).toBe("D:\\work\\alpha");
      expect(state.recentProjects).not.toContain("D:\\work\\missing");
      expect(state.switchError).toMatchObject({ path: "D:\\work\\missing", message: "工作区不可用: 系统找不到指定的路径" });
      expect(localStorage.getItem(STORAGE_ACTIVE_PROJECT)).toBe("D:\\work\\alpha");
    });

    it("以原生层返回的规范路径作为项目身份", async () => {
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockResolvedValue({ ok: true, path: "D:\\Work\\Alpha" });
      await projectManager.switchProject("d:/work/alpha/");
      expect(projectManager.getState().activeProject).toBe("D:\\Work\\Alpha");
      expect(projectManager.getState().switchError).toBeNull();
    });

    it("快速连续切换时较早返回的结果不会覆盖最后一次切换", async () => {
      const pending = new Map<string, (result: desktopBridge.WorkspaceSwitchResult) => void>();
      vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(
        (path) => new Promise((resolve) => { pending.set(path, resolve); }),
      );
      const first = projectManager.switchProject("D:\\work\\alpha");
      const second = projectManager.switchProject("D:\\work\\beta");
      pending.get("D:\\work\\beta")?.({ ok: true, path: "D:\\work\\beta" });
      expect(await second).toBe(true);
      pending.get("D:\\work\\alpha")?.({ ok: true, path: "D:\\work\\alpha" });
      expect(await first).toBe(false);
      expect(projectManager.getState().activeProject).toBe("D:\\work\\beta");
      expect(projectManager.getState().recentProjects).not.toContain("D:\\work\\alpha");
    });

    it("比较项目路径时忽略分隔符、尾部斜杠与大小写", () => {
      expect(sameWorkspace("D:\\Work\\Alpha\\", "d:/work/alpha")).toBe(true);
      expect(sameWorkspace("D:\\work\\alpha", "D:\\work\\beta")).toBe(false);
      expect(sameWorkspace(null, "D:\\work")).toBe(false);
    });

    it("clears all project state and storage via clear()", async () => {
      const setRootSpy = vi.spyOn(desktopBridge, "setDesktopWorkspaceRoot").mockImplementation(acceptWorkspace);
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
