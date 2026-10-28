import { useCallback, useState } from "react";
import { useLocale } from "../../i18n/locale-context";
import { ChevronRight, FolderGit2, GitCompareArrows, Play, RefreshCw } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { executeDesktopAgentTool } from "../../services/desktop-bridge";
import { useProjectState } from "../../services/project-manager";
import { CheckpointPanel } from "./CheckpointPanel";
import { FileTree } from "./FileTree";
import { ProjectSelector } from "./ProjectSelector";

export interface WorkspacePanelProps {
  copy?: UiCopy;
  open?: boolean;
  onClose?: () => void;
  /** 点击文件树文件：交由上层在编辑器中打开（切到编辑器视图） */
  onOpenFile?: (path: string) => void;
  /** @ 引用文件到对话输入框 */
  onReferenceFile?: (path: string) => void;
  /** 打开 diff 审阅（编辑器视图的变更审阅 tab） */
  onOpenReview?: () => void;
  isAgentRunning?: boolean;
  onCheckpointRestored?: () => void;
}

export function WorkspacePanel({
  copy,
  onOpenFile,
  onReferenceFile,
  onOpenReview,
  isAgentRunning = false,
  onCheckpointRestored,
}: WorkspacePanelProps) {
  const ja = useLocale() === "ja-JP";
  const { activeProject } = useProjectState();
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  /** 递增以强制 FileTree 全树重载 */
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [checkpointRefreshKey, setCheckpointRefreshKey] = useState(0);

  const [isTreeOpen, setIsTreeOpen] = useState(true);
  const [isCheckpointsOpen, setIsCheckpointsOpen] = useState(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);

  const refreshWorkspace = useCallback(() => {
    setTreeRefreshKey((key) => key + 1);
  }, []);

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || isLoading || isAgentRunning) return;

    const cmd = commandInput.trim();
    setCommandInput("");
    setIsLoading(true);
    setTerminalOutput((prev) => `${prev}\n$ ${cmd}\n`);

    const res = await executeDesktopAgentTool("run_command", { command: cmd }, activeProject);
    setTerminalOutput((prev) => `${prev}${res.output}\n`);
    setIsLoading(false);
    refreshWorkspace();
  };

  const handleGitStatus = async () => {
    setIsLoading(true);
    setTerminalOutput((prev) => `${prev}\n$ git status --short\n`);
    const res = await executeDesktopAgentTool("git_status", {}, activeProject);
    setTerminalOutput((prev) => `${prev}${res.output}\n`);
    setIsLoading(false);
  };

  const handleOpenFile = useCallback(
    (path: string) => {
      onOpenFile?.(path);
    },
    [onOpenFile],
  );

  const handleReferenceFile = useCallback(
    (path: string) => {
      onReferenceFile?.(path);
    },
    [onReferenceFile],
  );

  return (
    <div className="workspace-panel">
      {/* 1. 项目路径展示与更换栏 */}
      <div className="workspace-panel__project-container">
        <ProjectSelector
          variant="workspace"
          onSelectProject={() => refreshWorkspace()}
          changeLabel={copy?.changeProject}
          selectLabel={copy?.selectProject}
          noProjectLabel={copy?.noProjectSelected}
        />
      </div>

      {/* 2. 可折叠分区：文件树 */}
      <div className="workspace-panel__collapsible">
        <div className="workspace-panel__section-header">
          <button
            type="button"
            className="workspace-panel__section-toggle"
            aria-expanded={isTreeOpen}
            onClick={() => setIsTreeOpen((prev) => !prev)}
          >
            <ChevronRight
              size={12}
              className={`workspace-panel__section-chevron ${
                isTreeOpen ? "workspace-panel__section-chevron--open" : ""
              }`}
            />
            <span className="workspace-panel__section-title">
              {copy?.fileTreeTitle ?? "文件树"}
            </span>
          </button>
          <div className="workspace-panel__section-actions">
            <button
              type="button"
              className="workspace-panel__btn workspace-panel__btn--icon"
              onClick={refreshWorkspace}
              title={copy?.refreshFileTree ?? "刷新文件树"}
              disabled={isLoading}
              aria-label={copy?.refreshFileTree ?? "刷新文件树"}
            >
              <RefreshCw
                size={12}
                className={isLoading ? "workspace-panel__spin" : ""}
              />
            </button>
          </div>
        </div>

        {isTreeOpen ? (
          <div className="workspace-panel__section workspace-panel__section--tree">
            {/* key 递增 = 全树重挂载：缓存、展开态与加载进度一并重置 */}
            {activeProject !== null ? (
              <FileTree
                key={`${activeProject}:${treeRefreshKey}`}
                workspace={activeProject}
                copy={copy}
                onOpenFile={handleOpenFile}
                onReferenceFile={onReferenceFile ? handleReferenceFile : undefined}
              />
            ) : (
              <p className="file-tree__empty">{copy?.noProjectSelected ?? (ja ? "プロジェクト未選択" : "未选择项目")}</p>
            )}
          </div>
        ) : null}
      </div>

      {/* 3. 可折叠分区：检查点 */}
      <div className="workspace-panel__collapsible">
        <div className="workspace-panel__section-header">
          <button
            type="button"
            className="workspace-panel__section-toggle"
            aria-expanded={isCheckpointsOpen}
            onClick={() => setIsCheckpointsOpen((prev) => !prev)}
          >
            <ChevronRight
              size={12}
              className={`workspace-panel__section-chevron ${
                isCheckpointsOpen ? "workspace-panel__section-chevron--open" : ""
              }`}
            />
            <span className="workspace-panel__section-title">
              {copy?.checkpointsTitle ?? "检查点"}
            </span>
          </button>
          <div className="workspace-panel__section-actions">
            <button
              type="button"
              className="workspace-panel__btn workspace-panel__btn--icon"
              aria-label={ja ? "チェックポイントを更新" : "刷新检查点"}
              title={ja ? "チェックポイントを更新" : "刷新检查点"}
              onClick={() => setCheckpointRefreshKey((k) => k + 1)}
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {isCheckpointsOpen ? (
          <CheckpointPanel
            hideHeader={true}
            externalRefreshKey={checkpointRefreshKey}
            isRunning={isAgentRunning || isLoading}
            onRestored={() => {
              refreshWorkspace();
              onCheckpointRestored?.();
            }}
          />
        ) : null}
      </div>

      {/* 4. 可折叠分区：终端 */}
      <div className="workspace-panel__collapsible">
        <div className="workspace-panel__section-header">
          <button
            type="button"
            className="workspace-panel__section-toggle"
            aria-expanded={isTerminalOpen}
            onClick={() => setIsTerminalOpen((prev) => !prev)}
          >
            <ChevronRight
              size={12}
              className={`workspace-panel__section-chevron ${
                isTerminalOpen ? "workspace-panel__section-chevron--open" : ""
              }`}
            />
            <span className="workspace-panel__section-title">
              {copy?.terminalTitle ?? "终端"}
            </span>
          </button>
          <div className="workspace-panel__section-actions">
            <button
              type="button"
              className="workspace-panel__btn workspace-panel__btn--xs"
              onClick={() => void handleGitStatus()}
            >
              <FolderGit2 size={12} /> Status
            </button>
            {onOpenReview ? (
              <button
                type="button"
                className="workspace-panel__btn workspace-panel__btn--xs"
                onClick={onOpenReview}
                title={copy?.reviewTitle ?? "打开 diff 审阅"}
              >
                <GitCompareArrows size={12} /> {copy?.reviewEntryButton ?? "审阅"}
              </button>
            ) : null}
          </div>
        </div>

        {isTerminalOpen ? (
          <div className="workspace-panel__section workspace-panel__section--terminal">
            <pre className="workspace-panel__terminal-output">
              {terminalOutput ||
                (ja
                  ? "準備完了。下にコマンドを入力するか、八千代に実行を任せてください。"
                  : "就绪。可在下方输入命令或由八千代自动执行。")}
            </pre>

            <form onSubmit={handleRunCommand} className="workspace-panel__cmd-form">
              <input
                type="text"
                className="workspace-panel__input workspace-panel__cmd-input"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder={ja ? "ターミナルコマンドを入力 (例: npm test)…" : "输入终端命令 (如 npm test)..."}
                disabled={isLoading || isAgentRunning}
              />
              <button
                type="submit"
                className="workspace-panel__btn workspace-panel__btn--send"
                disabled={isLoading || isAgentRunning || !commandInput.trim()}
                title={ja ? "コマンドを実行" : "执行命令"}
                aria-label={ja ? "コマンドを実行" : "执行命令"}
              >
                <Play size={12} />
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
