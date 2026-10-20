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

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/u;
const RULE_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})$/u;
const TABLE_DIVIDER_PATTERN = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/u;

type CellAlign = "left" | "center" | "right" | undefined;

function splitTableRow(row: string): string[] {
  return row.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
}

function readCellAlign(divider: string): CellAlign {
  const left = divider.startsWith(":");
  const right = divider.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return left ? "left" : undefined;
}

/**
 * 轻量 Markdown 内容渲染器：
 * - 支持代码块 (```lang ... ```)
 * - 支持标题 (# ~ ######)、分隔线 (---) 与 GFM 表格
 * - 支持无序列表 (- item, * item)
 * - 支持有序列表 (1. item)
 * - 支持引用块 (> text)，连续引用行合并为一块
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
    // 代码块前后的空行由容器间距承担，段内连续空行只保留一个间隙
    while (lines.length > 0 && !lines[0].trim()) lines.shift();
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    const renderedNodes: React.ReactNode[] = [];
    let currentList: React.ReactNode[] = [];
    let isOrderedList = false;
    let previousBlank = false;

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

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
      const line = lines[lineIdx];
      const trimmed = line.trim();
      const followsBlank = previousBlank;
      previousBlank = !trimmed;

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
        continue;
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
        continue;
      }

      // 遇到非列表行，清空积累的列表
      flushList();

      if (!trimmed) {
        // 空行，提供段落间隙
        if (!followsBlank) renderedNodes.push(<div key={`sp-${lineIdx}`} className="markdown-spacer" />);
        continue;
      }

      const headingMatch = HEADING_PATTERN.exec(trimmed);
      if (headingMatch) {
        const level = headingMatch[1].length;
        renderedNodes.push(React.createElement(
          `h${level}`,
          { key: `h-${keyPrefix}-${lineIdx}`, className: `markdown-heading markdown-heading--${level}` },
          renderInlineFormatting(headingMatch[2], isAssistant, emoteTitle),
        ));
        continue;
      }

      if (RULE_PATTERN.test(trimmed)) {
        renderedNodes.push(<hr key={`hr-${keyPrefix}-${lineIdx}`} className="markdown-hr" />);
        continue;
      }

      // 表格：表头行后紧跟 |---|:---:| 分隔行才成立，流式输出中途不会误判
      const dividerLine = lines[lineIdx + 1]?.trim() ?? "";
      if (trimmed.includes("|") && dividerLine.includes("|") && TABLE_DIVIDER_PATTERN.test(dividerLine)) {
        const header = splitTableRow(trimmed);
        const aligns = splitTableRow(dividerLine).map(readCellAlign);
        const rows: string[][] = [];
        let rowIdx = lineIdx + 2;
        while (rowIdx < lines.length && lines[rowIdx].includes("|") && lines[rowIdx].trim()) {
          rows.push(splitTableRow(lines[rowIdx]));
          rowIdx += 1;
        }
        renderedNodes.push(
          <div key={`tb-${keyPrefix}-${lineIdx}`} className="markdown-table-wrap">
            <table className="markdown-table">
              <thead>
                <tr>
                  {header.map((cell, cellIdx) => (
                    <th key={cellIdx} data-align={aligns[cellIdx]}>
                      {renderInlineFormatting(cell, isAssistant, emoteTitle)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>
                    {header.map((_, cellIdx) => (
                      <td key={cellIdx} data-align={aligns[cellIdx]}>
                        {renderInlineFormatting(row[cellIdx] ?? "", isAssistant, emoteTitle)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        lineIdx = rowIdx - 1;
        continue;
      }

      // 引用块 (> text)，连续引用行合并为一块
      if (trimmed.startsWith(">")) {
        const quoteLines: string[] = [];
        let quoteIdx = lineIdx;
        while (quoteIdx < lines.length && lines[quoteIdx].trim().startsWith(">")) {
          quoteLines.push(lines[quoteIdx].trim().replace(/^>\s?/, ""));
          quoteIdx += 1;
        }
        renderedNodes.push(
          <blockquote key={`bq-${keyPrefix}-${lineIdx}`} className="markdown-blockquote">
            {quoteLines.map((quoteLine, idx) => (
              <p key={idx} className="markdown-p">
                {renderInlineFormatting(quoteLine, isAssistant, emoteTitle)}
              </p>
            ))}
          </blockquote>,
        );
        lineIdx = quoteIdx - 1;
        continue;
      }

      // 普通段落行
      renderedNodes.push(
        <p key={`p-${keyPrefix}-${lineIdx}`} className="markdown-p">
          {renderInlineFormatting(line, isAssistant, emoteTitle)}
        </p>,
      );
    }

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
