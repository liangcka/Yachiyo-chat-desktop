import { useCallback, useEffect, useState } from "react";
import { Check, Copy, FileCode2, ShieldAlert, Terminal, X } from "lucide-react";
import type { Locale } from "../../domain/chat";

export interface PermissionCardProps {
  toolName: string;
  argumentsJson: string;
  onApprove: (sessionScope: boolean) => void;
  onDeny: () => void;
  locale?: Locale;
}

interface ParsedPermissionInfo {
  toolType: "command" | "file" | "generic";
  title: string;
  badgeLabel: string;
  commandText?: string;
  filePath?: string;
  fileDescription?: string;
  extraMeta?: string;
  formattedJson?: string;
}

/** 智能解析写操作工具参数，提取关键命令或文件路径以供语义化展示 */
function parsePermissionArguments(
  toolName: string,
  rawJson: string,
  locale: Locale = "zh-CN",
): ParsedPermissionInfo {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    // rawJson 不是合法 JSON 时直接降级为普通纯文本
  }

  const isJa = locale === "ja-JP";

  if (toolName === "run_command" && parsed && typeof parsed.command === "string") {
    const timeout =
      typeof parsed.timeout_secs === "number"
        ? isJa
          ? `タイムアウト ${parsed.timeout_secs}秒`
          : `超时 ${parsed.timeout_secs}s`
        : undefined;
    return {
      toolType: "command",
      title: isJa ? "このコマンドの実行を許可しますか？" : "允许运行此命令？",
      badgeLabel: isJa ? "ターミナル" : "终端命令",
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
    const desc =
      typeof parsed.Description === "string" && parsed.Description.trim()
        ? parsed.Description.trim()
        : typeof parsed.Instruction === "string" && parsed.Instruction.trim()
        ? parsed.Instruction.trim()
        : isJa
        ? "ワークスペース内のファイルを編集"
        : "修改工作区文件";
    return {
      toolType: "file",
      title: isJa ? "このファイルの変更を許可しますか？" : "允许修改此文件？",
      badgeLabel: isJa ? "ファイル" : "文件写入",
      filePath,
      fileDescription: desc,
      formattedJson: JSON.stringify(parsed, null, 2),
    };
  }

  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const serverId = parts[1] || "mcp";
    const opName = parts.slice(2).join("__") || toolName;
    return {
      toolType: "generic",
      title: isJa ? `${serverId} ツールの呼び出しを許可しますか？` : `允许调用 ${serverId} 工具？`,
      badgeLabel: `MCP: ${serverId}`,
      extraMeta: opName,
      formattedJson: parsed ? JSON.stringify(parsed, null, 2) : rawJson,
    };
  }

  return {
    toolType: "generic",
    title: isJa ? `${toolName} ツールの呼び出しを許可しますか？` : `允许调用 ${toolName} 工具？`,
    badgeLabel: isJa ? "ツール" : "写操作授权",
    formattedJson: parsed ? JSON.stringify(parsed, null, 2) : rawJson,
  };
}

/** 写类工具权限确认卡片：从输入框上方一体化拉起的安全审查子容器 */
export function PermissionCard({
  toolName,
  argumentsJson,
  onApprove,
  onDeny,
  locale = "zh-CN",
}: PermissionCardProps) {
  const [copied, setCopied] = useState(false);
  const info = parsePermissionArguments(toolName, argumentsJson, locale);
  const isJa = locale === "ja-JP";

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

  // 支持键盘快捷键：Esc 拒绝，Enter 允许一次
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onDeny();
        return;
      }
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "BUTTON" ||
            target.tagName === "SUMMARY" ||
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA")
        ) {
          return;
        }
        e.preventDefault();
        onApprove(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onApprove, onDeny]);

  return (
    <div
      aria-label={isJa ? "ツールの実行許可" : "工具执行授权"}
      className="permission-card permission-card--sub-container"
      role="alertdialog"
    >
      {/* 头部：图标、状态指示、操作类型胶囊与元信息 */}
      <div className="permission-card__header">
        <div className="permission-card__header-main">
          <div className="permission-card__icon-badge">
            {info.toolType === "command" ? (
              <Terminal size={14} />
            ) : info.toolType === "file" ? (
              <FileCode2 size={14} />
            ) : (
              <ShieldAlert size={14} />
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
                title={isJa ? "コマンドをコピー" : "复制命令"}
                aria-label={isJa ? "コマンドをコピー" : "复制命令"}
              >
                {copied ? <Check size={12} className="permission-card__copy-check" /> : <Copy size={12} />}
                <span>{copied ? (isJa ? "コピー済み" : "已复制") : (isJa ? "コピー" : "复制")}</span>
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
              <span className="permission-card__file-path-label">
                {isJa ? "対象パス：" : "目标路径："}
              </span>
              <code className="permission-card__file-path">{info.filePath}</code>
              <button
                type="button"
                className="permission-card__copy-btn"
                onClick={handleCopy}
                title={isJa ? "パスをコピー" : "复制路径"}
                aria-label={isJa ? "パスをコピー" : "复制路径"}
              >
                {copied ? <Check size={12} className="permission-card__copy-check" /> : <Copy size={12} />}
                <span>{copied ? (isJa ? "コピー済み" : "已复制") : (isJa ? "コピー" : "复制")}</span>
              </button>
            </div>
            {info.fileDescription ? (
              <p className="permission-card__file-desc" title={info.fileDescription}>
                {info.fileDescription}
              </p>
            ) : null}
            {info.formattedJson ? (
              <details className="permission-card__details">
                <summary className="permission-card__details-summary">
                  <span>{isJa ? "詳細" : "详情"}</span>
                </summary>
                <pre className="permission-card__args-pre">{info.formattedJson}</pre>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="permission-card__generic">
            <p className="permission-card__tool-name">{toolName}</p>
            {info.formattedJson ? (
              <details className="permission-card__details">
                <summary className="permission-card__details-summary">
                  <span>{isJa ? "詳細" : "详情"}</span>
                </summary>
                <pre className="permission-card__args-pre">{info.formattedJson}</pre>
              </details>
            ) : (
              <pre className="permission-card__args-pre">{argumentsJson}</pre>
            )}
          </div>
        )}
      </div>

      {/* 底部操作行：拒绝、本会话允许、允许一次 */}
      <div className="permission-card__actions">
        <button
          className="permission-card__btn permission-card__btn--deny"
          onClick={onDeny}
          type="button"
          title={isJa ? "拒否 (Esc)" : "拒绝 (Esc)"}
        >
          <X size={13} />
          <span>{isJa ? "拒否" : "拒绝"}</span>
          <kbd className="permission-card__kbd">Esc</kbd>
        </button>
        <button
          className="permission-card__btn permission-card__btn--secondary"
          onClick={() => onApprove(true)}
          type="button"
          title={isJa ? "このセッション中許可" : "本会话允许"}
        >
          <span>{isJa ? "このセッション中許可" : "本会话允许"}</span>
        </button>
        <button
          className="permission-card__btn permission-card__btn--primary"
          onClick={() => onApprove(false)}
          type="button"
          title={isJa ? "1回のみ許可 (Enter)" : "允许一次 (Enter)"}
        >
          <Check size={13} />
          <span>{isJa ? "1回のみ許可" : "允许一次"}</span>
          <kbd className="permission-card__kbd">Enter</kbd>
        </button>
      </div>
    </div>
  );
}

