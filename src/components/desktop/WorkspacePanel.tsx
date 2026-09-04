import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, FolderGit2, FolderPlus, GitCompareArrows, Play, RefreshCw, Terminal, X } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { executeDesktopAgentTool, getDesktopWorkspaceRoot } from "../../services/desktop-bridge";
import { projectManager } from "../../services/project-manager";
import { FileTree } from "./FileTree";

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
}

export function WorkspacePanel({ copy, open = true, onClose, onOpenFile, onReferenceFile, onOpenReview }: WorkspacePanelProps) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  /** 递增以强制 FileTree 全树重载 */
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        void getDesktopWorkspaceRoot().then((root) => {
          if (root) setWorkspaceRoot(root);
        });
      });
      closeRef.current?.focus();
    }
  }, [open]);

  const refreshWorkspace = useCallback(() => {
    setTreeRefreshKey((key) => key + 1);
  }, []);

  const handleSetRoot = async () => {
    if (!workspaceRoot) return;
    const success = await projectManager.switchProject(workspaceRoot);
    if (success) {
      refreshWorkspace();
    }
  };

  const handlePickFolder = async () => {
    const picked = await projectManager.pickAndOpenProject("Open workspace");
    if (picked) {
      setWorkspaceRoot(picked);
      refreshWorkspace();
    }
  };

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || isLoading) return;

    const cmd = commandInput.trim();
    setCommandInput("");
    setIsLoading(true);
    setTerminalOutput((prev) => `${prev}\n$ ${cmd}\n`);

    const res = await executeDesktopAgentTool("run_command", { command: cmd });
    setTerminalOutput((prev) => `${prev}${res.output}\n`);
    setIsLoading(false);
    refreshWorkspace();
  };

  const handleGitStatus = async () => {
    setIsLoading(true);
    setTerminalOutput((prev) => `${prev}\n$ git status --short\n`);
    const res = await executeDesktopAgentTool("git_status", {});
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
      <div className="workspace-panel__header">
        <div className="workspace-panel__title-group">
          <Folder size={18} />
          <h2>{copy?.workspaceTitle || "工作区 & Agent 终端"}</h2>
        </div>
        <div className="workspace-panel__header-actions">
          <button
            type="button"
            className="workspace-panel__btn workspace-panel__btn--icon"
            onClick={refreshWorkspace}
            title={copy?.refreshFileTree ?? "刷新文件树"}
            disabled={isLoading}
          >
            <RefreshCw size={14} className={isLoading ? "workspace-panel__spin" : ""} />
          </button>
          {onClose ? (
            <button
              ref={closeRef}
              type="button"
              className="workspace-panel__btn workspace-panel__btn--icon"
              onClick={onClose}
              title={copy?.closeMenu || "关闭面板"}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <p className="workspace-panel__hint">
        {copy?.workspaceDescription || "配置本地 Agent 工具的运行目录，支持安全文件读写与终端命令执行。"}
      </p>

      <div className="workspace-panel__root-box">
        <label htmlFor="workspace-root-input" className="workspace-panel__label">工作区目录：</label>
        <div className="workspace-panel__input-row">
          <input
            id="workspace-root-input"
            type="text"
            className="workspace-panel__input"
            value={workspaceRoot}
            onChange={(e) => setWorkspaceRoot(e.target.value)}
            placeholder="如 D:/project/my-app"
          />
          <button
            type="button"
            className="workspace-panel__btn workspace-panel__btn--primary"
            onClick={() => void handleSetRoot()}
          >
            设置
          </button>
          <button
            type="button"
            className="workspace-panel__btn"
            onClick={() => void handlePickFolder()}
            title="选择工作区文件夹 (Open workspace)"
          >
            <FolderPlus size={13} />
            浏览...
          </button>
        </div>
      </div>

      <div className="workspace-panel__section workspace-panel__section--tree">
        {/* key 递增 = 全树重挂载：缓存、展开态与加载进度一并重置 */}
        <FileTree
          key={treeRefreshKey}
          copy={copy}
          onOpenFile={handleOpenFile}
          onReferenceFile={onReferenceFile ? handleReferenceFile : undefined}
        />
      </div>

      <div className="workspace-panel__section workspace-panel__section--terminal">
        <div className="workspace-panel__terminal-header">
          <div className="workspace-panel__title-group">
            <Terminal size={14} />
            <span>执行日志与终端</span>
          </div>
          <div className="workspace-panel__actions">
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

        <pre className="workspace-panel__terminal-output">{terminalOutput || "就绪。可在下方输入命令或由八千代自动执行。"}</pre>

        <form onSubmit={handleRunCommand} className="workspace-panel__cmd-form">
          <input
            type="text"
            className="workspace-panel__input workspace-panel__cmd-input"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="输入终端命令 (如 npm test)..."
            disabled={isLoading}
          />
          <button
            type="submit"
            className="workspace-panel__btn workspace-panel__btn--primary"
            disabled={isLoading || !commandInput.trim()}
          >
            <Play size={12} />
          </button>
        </form>
      </div>
    </div>
  );
}
