import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, FolderGit2, Play, RefreshCw, Terminal, X } from "lucide-react";
import { useClosing } from "../../app/use-closing";
import type { UiCopy } from "../../i18n/messages";
import { executeDesktopAgentTool, getDesktopWorkspaceRoot, setDesktopWorkspaceRoot } from "../../services/desktop-bridge";

export interface WorkspacePanelProps {
  copy?: UiCopy;
  open?: boolean;
  onClose?: () => void;
}

export function WorkspacePanel({ copy, open = true, onClose }: WorkspacePanelProps) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
  const [fileList, setFileList] = useState<string[]>([]);
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const { render, closing } = useClosing(open, 300);

  const refreshWorkspace = useCallback(async () => {
    setIsLoading(true);
    try {
      const root = await getDesktopWorkspaceRoot();
      if (root) {
        setWorkspaceRoot(root);
        const res = await executeDesktopAgentTool("list_directory", { path: "." });
        if (!res.isError && res.output) {
          try {
            const parsed = JSON.parse(res.output) as string[];
            setFileList(parsed);
          } catch {
            setFileList([]);
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        void refreshWorkspace();
      });
      closeRef.current?.focus();
    }
  }, [open, refreshWorkspace]);

  if (!render) return null;

  const handleSetRoot = async () => {
    if (!workspaceRoot) return;
    const success = await setDesktopWorkspaceRoot(workspaceRoot);
    if (success) {
      void refreshWorkspace();
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
    void refreshWorkspace();
  };

  const handleGitStatus = async () => {
    setIsLoading(true);
    setTerminalOutput((prev) => `${prev}\n$ git status --short\n`);
    const res = await executeDesktopAgentTool("git_status", {});
    setTerminalOutput((prev) => `${prev}${res.output}\n`);
    setIsLoading(false);
  };

  const handleGitDiff = async () => {
    setIsLoading(true);
    setTerminalOutput((prev) => `${prev}\n$ git diff\n`);
    const res = await executeDesktopAgentTool("git_diff", {});
    setTerminalOutput((prev) => `${prev}${res.output}\n`);
    setIsLoading(false);
  };

  const content = (
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
            onClick={() => void refreshWorkspace()}
            title="刷新工作区"
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
        </div>
      </div>

      <div className="workspace-panel__section">
        <span className="workspace-panel__label">工作区文件（{fileList.length} 项）：</span>
        <div className="workspace-panel__file-list">
          {fileList.map((file) => (
            <div key={file} className="workspace-panel__file-item">
              <span>{file}</span>
            </div>
          ))}
          {fileList.length === 0 ? (
            <p className="workspace-panel__empty">（空目录或未连接桌面运行时）</p>
          ) : null}
        </div>
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
            <button
              type="button"
              className="workspace-panel__btn workspace-panel__btn--xs"
              onClick={() => void handleGitDiff()}
            >
              Diff
            </button>
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

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      <section
        aria-label={copy?.workspaceTitle || "工作区 & Agent 终端"}
        aria-modal="true"
        className={`skills-panel ${closing ? "skills-panel--closing" : ""}`}
        role="dialog"
      >
        {content}
      </section>
    </div>
  );
}
