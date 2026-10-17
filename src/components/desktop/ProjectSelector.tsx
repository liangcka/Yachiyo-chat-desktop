import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Folder, FolderCode, FolderPlus, FolderX, Settings, X } from "lucide-react";
import {
  getProjectDisplayName,
  projectManager,
  useProjectState,
} from "../../services/project-manager";

export interface ProjectSelectorProps {
  /** 触发样式变体：'composer' (对话框上方项目切换器), 'chip' (胶囊标签), 'new-chat' (旧版侧栏新建对话), 'header' (顶栏), 'sidebar' (侧边栏), 'rail' (紧凑栏), 'workspace' (工作区单行面板) */
  variant?: "composer" | "chip" | "new-chat" | "header" | "sidebar" | "rail" | "workspace";
  label?: string;
  className?: string;
  changeLabel?: string;
  selectLabel?: string;
  noProjectLabel?: string;
  /** 选择项目后的回调 */
  onSelectProject?: (path: string | null) => void;
  /** 点击项目齿轮或设置 */
  onOpenSettings?: () => void;
  /** 新建对话回调 */
  onNewChat?: () => Promise<void> | void;
}


export function ProjectSelector({
  variant = "new-chat",
  label,
  className = "",
  changeLabel,
  selectLabel,
  noProjectLabel,
  onSelectProject,
  onOpenSettings,
  onNewChat,
}: ProjectSelectorProps) {
  const { activeProject, recentProjects } = useProjectState();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭下拉面板
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  const handleSelectProject = async (path: string) => {
    setIsOpen(false);
    await projectManager.switchProject(path);
    onSelectProject?.(path);
    if (onNewChat) {
      await onNewChat();
    }
  };

  const handleSelectNoProject = async () => {
    setIsOpen(false);
    await projectManager.switchProject(null);
    onSelectProject?.(null);
    if (onNewChat) {
      await onNewChat();
    }
  };

  const handleNewProject = async () => {
    setIsOpen(false);
    // 弹出原生 Windows "Open workspace" 文件夹选择器（对标第二张图）
    const picked = await projectManager.pickAndOpenProject("Open workspace");
    if (picked) {
      onSelectProject?.(picked);
      if (onNewChat) {
        await onNewChat();
      }
    }
  };

  const handleQuickStart = async () => {
    setIsOpen(false);
    const picked = await projectManager.quickStart();
    if (picked) {
      onSelectProject?.(picked);
      if (onNewChat) {
        await onNewChat();
      }
    }
  };

  const handleGearClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onOpenSettings?.();
  };

  const activeDisplayName = getProjectDisplayName(activeProject);
  const buttonLabel = label ?? (variant === "chip" || variant === "composer" ? activeDisplayName : "新建对话");

  const displayProjects = useMemo(() => {
    if (!activeProject) return recentProjects;
    const exists = recentProjects.some(
      (p) => p.toLowerCase() === activeProject.toLowerCase(),
    );
    return exists ? recentProjects : [activeProject, ...recentProjects];
  }, [activeProject, recentProjects]);

  return (
    <div
      ref={containerRef}
      className={`project-selector project-selector--${variant} ${className}`}
      data-testid="project-selector"
    >
      {/* 触发按钮 */}
      {variant === "workspace" ? (
        <div className="workspace-panel__project-row">
          <div className="workspace-panel__project-info">
            <Folder size={14} className="workspace-panel__project-icon" />
            <span
              className="workspace-panel__project-name"
              title={activeProject ?? ""}
            >
              {activeProject ? activeDisplayName : (noProjectLabel ?? "未选择项目")}
            </span>
          </div>
          <button
            type="button"
            className="workspace-panel__project-btn"
            onClick={handleToggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
          >
            {activeProject ? (changeLabel ?? "更换") : (selectLabel ?? "选择项目")}
          </button>
        </div>
      ) : variant === "rail" ? (
        <button
          type="button"
          className="desktop-sidebar__rail-btn"
          onClick={handleToggle}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="工作区项目"
          title={`工作区项目：${activeDisplayName}`}
        >
          <FolderCode size={17} />
        </button>
      ) : variant === "composer" || variant === "chip" || variant === "sidebar" ? (
        <button
          type="button"
          className={
            variant === "composer" || variant === "sidebar"
              ? `project-selector__composer-trigger ${isOpen ? "project-selector__composer-trigger--open" : ""}`
              : "desktop-context-chip project-selector__chip-trigger"
          }
          onClick={handleToggle}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title={`当前项目：${activeDisplayName} (点击切换或新建项目)`}
        >

          {activeProject ? (
            <Folder size={variant === "composer" ? 14 : 13} className="project-selector__trigger-icon" />
          ) : (
            <FolderX size={variant === "composer" ? 14 : 13} className="project-selector__trigger-icon" />
          )}
          <span className="project-selector__trigger-text">{activeDisplayName}</span>
          <ChevronDown
            size={variant === "composer" ? 12 : 11}
            className={`project-selector__caret ${isOpen ? "project-selector__caret--open" : ""}`}
          />
        </button>
      ) : (
        <div className="project-selector__pill">
          <button
            type="button"
            className="desktop-sidebar__new-btn project-selector__main-btn"
            onClick={() => void onNewChat?.()}
            title="新建对话 (Ctrl+N)"
          >
            <span className="desktop-sidebar__new-btn-label">{buttonLabel}</span>
          </button>
          <button
            type="button"
            className="project-selector__caret-btn"
            onClick={handleToggle}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            title="项目选择与新建项目"
            aria-label="项目选择与新建项目"
          >
            <ChevronDown
              size={13}
              className={`project-selector__caret ${isOpen ? "project-selector__caret--open" : ""}`}
            />
          </button>
        </div>
      )}

      {/* 下拉菜单面板（完全对标图片样式与结构） */}
      {isOpen ? (
        <div className="project-dropdown" role="menu" aria-label="项目选择菜单">
          {/* 1. 最近项目列表 */}
          <div className="project-dropdown__section project-dropdown__section--recents">
            {displayProjects.map((projectPath) => {
              const isActive = activeProject?.toLowerCase() === projectPath.toLowerCase();
              const name = getProjectDisplayName(projectPath);

              return (
                <div
                  key={projectPath}
                  className={`project-dropdown__item ${isActive ? "project-dropdown__item--active" : ""}`}
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => void handleSelectProject(projectPath)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleSelectProject(projectPath);
                    }
                  }}
                >
                  <Folder size={15} className="project-dropdown__icon" />
                  <span className="project-dropdown__name" title={projectPath}>
                    {name}
                  </span>
                  <div className="project-dropdown__active-actions">
                      {isActive && onOpenSettings ? <button
                        type="button"
                        className="project-dropdown__action-icon"
                        onClick={handleGearClick}
                        title="打开文件与终端"
                        aria-label="打开文件与终端"
                      >
                        <Settings size={14} />
                      </button> : null}
                      {isActive ? <Check size={14} className="project-dropdown__check" /> : null}
                      <button
                        type="button"
                        className="project-dropdown__action-icon"
                        onClick={(event) => {
                          event.stopPropagation();
                          projectManager.removeRecentProject(projectPath);
                        }}
                        title="从最近项目中移除"
                        aria-label={`从最近项目中移除 ${name}`}
                      >
                        <X size={13} />
                      </button>
                  </div>
                </div>
              );
            })}
          </div>


          {/* 分隔线 1 */}
          <div className="project-dropdown__divider" />

          {/* 2. 操作组：新建项目（对标图片 2） + 快速开始 */}
          <div className="project-dropdown__section project-dropdown__section--actions">
            <button
              type="button"
              className="project-dropdown__item"
              role="menuitem"
              onClick={() => void handleNewProject()}
            >
              <FolderPlus size={15} className="project-dropdown__icon" />
              <span className="project-dropdown__name">新建项目</span>
            </button>

            <button
              type="button"
              className="project-dropdown__item"
              role="menuitem"
              onClick={() => void handleQuickStart()}
            >
              <FolderPlus size={15} className="project-dropdown__icon" />
              <span className="project-dropdown__name">快速开始</span>
            </button>
          </div>

          {/* 分隔线 2 */}
          <div className="project-dropdown__divider" />

          {/* 3. 无项目选项 */}
          <div className="project-dropdown__section project-dropdown__section--empty">
            {recentProjects.length > 0 ? (
              <button type="button" className="project-dropdown__item" role="menuitem" onClick={() => projectManager.clearRecentProjects()}>
                <X size={15} className="project-dropdown__icon" />
                <span className="project-dropdown__name">清空最近项目</span>
              </button>
            ) : null}
            <button
              type="button"
              className={`project-dropdown__item ${!activeProject ? "project-dropdown__item--active" : ""}`}
              role="menuitem"
              onClick={() => void handleSelectNoProject()}
            >
              <FolderX size={15} className="project-dropdown__icon" />
              <span className="project-dropdown__name">无项目</span>
              {!activeProject ? (
                <Check size={14} className="project-dropdown__check" />
              ) : null}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
