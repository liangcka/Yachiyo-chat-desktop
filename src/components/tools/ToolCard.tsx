import { useState } from "react";
import { CheckCircle, ChevronDown, ChevronRight, FileCode, Globe, Play, Terminal, XCircle } from "lucide-react";

export interface ToolCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  isRunning?: boolean;
}

export function ToolCard({ toolName, args, output, isError, isRunning }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);

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
          <span>执行中...</span>
        </span>
      );
    }
    if (isError) {
      return (
        <span className="tool-card__status tool-card__status--error">
          <XCircle size={12} />
          <span>失败</span>
        </span>
      );
    }
    return (
      <span className="tool-card__status tool-card__status--success">
        <CheckCircle size={12} />
        <span>完成</span>
      </span>
    );
  };

  const formattedArgs = args ? JSON.stringify(args) : "";

  return (
    <div className={`tool-card ${isError ? "tool-card--error" : ""}`}>
      <button
        type="button"
        className="tool-card__header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="tool-card__title-group">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {getToolIcon()}
          <span className="tool-card__name">{toolName}</span>
          {formattedArgs ? <span className="tool-card__arg-preview">{formattedArgs}</span> : null}
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
              <span className="tool-card__section-label">输出:</span>
              <pre className="tool-card__code tool-card__output">{output}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
