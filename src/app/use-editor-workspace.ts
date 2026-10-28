import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readWorkspaceFile, writeWorkspaceFile } from "../services/desktop-bridge";
import { emitWorkspaceFilesChanged, subscribeWorkspaceFilesChanged } from "../services/workspace-events";

/** 超过该体积的文件以只读打开，避免 Monaco 大文档卡顿（1MB） */
const READ_ONLY_LIMIT_BYTES = 1024 * 1024;

export interface EditorFileTab {
  kind: "file";
  /** 标签身份：工作区 + 相对路径。不同项目里的同名文件是两个标签，读写各自落到所属项目 */
  key: string;
  /** 标签所属工作区（原生层规范路径） */
  workspace: string;
  /** 工作区相对路径，统一 `/` 分隔 */
  path: string;
  /** 编辑器当前内容（model 变更时同步） */
  content: string;
  /** 上次保存（或读盘）内容；dirty = content !== savedContent */
  savedContent: string;
  /** savedContent 对应的磁盘版本摘要，保存时据此核对；新文件缺省 */
  digest?: string;
  /** 原文件带 UTF-8 BOM，保存时保留 */
  bom: boolean;
  /** 只读：大文件或非 UTF-8 编码（保存会改变编码） */
  readOnly: boolean;
  readOnlyReason?: "large" | "encoding";
  /** 磁盘上的文件已被别处修改，本地修改未保存：需要重新加载，不能直接覆盖 */
  conflict?: string;
  /** 从磁盘重新加载的次数；编辑器据此重建内容模型 */
  revision: number;
}

export interface EditorWorkspaceController {
  /** 当前项目的标签；其他项目的标签保留在内存中，切回该项目时重新显示 */
  tabs: EditorFileTab[];
  activePath: string | null;
  activeTab: EditorFileTab | null;
  dirtyCount: number;
  saving: boolean;
  /** 打开当前项目中的文件：已存在则激活，否则读取完整原文新开标签 */
  openFile: (path: string) => Promise<void>;
  closeTab: (key: string) => void;
  /** 检查点恢复后丢弃该项目的全部缓冲，避免旧内容覆盖恢复后的文件。 */
  resetTabs: (workspace?: string | null) => void;
  setActive: (key: string) => void;
  /** Monaco model → state 单向同步入口（readOnly 文件忽略） */
  updateContent: (key: string, content: string) => void;
  /** Ctrl+S 保存：核对磁盘版本后写回标签所属的项目；版本已变化时标记冲突且不覆盖 */
  saveTab: (key: string) => Promise<boolean>;
  /** 放弃本地修改，从磁盘重新加载 */
  reloadTab: (key: string) => Promise<void>;
  isDirty: (key: string) => boolean;
}

