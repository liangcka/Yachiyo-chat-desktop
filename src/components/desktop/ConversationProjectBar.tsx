import { Folder, FolderPlus, Link2 } from "lucide-react";
import type { Locale, WorkspaceBinding } from "../../domain/chat";
import { getProjectDisplayName } from "../../services/project-manager";

export interface ConversationProjectBarProps {
  locale: Locale;
  binding: WorkspaceBinding;
  /** 界面当前选中的项目，供未绑定任务一键绑定 */
  activeProject: string | null;
  /** 运行中或发送中不允许改变归属 */
  disabled?: boolean;
  onBind: (workspace: string) => void;
  onPickAndBind: () => void;
}

/**
 * 已有任务的项目归属：已绑定时只读展示，未绑定时说明后果并提供绑定入口。
 * 空白任务不使用本组件，由项目选择器决定首次提交时绑定的项目。
 */
export function ConversationProjectBar({ locale, binding, activeProject, disabled = false, onBind, onPickAndBind }: ConversationProjectBarProps) {
  const ja = locale === "ja-JP";
  if (binding.kind === "pending") return null;

  if (binding.kind === "bound") {
    const name = getProjectDisplayName(binding.workspace, locale);
    return (
      <div className="conversation-project-bar" role="status">
        <span className="conversation-project-bar__chip" title={binding.workspace}>
          <Folder size={12} aria-hidden="true" />
          <span>{name}</span>
        </span>
      </div>
    );
  }

  const activeName = activeProject !== null ? getProjectDisplayName(activeProject, locale) : null;
  return (
    <div className="conversation-project-bar conversation-project-bar--unbound" role="status">
      <span className="conversation-project-bar__chip conversation-project-bar__chip--unbound">
        <Folder size={12} aria-hidden="true" />
        <span>{ja ? "プロジェクト未紐付け" : "未绑定项目"}</span>
      </span>
      <span className="conversation-project-bar__hint">
        {binding.kind === "legacy"
          ? ja ? "以前の会話です。プロジェクトのファイルを扱うには紐付けてください。" : "这是较早的对话，没有项目记录；需要读写项目文件时请先绑定。"
          : ja ? "このタスクは一時プロジェクトで作業し、デスクトップなどのファイルも確認の上で読み書きできます。" : "本任务在临时项目中工作，也可以在确认后读写桌面等位置的文件。"}
      </span>
      {activeProject !== null && activeName !== null ? (
        <button
          type="button"
          className="conversation-project-bar__action"
          disabled={disabled}
          onClick={() => onBind(activeProject)}
          title={activeProject}
        >
          <Link2 size={12} aria-hidden="true" />
          {ja ? `${activeName} に紐付け` : `绑定到 ${activeName}`}
        </button>
      ) : null}
      <button type="button" className="conversation-project-bar__action" disabled={disabled} onClick={onPickAndBind}>
        <FolderPlus size={12} aria-hidden="true" />
        {ja ? "フォルダーを選択" : "选择文件夹"}
      </button>
    </div>
  );
}
