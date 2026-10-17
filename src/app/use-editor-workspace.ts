import { useCallback, useMemo, useRef, useState } from "react";
import { executeDesktopAgentTool } from "../services/desktop-bridge";

/** 超过该体积的文件以只读打开，避免 Monaco 大文档卡顿（1MB） */
const READ_ONLY_LIMIT_BYTES = 1024 * 1024;

export interface EditorFileTab {
  kind: "file";
  /** 工作区相对路径，统一 `/` 分隔 */
  path: string;
  /** 编辑器当前内容（model 变更时同步） */
  content: string;
  /** 上次保存（或读盘）内容；dirty = content !== savedContent */
  savedContent: string;
  /** 大文件只读标记 */
  readOnly: boolean;
}

export interface EditorWorkspaceController {
  tabs: EditorFileTab[];
  activePath: string | null;
  activeTab: EditorFileTab | null;
  dirtyCount: number;
  saving: boolean;
  /** 打开文件：已存在则激活，否则 read_file 拉取内容新开 tab */
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  /** 检查点恢复后丢弃全部缓冲，避免旧内容覆盖恢复后的文件。 */
  resetTabs: () => void;
  setActive: (path: string) => void;
  /** Monaco model → state 单向同步入口（readOnly 文件忽略） */
  updateContent: (path: string, content: string) => void;
  /** Ctrl+S 保存：经 write_file 工具写回（Rust 侧自动 checkpoint 备份） */
  saveTab: (path: string) => Promise<boolean>;
  isDirty: (path: string) => boolean;
}

/** 规范化路径分隔符：文件树/工具侧统一以 `/` 存储与通信 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function useEditorWorkspace(): EditorWorkspaceController {
  const [tabs, setTabs] = useState<EditorFileTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const revisionRef = useRef(0);

  const activeTab = useMemo(
    () => tabs.find((t) => t.path === activePath) ?? null,
    [tabs, activePath],
  );

  const dirtyCount = useMemo(
    () => tabs.filter((t) => t.content !== t.savedContent).length,
    [tabs],
  );

  const isDirty = useCallback(
    (path: string) => {
      const tab = tabs.find((t) => t.path === path);
      return tab !== undefined && tab.content !== tab.savedContent;
    },
    [tabs],
  );

  const openFile = useCallback(
    async (path: string) => {
      const revision = revisionRef.current;
      const normalized = normalizePath(path);
      setActivePath(normalized);
      if (tabs.some((t) => t.path === normalized)) return;

      const res = await executeDesktopAgentTool("read_file", { path: normalized });
      if (res.isError || revision !== revisionRef.current) return;

      const content = res.output;
      const readOnly = content.length > READ_ONLY_LIMIT_BYTES;
      setTabs((current) => {
        if (current.some((t) => t.path === normalized)) return current;
        return [
          ...current,
          { kind: "file" as const, path: normalized, content, savedContent: content, readOnly },
        ];
      });
    },
    [tabs],
  );

  const closeTab = useCallback(
    (path: string) => {
      const index = tabs.findIndex((t) => t.path === path);
      if (index < 0) return;
      const next = tabs.filter((t) => t.path !== path);
      setTabs(next);
      if (activePath === path) {
        const fallback = next[Math.min(index, next.length - 1)];
        setActivePath(fallback?.path ?? null);
      }
    },
    [tabs, activePath],
  );

  const updateContent = useCallback((path: string, content: string) => {
    setTabs((current) => {
      const tab = current.find((t) => t.path === path);
      if (tab === undefined || tab.readOnly || tab.content === content) return current;
      return current.map((t) => (t.path === path ? { ...t, content } : t));
    });
  }, []);

  const saveTab = useCallback(
    async (path: string) => {
      const tab = tabs.find((t) => t.path === path);
      if (tab === undefined || tab.readOnly) return false;

      setSaving(true);
      try {
        const res = await executeDesktopAgentTool("write_file", {
          path: tab.path,
          content: tab.content,
        });
        if (res.isError) return false;
        setTabs((current) =>
          current.map((t) => (t.path === path ? { ...t, savedContent: t.content } : t)),
        );
        return true;
      } finally {
        setSaving(false);
      }
    },
    [tabs],
  );

  const setActive = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const resetTabs = useCallback(() => {
    revisionRef.current += 1;
    setTabs([]);
    setActivePath(null);
  }, []);

  return {
    tabs,
    activePath,
    activeTab,
    dirtyCount,
    saving,
    openFile,
    closeTab,
    resetTabs,
    setActive,
    updateContent,
    saveTab,
    isDirty,
  };
}
