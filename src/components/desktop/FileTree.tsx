import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n/locale-context";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, Loader2 } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { listWorkspaceEntries, type WorkspaceEntry } from "../../services/desktop-bridge";

export interface FileTreeProps {
  copy?: UiCopy;
  /** 当前激活打开的文件路径（用于在树中高亮显示） */
  activePath?: string | null;
  /** 点击文件：交由上层打开编辑器 tab */
  onOpenFile: (path: string) => void;
  /** @ 引用到对话（可选，未提供时隐藏引用按钮） */
  onReferenceFile?: (path: string) => void;
}

interface TreeNodeProps {
  copy?: UiCopy;
  activePath?: string | null;
  /** 父目录路径（"" 表示工作区根） */
  dir: string;
  entry: WorkspaceEntry;
  entriesByDir: ReadonlyMap<string, WorkspaceEntry[]>;
  expandedDirs: ReadonlySet<string>;
  loadingDirs: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onReferenceFile?: (path: string) => void;
}

function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

function TreeNode({
  copy,
  activePath,
  dir,
  entry,
  entriesByDir,
  expandedDirs,
  loadingDirs,
  onToggleDir,
  onOpenFile,
  onReferenceFile,
}: TreeNodeProps) {
  const path = joinPath(dir, entry.name);
  const isDir = entry.isDir;
  const expanded = expandedDirs.has(path);
  const loading = loadingDirs.has(path);
  const children = entriesByDir.get(path);
  const isActive = !isDir && activePath !== undefined && activePath !== null && activePath === path;

  if (!isDir) {
    return (
      <button
        type="button"
        className={`tree-row tree-row--file ${isActive ? "tree-row--active" : ""}`}
        onClick={() => onOpenFile(path)}
        title={path}
      >
        <FileIcon size={13} className="tree-row__file-icon" />
        <span className="tree-row__label">{entry.name}</span>
        {onReferenceFile ? (
          <span
            className="tree-row__at"
            role="button"
            tabIndex={0}
            aria-label={copy?.referenceFileLabel(entry.name) ?? `引用 ${entry.name} 到对话`}
            title={copy?.referenceToChat ?? "引用到对话"}
            onClick={(e) => {
              e.stopPropagation();
              onReferenceFile(path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onReferenceFile(path);
              }
            }}
          >
            @
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className={`tree-node tree-node--dir ${expanded ? "tree-node--expanded" : ""}`}>
      <button
        type="button"
        className="tree-row"
        onClick={() => onToggleDir(path)}
        title={path}
      >
        <ChevronRight size={12} className="tree-row__chevron" />
        {expanded ? (
          <FolderOpen size={13} className="tree-row__folder" />
        ) : (
          <Folder size={13} className="tree-row__folder" />
        )}
        <span className="tree-row__label">{entry.name}</span>
        {loading ? <Loader2 size={11} className="tree-row__spinner" /> : null}
      </button>
      <div className="tree-children">
        {expanded && children !== undefined
          ? children.map((child) => (
              <TreeNode
                key={child.name}
                copy={copy}
                activePath={activePath}
                dir={path}
                entry={child}
                entriesByDir={entriesByDir}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                onReferenceFile={onReferenceFile}
              />
            ))
          : null}
        {expanded && loading && children === undefined ? (
          <span className="tree-row tree-row--loading">
            <span className="tree-row__label">{copy?.treeLoadingDir ?? "加载中…"}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

const IGNORED_DIR_NAMES = new Set(["node_modules", ".git", ".pnpm-store", "dist"]);

function filterIgnoredEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.filter((e) => !IGNORED_DIR_NAMES.has(e.name));
}

export function FileTree({ copy, activePath, onOpenFile, onReferenceFile }: FileTreeProps) {
  const ja = useLocale() === "ja-JP";
  const [rootEntries, setRootEntries] = useState<WorkspaceEntry[] | null>(null);
  const [entriesByDir, setEntriesByDir] = useState<ReadonlyMap<string, WorkspaceEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(new Set());
  /** 载入请求的序号守卫：卸载后丢弃旧响应，避免过期数据覆盖新树 */
  const loadEpochRef = useRef(0);

  const fetchDir = useCallback(async (dir: string) => {
    const epoch = loadEpochRef.current;
    setLoadingDirs((current) => new Set(current).add(dir));
    const entries = await listWorkspaceEntries(dir);
    if (epoch !== loadEpochRef.current) return;
    setLoadingDirs((current) => {
      const next = new Set(current);
      next.delete(dir);
      return next;
    });
    if (entries === undefined) return;
    setEntriesByDir((current) => new Map(current).set(dir, filterIgnoredEntries(entries)));
  }, []);

  // 全树刷新由父组件经 key 重挂载实现（缓存与展开态随组件销毁一并清空）
  useEffect(() => {
    loadEpochRef.current += 1;
    let cancelled = false;
    void (async () => {
      const entries = await listWorkspaceEntries("");
      if (cancelled) return;
      setRootEntries(entries ? filterIgnoredEntries(entries) : []);
    })();
    return () => {
      cancelled = true;
      loadEpochRef.current += 1;
    };
  }, []);

  const handleToggleDir = useCallback(
    (path: string) => {
      setExpandedDirs((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      // 首次展开才拉取子级；缓存命中时折叠/展开零 IO
      if (!entriesByDir.has(path)) {
        void fetchDir(path);
      }
    },
    [entriesByDir, fetchDir],
  );

  return (
    <div className="file-tree" role="tree" aria-label={ja ? "ワークスペースのファイルツリー" : "工作区文件树"}>
      {rootEntries === null ? (
        <p className="file-tree__empty">{copy?.treeLoading ?? "加载工作区…"}</p>
      ) : rootEntries.length === 0 ? (
        <p className="file-tree__empty">{copy?.treeEmpty ?? "（空目录或未连接桌面运行时）"}</p>
      ) : (
        rootEntries.map((entry) => (
          <TreeNode
            key={entry.name}
            copy={copy}
            activePath={activePath}
            dir=""
            entry={entry}
            entriesByDir={entriesByDir}
            expandedDirs={expandedDirs}
            loadingDirs={loadingDirs}
            onToggleDir={handleToggleDir}
            onOpenFile={onOpenFile}
            onReferenceFile={onReferenceFile}
          />
        ))
      )}
    </div>
  );
}
