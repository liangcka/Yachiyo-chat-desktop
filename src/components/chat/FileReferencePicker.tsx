import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, File, FileCode, FileJson, FileText, Image as ImageIcon, X } from "lucide-react";
import { searchWorkspaceFiles } from "../../services/desktop-bridge";

export interface FileReferencePickerProps {
  /** 当前 @ 之后的检索关键词（空字符串表示已输入 @ 但未输入后续字符） */
  query: string;
  /** 选中文件回调：返回规范化相对路径（如 "src/App.tsx"） */
  onSelect: (path: string) => void;
  /** 关闭浮层回调 */
  onClose: () => void;
  /** 可选：显式传入文件列表（用于测试或外部注入） */
  items?: string[];
  /** 可选：键盘选中的索引（受控模式） */
  selectedIndex?: number;
  /** 索引变更回调 */
  onSelectedIndexChange?: (index: number) => void;
}

/** 依据文件扩展名匹配适宜的 Lucide 图标 */
function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "rs", "go", "py", "c", "cpp", "java"].includes(ext)) {
    return <FileCode size={14} className="file-ref-picker__icon file-ref-picker__icon--code" />;
  }
  if (["json", "yaml", "yml", "toml"].includes(ext)) {
    return <FileJson size={14} className="file-ref-picker__icon file-ref-picker__icon--data" />;
  }
  if (["md", "txt", "doc", "rst"].includes(ext)) {
    return <FileText size={14} className="file-ref-picker__icon file-ref-picker__icon--text" />;
  }
  if (["png", "jpg", "jpeg", "svg", "webp", "gif", "ico"].includes(ext)) {
    return <ImageIcon size={14} className="file-ref-picker__icon file-ref-picker__icon--img" />;
  }
  return <File size={14} className="file-ref-picker__icon" />;
}

/** 分割文件路径为文件名与所在目录 */
function splitPath(path: string): { fileName: string; dirName: string } {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { fileName: normalized, dirName: "" };
  }
  return {
    fileName: normalized.slice(lastSlash + 1),
    dirName: normalized.slice(0, lastSlash + 1),
  };
}

/** 高亮匹配 query 的文本片段 */
function HighlightMatchedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) {
    return <span>{text}</span>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIdx = lowerText.indexOf(lowerQuery);

  if (matchIdx === -1) {
    return <span>{text}</span>;
  }

  const before = text.slice(0, matchIdx);
  const match = text.slice(matchIdx, matchIdx + query.length);
  const after = text.slice(matchIdx + query.length);

  return (
    <span>
      {before}
      <span className="file-ref-picker__highlight">{match}</span>
      {after}
    </span>
  );
}

export function FileReferencePicker({
  query,
  onSelect,
  onClose,
  items: externalItems,
  selectedIndex: controlledIndex,
  onSelectedIndexChange,
}: FileReferencePickerProps) {
  const [internalItems, setInternalItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0);

  const isControlled = controlledIndex !== undefined;
  const activeIndex = isControlled ? controlledIndex : uncontrolledIndex;

  const setActiveIndex = (idx: number) => {
    if (!isControlled) {
      setUncontrolledIndex(idx);
    }
    onSelectedIndexChange?.(idx);
  };

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setUncontrolledIndex(0);
  }

  // 异步获取工作区文件（若未外部显式传入 items）
  useEffect(() => {
    if (externalItems !== undefined) {
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      setLoading(true);
      void searchWorkspaceFiles(query, 25).then((results) => {
        if (cancelled) return;
        setInternalItems(results ?? []);
        setLoading(false);
      });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, externalItems]);

  const rawList = externalItems !== undefined ? externalItems : internalItems;

  // 若为外部传入 items，在前端统一根据 query 进行大小写不敏感的模糊过滤
  const displayList = useMemo(() => {
    if (externalItems === undefined) {
      return rawList;
    }
    if (!query.trim()) {
      return rawList.slice(0, 25);
    }
    const q = query.toLowerCase();
    return rawList
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, 25);
  }, [externalItems, rawList, query]);

  const listRef = useRef<HTMLUListElement>(null);

  // 滚动确保当前激活项在可视区域内
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div
      className="file-ref-picker"
      role="listbox"
      aria-label="工作区文件引用选择"
      tabIndex={-1}
    >
      <div className="file-ref-picker__header">
        <div className="file-ref-picker__title">
          <AtSign size={13} />
          <span>引用工作区文件</span>
          {query ? <span className="file-ref-picker__query-tag">@{query}</span> : null}
        </div>
        <div className="file-ref-picker__hints">
          <span className="file-ref-picker__hint-badge">↑↓ 移动</span>
          <span className="file-ref-picker__hint-badge">Enter 选取</span>
          <button
            type="button"
            className="file-ref-picker__close-btn"
            onClick={onClose}
            title="关闭浮层 (Esc)"
            aria-label="关闭文件选择浮层"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <ul className="file-ref-picker__list" ref={listRef}>
        {loading && displayList.length === 0 ? (
          <li className="file-ref-picker__empty">正在检索工作区文件…</li>
        ) : displayList.length === 0 ? (
          <li className="file-ref-picker__empty">未找到匹配的工作区文件</li>
        ) : (
          displayList.map((path, idx) => {
            const isSelected = idx === activeIndex;
            const { fileName, dirName } = splitPath(path);

            return (
              <li
                key={path}
                role="option"
                data-filepath={path}
                tabIndex={0}
                aria-selected={isSelected}
                className={`file-ref-picker__item ${isSelected ? "file-ref-picker__item--selected" : ""}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => onSelect(path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(path);
                  }
                }}
              >
                {getFileIcon(path)}
                <div className="file-ref-picker__item-text">
                  <span className="file-ref-picker__item-name">
                    <HighlightMatchedText text={fileName} query={query} />
                  </span>
                  {dirName ? (
                    <span className="file-ref-picker__item-dir">
                      <HighlightMatchedText text={dirName} query={query} />
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
