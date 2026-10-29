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

/** 比较两个项目路径是否指向同一项目：统一分隔符与尾部斜杠，按不区分大小写比较（与最近项目去重一致） */
export function sameWorkspace(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const normalize = (path: string) => path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

export interface ProjectSwitchError {
  path: string;
  message: string;
  /** 递增序号，供界面区分两次相同路径的失败 */
  sequence: number;
}

export interface ProjectState {
  activeProject: string | null;
  recentProjects: string[];
  /** 最近一次原生切换失败；成功切换后清空 */
  switchError: ProjectSwitchError | null;
}

type ProjectChangeListener = (state: ProjectState) => void;

class ProjectManager {
  private activeProject: string | null = null;
  private recentProjects: string[] = [];
  private switchError: ProjectSwitchError | null = null;
  private listeners = new Set<ProjectChangeListener>();
  private initialized = false;
  /** 每次切换递增；异步返回时只有最新一次切换可以落地，较早的结果直接丢弃 */
  private switchSequence = 0;
  private snapshot: ProjectState = { activeProject: null, recentProjects: [], switchError: null };

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
      switchError: this.switchError,
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

  /** 启动时按上次的项目重新做一次原生切换；用户或会话已经发起过切换时以那次为准 */
  public async init(): Promise<ProjectState> {
    if (!this.initialized) {
      this.initialized = true;
      if (this.switchSequence === 0) {
        const restored = this.activeProject;
        const switched = await this.switchProject(restored);
        // 上次的目录已不可用：回到无项目状态，不保留一个原生层不认可的项目
        if (!switched && restored !== null && this.isLatestSwitch(1)) await this.switchProject(null);
      }
    }
    return this.getState();
  }

  /** 清除所有工作区状态（供重置数据/清空全部本地数据时调用） */
  public async clear(): Promise<void> {
    this.switchSequence += 1;
    this.activeProject = null;
    this.recentProjects = [];
    this.switchError = null;
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

  private isLatestSwitch(sequence: number): boolean {
    return this.switchSequence === sequence;
  }

  /**
   * 切换当前项目（null 表示无项目）。原生层校验成功后才更新前端状态，项目身份取原生层返回的规范路径；
   * 快速连续切换时只有最后一次生效。返回 false 表示切换失败或已被更新的切换取代。
   */
  public async switchProject(projectPath: string | null): Promise<boolean> {
    const sequence = ++this.switchSequence;
    const requested = projectPath?.trim() ?? "";
    const result = await setDesktopWorkspaceRoot(requested);
    if (!this.isLatestSwitch(sequence)) return false;
    if (!result.ok) {
      this.switchError = { path: requested, message: result.error, sequence };
      this.updateSnapshot();
      return false;
    }
    this.activeProject = result.path;
    this.switchError = null;
    if (result.path !== null) this.addRecentProject(result.path);
    this.updateSnapshot();
    return true;
  }

  /** 弹出系统原生文件夹选择器 (Open workspace) 并切换到所选目录 */
  public async pickAndOpenProject(title = "Open workspace"): Promise<string | undefined> {
    const picked = await pickDesktopFolder(title);
    if (picked && picked.trim().length > 0 && (await this.switchProject(picked))) {
      return this.activeProject ?? undefined;
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
      return (await this.switchProject(defaultFolder)) ? this.activeProject ?? undefined : undefined;
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
