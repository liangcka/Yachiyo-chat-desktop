import { useState } from "react";
import { BookOpen, Bot, Check, ChevronDown, ChevronRight, Copy, FileCode, Globe, Play, Search, Server, Terminal } from "lucide-react";
import type { Locale } from "../../domain/chat";
import { formatToolDescription } from "./tool-description";
import { projectManager } from "../../services/project-manager";
import { copyFor } from "../../i18n/messages";
import { EditFileDiff } from "./EditFileDiff";

export interface ToolCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  isRunning?: boolean;
  isWaitingForApproval?: boolean;
  locale?: Locale;
}

export function ToolCard({ toolName, args, output, isError, isRunning, isWaitingForApproval, locale = "zh-CN" }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const getToolIcon = () => {
    if (toolName.startsWith("mcp__")) {
      return <Server size={14} className="tool-card__icon" aria-hidden="true" />;
    }
    switch (toolName) {
      case "run_command":
        return <Terminal size={14} className="tool-card__icon" aria-hidden="true" />;
      case "read_file":
      case "write_file":
      case "edit_file":
      case "list_directory":
        return <FileCode size={14} className="tool-card__icon" aria-hidden="true" />;
      case "glob":
      case "grep":
        return <Search size={14} className="tool-card__icon" aria-hidden="true" />;
      case "web_fetch":
      case "web_search":
        return <Globe size={14} className="tool-card__icon" aria-hidden="true" />;
      case "task":
        return <Bot size={14} className="tool-card__icon" aria-hidden="true" />;
      case "read_guideline":
        return <BookOpen size={14} className="tool-card__icon" aria-hidden="true" />;
      default:
        return <Play size={14} className="tool-card__icon" aria-hidden="true" />;
    }
  };

  const description = formatToolDescription(toolName, args, locale);
  const hasArgs = Boolean(args && Object.keys(args).length > 0);
  const needsProject = isError && output !== undefined && /未选择(?:工作区)?项目|未打开项目工作区/u.test(output);
  const selectProject = copyFor(locale).selectProject;

  return (
    <div className={`tool-card ${isError ? "tool-card--error" : ""}`}>
      <button
        type="button"
        className="tool-card__header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="tool-card__title-group">
          <span className="tool-card__chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          {getToolIcon()}
          <span className="tool-card__description">{description}</span>
        </div>
        {isWaitingForApproval ? (
          <span className="tool-card__waiting" role="status">{locale === "ja-JP" ? "承認待ち" : "等待批准"}</span>
        ) : isRunning ? (
          <span className="tool-card__spinner" aria-hidden="true" />
        ) : null}
      </button>

      {needsProject ? <button type="button" className="tool-card__select-project"
        onClick={() => { void projectManager.pickAndOpenProject(selectProject); }}>
        {selectProject}
      </button> : null}

      {expanded ? (
        <div className="tool-card__content">
          {toolName === "edit_file" ? <EditFileDiff args={args} locale={locale} /> : null}
          {output ? (
            <div className="tool-card__section">
              <div className="tool-card__section-header">
                <span className="tool-card__section-label">
                  {locale === "ja-JP" ? "出力" : "输出"}
                </span>
                <button
                  type="button"
                  className="tool-card__copy-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(output);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  title={copied ? (locale === "ja-JP" ? "コピー完了" : "已复制") : (locale === "ja-JP" ? "出力をコピー" : "复制输出")}
                >
                  {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                  <span>{copied ? (locale === "ja-JP" ? "コピー完了" : "已复制") : (locale === "ja-JP" ? "コピー" : "复制")}</span>
                </button>
              </div>
              <pre className="tool-card__code tool-card__output">{output}</pre>
            </div>
          ) : null}

          {hasArgs ? (
            <details className="tool-card__details">
              <summary className="tool-card__details-summary">
                <ChevronRight size={12} className="tool-card__details-chevron" aria-hidden="true" />
                <span>{locale === "ja-JP" ? "詳細" : "详情"}</span>
              </summary>
              <pre className="tool-card__code tool-card__args">
                {JSON.stringify(args, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
