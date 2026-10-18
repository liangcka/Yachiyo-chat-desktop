import { Check, Copy } from "lucide-react";
import React, { memo, useState } from "react";
import { useLocale } from "../../i18n/locale-context";

export interface MarkdownContentProps {
  text: string;
  isAssistant?: boolean;
}

/** 复制代码块辅助按钮 */
function CopyCodeButton({ code }: { code: string }) {
  const ja = useLocale() === "ja-JP";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 容错防崩
    }
  };

  return (
    <button
      type="button"
      className="markdown-code-copy-btn"
      onClick={handleCopy}
      title={copied ? (ja ? "コピーしました" : "已复制") : ja ? "コードをコピー" : "复制代码"}
      aria-label={copied ? (ja ? "コピーしました" : "已复制") : ja ? "コードをコピー" : "复制代码"}
    >
      {copied ? (
        <>
          <Check size={12} className="markdown-code-copy-icon--success" />
          <span>{ja ? "コピー済み" : "已复制"}</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>{ja ? "コピー" : "复制"}</span>
        </>
      )}
    </button>
  );
}

/**
 * 解析内联格式：
 * 1. 行内代码 (`code`)
 * 2. 加粗 (**text**)
 * 3. 斜体 (*text*)
 * 4. 八千代动作神态 ((动作神态) 或 （动作神态），包含中日文字符)
 */
function renderInlineFormatting(line: string, isAssistant = false, emoteTitle = ""): React.ReactNode[] {
  const tokenRegex =
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|(?:\([^\n()]{1,30}[\u4e00-\u9fa5\u3040-\u30ff][^\n()]{0,10}\)|（[^\n（）]{1,30}[\u4e00-\u9fa5\u3040-\u30ff][^\n（）]{0,10}）))/gu;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `inline-${match.index}`;

    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      parts.push(
        <code key={key} className="markdown-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") && token.endsWith("**") && token.length >= 4) {
      parts.push(
        <strong key={key} className="markdown-strong">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length >= 2) {
      parts.push(
        <em key={key} className="markdown-em">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (isAssistant && (token.startsWith("(") || token.startsWith("（"))) {
      // 八千代动作神态胶囊
      parts.push(
        <span key={key} className="yachiyo-emote-badge" title={emoteTitle}>
          {token}
        </span>,
      );
    } else {
      parts.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts;
}

/**
 * 轻量 Markdown 内容渲染器：
 * - 支持代码块 (```lang ... ```)
 * - 支持无序列表 (- item, * item)
 * - 支持有序列表 (1. item)
 * - 支持引用块 (> text)
 * - 支持行内加粗、斜体、代码与八千代动作标签
 */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  isAssistant = false,
}: MarkdownContentProps) {
  const emoteTitle = useLocale() === "ja-JP" ? "八千代のしぐさ" : "八千代神态动作";
  if (!text) return null;

  // 按代码块拆分文本
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/gu;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const parseTextSection = (sectionText: string, keyPrefix: string): React.ReactNode[] => {
    const lines = sectionText.split("\n");
    const renderedNodes: React.ReactNode[] = [];
    let currentList: React.ReactNode[] = [];
    let isOrderedList = false;

    const flushList = () => {
      if (currentList.length > 0) {
        const listKey = `list-${keyPrefix}-${renderedNodes.length}`;
        if (isOrderedList) {
          renderedNodes.push(
            <ol key={listKey} className="markdown-ol">
              {currentList}
            </ol>,
          );
        } else {
          renderedNodes.push(
            <ul key={listKey} className="markdown-ul">
              {currentList}
            </ul>,
          );
        }
        currentList = [];
      }
    };

    lines.forEach((line, lineIdx) => {
      const trimmed = line.trim();

      // 无序列表项 (- 或 *)
      const unorderedMatch = /^[-*]\s+(.*)$/.exec(line.trimStart());
      if (unorderedMatch) {
        if (isOrderedList) flushList();
        isOrderedList = false;
        currentList.push(
          <li key={`li-${lineIdx}`} className="markdown-li">
            <span className="markdown-li__bullet" aria-hidden="true" />
            <div className="markdown-li__content">
              {renderInlineFormatting(unorderedMatch[1], isAssistant, emoteTitle)}
            </div>
          </li>,
        );
        return;
      }

      // 有序列表项 (1. , 2. )
      const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(line.trimStart());
      if (orderedMatch) {
        if (!isOrderedList) flushList();
        isOrderedList = true;
        currentList.push(
          <li key={`oli-${lineIdx}`} className="markdown-ol-li">
            <span className="markdown-ol-li__num">{orderedMatch[1]}.</span>
            <div className="markdown-li__content">
              {renderInlineFormatting(orderedMatch[2], isAssistant, emoteTitle)}
            </div>
          </li>,
        );
        return;
      }

      // 遇到非列表行，清空积累的列表
      flushList();

      if (!trimmed) {
        // 空行，提供段落间隙
        renderedNodes.push(<div key={`sp-${lineIdx}`} className="markdown-spacer" />);
        return;
      }

      // 引用块 (> text)
      if (trimmed.startsWith(">")) {
        const quoteText = trimmed.replace(/^>\s*/, "");
        renderedNodes.push(
          <blockquote key={`bq-${lineIdx}`} className="markdown-blockquote">
            {renderInlineFormatting(quoteText, isAssistant, emoteTitle)}
          </blockquote>,
        );
        return;
      }

      // 普通段落行
      renderedNodes.push(
        <p key={`p-${keyPrefix}-${lineIdx}`} className="markdown-p">
          {renderInlineFormatting(line, isAssistant, emoteTitle)}
        </p>,
      );
    });

    flushList();
    return renderedNodes;
  };

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const prevText = text.slice(lastIndex, match.index);
      elements.push(...parseTextSection(prevText, `pre-${match.index}`));
    }

    const lang = match[1] || "";
    const code = match[2];
    elements.push(
      <div key={`code-${match.index}`} className="markdown-code-block">
        <div className="markdown-code-header">
          <span className="markdown-code-lang">{lang || "code"}</span>
          <CopyCodeButton code={code} />
        </div>
        <pre className="markdown-code-pre">
          <code>{code}</code>
        </pre>
      </div>,
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    elements.push(...parseTextSection(remainingText, `post-${lastIndex}`));
  }

  return <div className="markdown-content">{elements}</div>;
});
