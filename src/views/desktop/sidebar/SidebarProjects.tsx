import { Folder, FolderOpen, FolderPlus, PanelRight, X } from "lucide-react";
import type { Locale } from "../../../domain/chat";
import {
  getProjectDisplayName,
  projectManager,
  useProjectState,
} from "../../../services/project-manager";

interface SidebarProjectsProps {
  locale: Locale;
  onNewChat: () => Promise<void>;
  onOpenWorkspace?: () => void;
}

/** 最近项目列表：点击切换工作区并开启新对话，当前项目可直接打开文件与终端面板。 */
export function SidebarProjects({ locale, onNewChat, onOpenWorkspace }: SidebarProjectsProps) {
  const ja = locale === "ja-JP";
  const { activeProject, recentProjects } = useProjectState();
  const openLabel = ja ? "フォルダーを開く" : "打开文件夹";

  const handleSelect = async (path: string) => {
    if (path === activeProject) return;
    if (await projectManager.switchProject(path)) await onNewChat();
  };

  return (
    <section className="desktop-sidebar__section" aria-label={ja ? "プロジェクト" : "项目"}>
      <div className="desktop-sidebar__section-header">
        <span className="desktop-sidebar__section-label">{ja ? "プロジェクト" : "项目"}</span>
        {/* 空列表时下方占位按钮已是同一入口，标题栏不再重复 */}
        {recentProjects.length > 0 ? (
          <button
            type="button"
            className="desktop-sidebar__section-action"
            onClick={() => void projectManager.pickAndOpenProject(openLabel)}
            title={openLabel}
            aria-label={openLabel}
          >
            <FolderPlus size={14} />
          </button>
        ) : null}
      </div>
      {recentProjects.length === 0 ? (
        <button
          type="button"
          className="desktop-sidebar__project desktop-sidebar__project--placeholder"
          onClick={() => void projectManager.pickAndOpenProject(openLabel)}
        >
          <FolderPlus size={14} className="desktop-sidebar__project-icon" aria-hidden="true" />
          <span className="desktop-sidebar__project-name">{openLabel}</span>
        </button>
      ) : (
        <div className="desktop-sidebar__project-list" role="list">
          {recentProjects.map((path) => {
            const active = path === activeProject;
            const name = getProjectDisplayName(path, locale);
            return (
              <div
                key={path}
                role="listitem"
                className={`desktop-sidebar__project ${active ? "desktop-sidebar__project--active" : ""}`}
              >
                <button
                  type="button"
                  className="desktop-sidebar__project-main"
                  onClick={() => void handleSelect(path)}
                  title={ja ? `現在のプロジェクト：${name}\n${path}` : `${active ? "当前项目" : "切换到项目"}：${name}\n${path}`}
                  aria-current={active ? "true" : undefined}
                >
                  {active
                    ? <FolderOpen size={14} className="desktop-sidebar__project-icon" aria-hidden="true" />
                    : <Folder size={14} className="desktop-sidebar__project-icon" aria-hidden="true" />}
                  <span className="desktop-sidebar__project-name">{name}</span>
                </button>
                <div className="desktop-sidebar__history-actions">
                  {active && onOpenWorkspace ? (
                    <button
                      type="button"
                      className="desktop-sidebar__history-action"
                      onClick={onOpenWorkspace}
                      title={ja ? "ファイルとターミナルを開く" : "打开文件与终端"}
                      aria-label={ja ? "ファイルとターミナルを開く" : "打开文件与终端"}
                    >
                      <PanelRight size={13} />
                    </button>
                  ) : null}
                  {active ? (
                    <button
                      type="button"
                      className="desktop-sidebar__history-action"
                      onClick={() => void projectManager.switchProject(null).then((switched) => (switched ? onNewChat() : undefined))}
                      title={ja ? "プロジェクトを閉じる" : "关闭项目"}
                      aria-label={ja ? "プロジェクトを閉じる" : "关闭项目"}
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="desktop-sidebar__history-action"
                      onClick={() => projectManager.removeRecentProject(path)}
                      title={ja ? "履歴から削除" : "从列表移除"}
                      aria-label={ja ? `${name} を履歴から削除` : `从列表移除 ${name}`}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
