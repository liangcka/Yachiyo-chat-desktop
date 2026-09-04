import { useState } from "react";
import { Check, CheckCircle, ChevronDown, ChevronRight, Copy, FileCode, Globe, Play, Terminal, XCircle } from "lucide-react";

export interface ToolCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  isRunning?: boolean;
}

export function ToolCard({ toolName, args, output, isError, isRunning }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const getToolIcon = () => {
    switch (toolName) {
      case "run_command":
        return <Terminal size={14} className="tool-card__icon" />;
      case "read_file":
      case "write_file":
      case "list_directory":
        return <FileCode size={14} className="tool-card__icon" />;
      case "web_fetch":
        return <Globe size={14} className="tool-card__icon" />;
      default:
        return <Play size={14} className="tool-card__icon" />;
    }
  };

  const getStatusBadge = () => {
    if (isRunning) {
      return (
        <span className="tool-card__status tool-card__status--running">
          <span className="tool-card__spinner" />
          <span>执行中</span>
        </span>
      );
    }
    if (isError) {
      return (
        <span className="tool-card__status tool-card__status--error">
          <XCircle size={11} />
          <span>失败</span>
        </span>
      );
    }
    return (
      <span className="tool-card__status tool-card__status--success">
        <CheckCircle size={11} />
        <span>完成</span>
      </span>
    );
  };

  const getArgPreview = (): string | null => {
    if (!args) return null;
    if (typeof args.path === "string") return args.path;
    if (typeof args.command === "string") return `$ ${args.command}`;
    if (typeof args.query === "string") return `"${args.query}"`;
    if (typeof args.pattern === "string") return `"${args.pattern}"`;
    if (typeof args.url === "string") return args.url;
    const keys = Object.keys(args);
    if (keys.length === 1 && typeof args[keys[0]] === "string") {
      return String(args[keys[0]]);
    }
    const json = JSON.stringify(args);
    return json.length > 28 ? `${json.slice(0, 25)}...` : json;
  };

  const argPreview = getArgPreview();

  return (
    <div className={`tool-card ${isError ? "tool-card--error" : ""}`}>
      <button
        type="button"
        className="tool-card__header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="tool-card__title-group">
          <span className="tool-card__chevron">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          {getToolIcon()}
          <span className="tool-card__name">{toolName}</span>
          {argPreview ? <span className="tool-card__arg-pill">{argPreview}</span> : null}
        </div>
        {getStatusBadge()}
      </button>

      {expanded ? (
        <div className="tool-card__content">
          {args ? (
            <div className="tool-card__section">
              <span className="tool-card__section-label">参数:</span>
              <pre className="tool-card__code">{JSON.stringify(args, null, 2)}</pre>
            </div>
          ) : null}
          {output ? (
            <div className="tool-card__section">
              <div className="tool-card__section-header">
                <span className="tool-card__section-label">输出:</span>
                <button
                  type="button"
                  className="tool-card__copy-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(output);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  title={copied ? "已复制" : "复制输出"}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copied ? "已复制" : "复制"}</span>
                </button>
              </div>
              <pre className="tool-card__code tool-card__output">{output}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
