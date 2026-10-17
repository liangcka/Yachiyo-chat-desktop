import { useCallback, useEffect, useState } from "react";
import { Check, Copy, FileCode2, ShieldAlert, Terminal, X } from "lucide-react";

export interface PermissionCardProps {
  toolName: string;
  argumentsJson: string;
  onApprove: (sessionScope: boolean) => void;
  onDeny: () => void;
}

interface ParsedPermissionInfo {
  toolType: "command" | "file" | "generic";
  title: string;
  badgeLabel: string;
  commandText?: string;
  filePath?: string;
  extraMeta?: string;
  formattedJson?: string;
}

/** 智能解析写操作工具参数，提取关键命令或文件路径以供语义化展示 */
function parsePermissionArguments(toolName: string, rawJson: string): ParsedPermissionInfo {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    // rawJson 不是合法 JSON 时直接降级为普通纯文本
  }

  if (toolName === "run_command" && parsed && typeof parsed.command === "string") {
    const timeout = typeof parsed.timeout_secs === "number" ? `超时 ${parsed.timeout_secs}s` : undefined;
    return {
      toolType: "command",
      title: "八千代请求执行终端命令",
      badgeLabel: "终端命令",
      commandText: parsed.command,
      extraMeta: timeout,
    };
  }

  if ((toolName === "write_file" || toolName === "replace_file_content") && parsed) {
    const filePath =
      typeof parsed.path === "string"
        ? parsed.path
        : typeof parsed.TargetFile === "string"
        ? parsed.TargetFile
        : undefined;
    const desc = typeof parsed.Description === "string" ? parsed.Description : undefined;
    return {
      toolType: "file",
      title: "八千代请求修改工作区文件",
      badgeLabel: "文件写入",
      filePath,
      extraMeta: desc,
      formattedJson: JSON.stringify(parsed, null, 2),
    };
  }

  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const serverId = parts[1] || "mcp";
    const opName = parts.slice(2).join("__") || toolName;
    return {
      toolType: "generic",
      title: `八千代请求调用外部 MCP 工具 (${serverId})`,
      badgeLabel: `MCP: ${serverId}`,
      extraMeta: opName,
      formattedJson: parsed ? JSON.stringify(parsed, null, 2) : rawJson,
    };
  }

  return {
    toolType: "generic",
    title: "八千代请求执行写操作",
    badgeLabel: "写操作授权",
    formattedJson: parsed ? JSON.stringify(parsed, null, 2) : rawJson,
  };
}

/** 写类工具权限确认卡片：从输入框上方一体化拉起的安全审查子容器 */
export function PermissionCard({ toolName, argumentsJson, onApprove, onDeny }: PermissionCardProps) {
  const [copied, setCopied] = useState(false);
  const info = parsePermissionArguments(toolName, argumentsJson);

  const copyContent = info.commandText ?? info.filePath ?? argumentsJson;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板异常静默回退
    }
  }, [copyContent]);

  // 支持键盘快捷键：Esc 拒绝，Ctrl+Enter 仅允许当前操作
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDeny();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onApprove(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onApprove, onDeny]);

  return (
    <div
      aria-label="工具执行授权"
      className="permission-card permission-card--sub-container"
      role="alertdialog"
    >
      {/* 头部：图标、状态指示、操作类型胶囊与元信息 */}
      <div className="permission-card__header">
        <div className="permission-card__header-main">
          <div className="permission-card__icon-badge">
            {info.toolType === "command" ? (
              <Terminal size={15} />
            ) : info.toolType === "file" ? (
              <FileCode2 size={15} />
            ) : (
              <ShieldAlert size={15} />
            )}
          </div>
          <span className="permission-card__title">{info.title}</span>
          <span className="permission-card__category-badge">{info.badgeLabel}</span>
        </div>

        {info.extraMeta ? (
          <span className="permission-card__meta-badge" title={info.extraMeta}>
            {info.extraMeta}
          </span>
        ) : null}
      </div>

      {/* 主体：智能语义化内容展示 */}
      <div className="permission-card__body">
        {info.toolType === "command" && info.commandText ? (
          <div className="permission-card__terminal">
            <div className="permission-card__terminal-header">
              <span className="permission-card__terminal-dot" />
              <span className="permission-card__terminal-label">PowerShell / Shell</span>
              <button
                type="button"
                className="permission-card__copy-btn"
                onClick={handleCopy}
                title="复制命令"
                aria-label="复制命令"
              >
                {copied ? <Check size={12} className="permission-card__copy-check" /> : <Copy size={12} />}
                <span>{copied ? "已复制" : "复制"}</span>
              </button>
            </div>
            <div className="permission-card__terminal-content">
              <span className="permission-card__terminal-prompt">$</span>
              <code className="permission-card__code-text">{info.commandText}</code>
            </div>
          </div>
        ) : info.toolType === "file" && info.filePath ? (
          <div className="permission-card__file-target">
            <div className="permission-card__file-header">
              <span className="permission-card__file-path-label">目标路径：</span>
              <code className="permission-card__file-path">{info.filePath}</code>
              <button
                type="button"
                className="permission-card__copy-btn"
                onClick={handleCopy}
                title="复制路径"
                aria-label="复制路径"
              >
                {copied ? <Check size={12} className="permission-card__copy-check" /> : <Copy size={12} />}
                <span>{copied ? "已复制" : "复制"}</span>
              </button>
            </div>
            {info.formattedJson ? (
              <pre className="permission-card__args-pre">{info.formattedJson}</pre>
            ) : null}
          </div>
        ) : (
          <div className="permission-card__generic">
            <p className="permission-card__tool-name">{toolName}</p>
            <pre className="permission-card__args-pre">{info.formattedJson ?? argumentsJson}</pre>
          </div>
        )}
      </div>

      {/* 底部操作行：拒绝、批准一次、批准并记住 */}
      <div className="permission-card__actions">
        <button
          className="permission-card__btn permission-card__btn--deny"
          onClick={onDeny}
          type="button"
          title="拒绝本次执行 (Esc)"
        >
          <X size={13} />
          <span>拒绝</span>
        </button>
        <button
          className="permission-card__btn permission-card__btn--secondary"
          onClick={() => onApprove(false)}
          type="button"
          title="仅批准本次执行"
        >
          <span>本次允许</span>
        </button>
        <button
          className="permission-card__btn permission-card__btn--primary"
          onClick={() => onApprove(true)}
          type="button"
          title="在当前工作区记住此命令，文件操作仅限此路径，外部工具仅限相同参数"
        >
          <Check size={13} />
          <span>总是允许此类命令</span>
        </button>
      </div>
    </div>
  );
}