/** 规范化路径分隔符：文件树/工具侧统一以 `/` 存储与通信 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function editorTabKey(workspace: string, path: string): string {
  return `${workspace}\u0000${normalizePath(path)}`;
}

function readOnlyReason(content: string, lossless: boolean): EditorFileTab["readOnlyReason"] {
  if (!lossless) return "encoding";
  return content.length > READ_ONLY_LIMIT_BYTES ? "large" : undefined;
}

export function useEditorWorkspace(workspace: string | null): EditorWorkspaceController {
  const [allTabs, setAllTabs] = useState<EditorFileTab[]>([]);
  /** 各项目各自记住激活的标签 */
  const [activeKeys, setActiveKeys] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  /** 各项目的读取代次：恢复检查点后作废该项目仍在进行的旧读取 */
  const revisionsRef = useRef(new Map<string, number>());
  const tabsRef = useRef(allTabs);
  useEffect(() => {
    tabsRef.current = allTabs;
  }, [allTabs]);

  const tabs = useMemo(
    () => (workspace === null ? [] : allTabs.filter((tab) => tab.workspace === workspace)),
    [allTabs, workspace],
  );

  const activeTab = useMemo(() => {
    if (workspace === null) return null;
    const key = activeKeys[workspace];
    return tabs.find((tab) => tab.key === key) ?? null;
  }, [activeKeys, tabs, workspace]);

  const dirtyCount = useMemo(() => tabs.filter((t) => t.content !== t.savedContent).length, [tabs]);

  const isDirty = useCallback(
    (key: string) => {
      const tab = allTabs.find((t) => t.key === key);
      return tab !== undefined && tab.content !== tab.savedContent;
    },
    [allTabs],
  );

  const activate = useCallback((tabWorkspace: string, key: string | null) => {
    setActiveKeys((current) => {
      const next = { ...current };
      if (key === null) delete next[tabWorkspace];
      else next[tabWorkspace] = key;
      return next;
    });
  }, []);

  /** 从磁盘读取并替换标签内容（丢弃本地修改） */
  const loadFromDisk = useCallback(async (tabWorkspace: string, path: string): Promise<Omit<EditorFileTab, "kind" | "key" | "workspace" | "path" | "revision"> | undefined> => {
    const file = await readWorkspaceFile(tabWorkspace, path);
    if ("error" in file || !file.present) return undefined;
    const reason = readOnlyReason(file.content, file.lossless);
    return {
      content: file.content,
      savedContent: file.content,
      ...(file.digest !== undefined ? { digest: file.digest } : {}),
      bom: file.bom,
      readOnly: reason !== undefined,
      ...(reason !== undefined ? { readOnlyReason: reason } : {}),
    };
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      if (workspace === null) return;
      const tabWorkspace = workspace;
      const revision = revisionsRef.current.get(tabWorkspace) ?? 0;
      const normalized = normalizePath(path);
      const key = editorTabKey(tabWorkspace, normalized);
      activate(tabWorkspace, key);
      if (allTabs.some((t) => t.key === key)) return;

      const loaded = await loadFromDisk(tabWorkspace, normalized);
      if (loaded === undefined || revision !== (revisionsRef.current.get(tabWorkspace) ?? 0)) return;
      setAllTabs((current) => {
        if (current.some((t) => t.key === key)) return current;
        return [...current, { kind: "file" as const, key, workspace: tabWorkspace, path: normalized, revision: 0, ...loaded }];
      });
    },
    [activate, allTabs, loadFromDisk, workspace],
  );

  const closeTab = useCallback(
    (key: string) => {
      const tab = allTabs.find((t) => t.key === key);
      if (tab === undefined) return;
      const siblings = allTabs.filter((t) => t.workspace === tab.workspace);
      const index = siblings.findIndex((t) => t.key === key);
      setAllTabs(allTabs.filter((t) => t.key !== key));
      if (activeKeys[tab.workspace] === key) {
        const remaining = siblings.filter((t) => t.key !== key);
        activate(tab.workspace, remaining[Math.min(index, remaining.length - 1)]?.key ?? null);
      }
    },
    [activate, activeKeys, allTabs],
  );

  const updateContent = useCallback((key: string, content: string) => {
    setAllTabs((current) => {
      const tab = current.find((t) => t.key === key);
      if (tab === undefined || tab.readOnly || tab.content === content) return current;
      return current.map((t) => (t.key === key ? { ...t, content } : t));
    });
  }, []);

  const saveTab = useCallback(
    async (key: string) => {
      const tab = allTabs.find((t) => t.key === key);
      if (tab === undefined || tab.readOnly || tab.conflict !== undefined) return false;

      setSaving(true);
      try {
        const result = await writeWorkspaceFile(tab.workspace, tab.path, tab.content, tab.digest, tab.bom);
        if (!result.ok) {
          if (result.conflict) {
            setAllTabs((current) => current.map((t) => (t.key === key ? { ...t, conflict: result.error } : t)));
          }
          return false;
        }
        setAllTabs((current) => current.map((t) => {
          if (t.key !== key) return t;
          const next = { ...t, savedContent: tab.content };
          if (result.digest !== null) next.digest = result.digest;
          return next;
        }));
        emitWorkspaceFilesChanged({ workspace: tab.workspace, paths: [tab.path] });
        return true;
      } finally {
        setSaving(false);
      }
    },
    [allTabs],
  );

  const reloadTab = useCallback(
    async (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (tab === undefined) return;
      const loaded = await loadFromDisk(tab.workspace, tab.path);
      setAllTabs((current) => {
        if (loaded === undefined) return current.filter((t) => t.key !== key);
        return current.map((t) => {
          if (t.key !== key) return t;
          const next: EditorFileTab = { kind: "file", key: t.key, workspace: t.workspace, path: t.path, revision: t.revision + 1, ...loaded };
          return next;
        });
      });
    },
    [loadFromDisk],
  );

  // 文件在别处被修改（撤销任务改动、恢复检查点等）：未修改的标签直接重新加载，
  // 有未保存修改的标签标记冲突，不替换用户正在编辑的内容
  useEffect(() => subscribeWorkspaceFilesChanged((event) => {
    for (const tab of tabsRef.current) {
      if (tab.workspace !== event.workspace) continue;
      if (event.paths !== undefined && !event.paths.includes(tab.path)) continue;
      if (tab.content === tab.savedContent) {
        void reloadTab(tab.key);
      } else {
        void readWorkspaceFile(tab.workspace, tab.path).then((file) => {
          if ("error" in file || file.digest === tab.digest) return;
          setAllTabs((current) => current.map((t) => (t.key === tab.key ? { ...t, conflict: "文件已在别处被修改，本地修改尚未保存。" } : t)));
        });
      }
    }
  }), [reloadTab]);

  const setActive = useCallback(
    (key: string) => {
      const tab = allTabs.find((t) => t.key === key);
      if (tab !== undefined) activate(tab.workspace, key);
    },
    [activate, allTabs],
  );

  const resetTabs = useCallback(
    (target: string | null = workspace) => {
      if (target === null) return;
      revisionsRef.current.set(target, (revisionsRef.current.get(target) ?? 0) + 1);
      setAllTabs((current) => current.filter((t) => t.workspace !== target));
      activate(target, null);
    },
    [activate, workspace],
  );

  return {
    tabs,
    activePath: activeTab?.path ?? null,
    activeTab,
    dirtyCount,
    saving,
    openFile,
    closeTab,
    resetTabs,
    setActive,
    updateContent,
    saveTab,
    reloadTab,
    isDirty,
  };
}
