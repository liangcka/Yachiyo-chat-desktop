import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, FileCode, Globe, Play, Server, Terminal } from "lucide-react";
import type { Locale } from "../../domain/chat";
import { formatToolDescription } from "./tool-description";

export interface ToolCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  isRunning?: boolean;
  locale?: Locale;
}

export function ToolCard({ toolName, args, output, isError, isRunning, locale = "zh-CN" }: ToolCardProps) {
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
      case "list_directory":
        return <FileCode size={14} className="tool-card__icon" aria-hidden="true" />;
      case "web_fetch":
        return <Globe size={14} className="tool-card__icon" aria-hidden="true" />;
      default:
        return <Play size={14} className="tool-card__icon" aria-hidden="true" />;
    }
  };

  const description = formatToolDescription(toolName, args, locale);
  const hasArgs = Boolean(args && Object.keys(args).length > 0);

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
        {isRunning ? (
          <span className="tool-card__spinner" aria-hidden="true" />
        ) : null}
      </button>

      {expanded ? (
        <div className="tool-card__content">
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
