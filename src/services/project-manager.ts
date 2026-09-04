import { useEffect, useState } from "react";
import { getDesktopWorkspaceRoot, pickDesktopFolder, setDesktopWorkspaceRoot } from "./desktop-bridge";

export const STORAGE_RECENT_PROJECTS = "yachiyo_recent_projects";
export const STORAGE_ACTIVE_PROJECT = "yachiyo_active_project";

/** 提取路径的项目名称（如 "D:\\web\\my-app" -> "my-app"） */
export function getProjectDisplayName(projectPath: string | null | undefined): string {
  if (!projectPath || !projectPath.trim()) {
    return "无项目";
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

  constructor() {
    this.loadFromStorage();
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
      window.localStorage.setItem(STORAGE_RECENT_PROJECTS, JSON.stringify(this.recentProjects));
    } catch {
      // 容错
    }
  }

  private notify(): void {
    const state: ProjectState = {
      activeProject: this.activeProject,
      recentProjects: [...this.recentProjects],
    };
    this.listeners.forEach((listener) => {
      try {
        listener(state);
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
        const root = await getDesktopWorkspaceRoot();
        if (root && root.trim().length > 0) {
          this.activeProject = root;
          this.addRecentProject(root);
        } else if (this.activeProject) {
          await setDesktopWorkspaceRoot(this.activeProject);
        }
      } catch {
        // 容错
      }
      this.saveToStorage();
      this.notify();
    }
    return this.getState();
  }

  public getState(): ProjectState {
    return {
      activeProject: this.activeProject,
      recentProjects: [...this.recentProjects],
    };
  }

  public subscribe(listener: ProjectChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
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
      await setDesktopWorkspaceRoot("");
      this.saveToStorage();
      this.notify();
      return true;
    }

    const clean = projectPath.trim();
    if (!clean) {
      return this.switchProject(null);
    }

    const success = await setDesktopWorkspaceRoot(clean);
    this.activeProject = clean;
    this.addRecentProject(clean);
    this.saveToStorage();
    this.notify();
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
    this.saveToStorage();
    this.notify();
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
  const [state, setState] = useState<ProjectState>(() => projectManager.getState());

  useEffect(() => {
    void projectManager.init();
    return projectManager.subscribe(setState);
  }, []);

  return state;
}
