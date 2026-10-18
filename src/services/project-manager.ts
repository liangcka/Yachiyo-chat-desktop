import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "../domain/chat";
import { pickDesktopFolder, setDesktopWorkspaceRoot } from "./desktop-bridge";

export const STORAGE_RECENT_PROJECTS = "yachiyo_recent_projects";
export const STORAGE_ACTIVE_PROJECT = "yachiyo_active_project";

/** 提取路径的项目名称（如 "D:\\web\\my-app" -> "my-app"） */
export function getProjectDisplayName(
  projectPath: string | null | undefined,
  locale: Locale = "zh-CN",
): string {
  if (!projectPath || !projectPath.trim()) {
    return locale === "ja-JP" ? "プロジェクトなし" : "无项目";
  }
  const normalized = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || projectPath;
}

export interface ProjectState {
  activeProject: string | null;
  recentProjects: string[];
}

type ProjectChangeListener = (state: ProjectState) => void;

class ProjectManager {
  private activeProject: string | null = null;
  private recentProjects: string[] = [];
  private listeners = new Set<ProjectChangeListener>();
  private initialized = false;
  private snapshot: ProjectState = { activeProject: null, recentProjects: [] };

  constructor() {
    this.loadFromStorage();
    this.updateSnapshot(false);
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      const storedActive = window.localStorage.getItem(STORAGE_ACTIVE_PROJECT);
      this.activeProject = storedActive ? storedActive : null;

      const storedRecents = window.localStorage.getItem(STORAGE_RECENT_PROJECTS);
      if (storedRecents) {
        const parsed = JSON.parse(storedRecents);
        if (Array.isArray(parsed)) {
          this.recentProjects = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        }
      }
    } catch {
      // 容错降级
    }
  }

  private saveToStorage(): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      if (this.activeProject) {
        window.localStorage.setItem(STORAGE_ACTIVE_PROJECT, this.activeProject);
      } else {
        window.localStorage.removeItem(STORAGE_ACTIVE_PROJECT);
      }
      if (this.recentProjects.length > 0) {
        window.localStorage.setItem(STORAGE_RECENT_PROJECTS, JSON.stringify(this.recentProjects));
      } else {
        window.localStorage.removeItem(STORAGE_RECENT_PROJECTS);
      }
    } catch {
      // 容错
    }
  }

  private updateSnapshot(shouldNotify = true): void {
    this.snapshot = {
      activeProject: this.activeProject,
      recentProjects: [...this.recentProjects],
    };
    this.saveToStorage();
    if (shouldNotify) {
      this.notify();
    }
  }

  private notify(): void {
    const current = this.snapshot;
    this.listeners.forEach((listener) => {
      try {
        listener(current);
      } catch {
        // 防止监听器抛错中断广播
      }
    });
  }

  /** 初始化与后端工作区根目录对齐 */
  public async init(): Promise<ProjectState> {
    if (!this.initialized) {
      this.initialized = true;
      try {
        if (this.activeProject && this.activeProject.trim().length > 0) {
          const success = await setDesktopWorkspaceRoot(this.activeProject);
          if (!success) {
            this.activeProject = null;
            await setDesktopWorkspaceRoot("");
          }
        } else {
          await setDesktopWorkspaceRoot("");
          this.activeProject = null;
        }
      } catch {
        // 容错
      }
      this.updateSnapshot();
    }
    return this.getState();
  }

  /** 清除所有工作区状态（供重置数据/清空全部本地数据时调用） */
  public async clear(): Promise<void> {
    this.activeProject = null;
    this.recentProjects = [];
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_ACTIVE_PROJECT);
        window.localStorage.removeItem(STORAGE_RECENT_PROJECTS);
      } catch {
        // 容错
      }
    }
    this.updateSnapshot();
    try {
      await setDesktopWorkspaceRoot("");
    } catch {
      // 容错
    }
  }

  public getState(): ProjectState {
    return this.snapshot;
  }

  public subscribe(listener: ProjectChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private addRecentProject(path: string): void {
    const clean = path.trim();
    if (!clean) return;
    // 去重并放置在最前面，保留最多 12 个历史项目
    const filtered = this.recentProjects.filter((p) => p.toLowerCase() !== clean.toLowerCase());
    this.recentProjects = [clean, ...filtered].slice(0, 12);
  }

  /** 切换当前项目（设为 null 表示无项目） */
  public async switchProject(projectPath: string | null): Promise<boolean> {
    if (projectPath === null) {
      this.activeProject = null;
      this.updateSnapshot();
      await setDesktopWorkspaceRoot("");
      return true;
    }

    const clean = projectPath.trim();
    if (!clean) {
      return this.switchProject(null);
    }

    const success = await setDesktopWorkspaceRoot(clean);
    this.activeProject = clean;
    this.addRecentProject(clean);
    this.updateSnapshot();
    return success;
  }

  /** 弹出系统原生文件夹选择器 (Open workspace) 并切换到所选目录 */
  public async pickAndOpenProject(title = "Open workspace"): Promise<string | undefined> {
    const picked = await pickDesktopFolder(title);
    if (picked && picked.trim().length > 0) {
      await this.switchProject(picked);
      return picked;
    }
    return undefined;
  }

  /** 移除最近项目历史 */
  public removeRecentProject(projectPath: string): void {
    this.recentProjects = this.recentProjects.filter((p) => p.toLowerCase() !== projectPath.toLowerCase());
    this.updateSnapshot();
  }

  /** 清空所有历史项目记录 */
  public clearRecentProjects(): void {
    this.recentProjects = [];
    this.updateSnapshot();
  }

  /** 快速开始 */
  public async quickStart(defaultFolder?: string): Promise<string | undefined> {
    if (defaultFolder) {
      await this.switchProject(defaultFolder);
      return defaultFolder;
    }
    // 若未指定目录，尝试调起原生选择器
    return await this.pickAndOpenProject("Open workspace");
  }
}

export const projectManager = new ProjectManager();

export function useProjectState(): ProjectState {
  useEffect(() => {
    void projectManager.init();
  }, []);

  return useSyncExternalStore(
    (callback) => projectManager.subscribe(callback),
    () => projectManager.getState(),
    () => projectManager.getState(),
  );
}
