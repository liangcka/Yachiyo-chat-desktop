import { useCallback, useEffect, useRef, useState } from "react";
import {
  Code2,
  FileCode,
  Folder,
  FolderPlus,
  GitCompareArrows,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import type { EditorWorkspaceController } from "../../app/use-editor-workspace";
import { useLocale } from "../../i18n/locale-context";
import type { UiCopy } from "../../i18n/messages";
import { languageForPath } from "./editor-language";
import { editorThemeFor, loadMonaco } from "./monaco-loader";
import { FileTree } from "../desktop/FileTree";
import { projectManager, useProjectState } from "../../services/project-manager";

type CodeEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type TextModel = import("monaco-editor").editor.ITextModel;
type MonacoNamespace = typeof import("monaco-editor");

const STORAGE_EDITOR_SIDEBAR_COLLAPSED = "yachiyo-editor-sidebar-collapsed";

function readStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_EDITOR_SIDEBAR_COLLAPSED) === "true";
  } catch {
    return false;
  }
}

function writeStoredSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_EDITOR_SIDEBAR_COLLAPSED, String(collapsed));
  } catch {
    /* 隐私模式静默降级 */
  }
}

function getWorkspaceName(root: string): string {
  if (!root) return "工作区";
  const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export interface EditorViewProps {
  workspace: EditorWorkspaceController;
  copy?: UiCopy;
  resolvedTheme: "light" | "dark";
  /** 隐藏但保持 Monaco 实例与 model 缓存（中栏视图切换不卸载编辑器） */
  hidden?: boolean;
  /** 点击顶部变更审阅标签：直接打开右侧面板的代码审阅标签 */
  onOpenReview?: () => void;
}

/** 文件名 basename 显示 */
function baseName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function EditorView({
  workspace,
  copy,
  resolvedTheme,
  hidden = false,
  onOpenReview,
}: EditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const modelsRef = useRef(new Map<string, TextModel>());

  // 保存/激活的最新引用：Monaco addCommand 闭包经 ref 取最新值，避免闭包过期（同步收敛在 effect，渲染期不触碰 ref）
  const workspaceRef = useRef(workspace);
  const activePathRef = useRef(workspace.activePath);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    activePathRef.current = workspace.activePath;
  }, [workspace.activePath]);

  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const { activeProject } = useProjectState();
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  const isJa = useLocale() === "ja-JP";

  const toggleSidebar = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    writeStoredSidebarCollapsed(collapsed);
  }, []);

  const refreshTree = useCallback(() => {
    setTreeRefreshKey((k) => k + 1);
  }, []);

  const handlePickFolder = useCallback(async () => {
    const picked = await projectManager.pickAndOpenProject("Open workspace");
    if (picked) {
      refreshTree();
    }
  }, [refreshTree]);

  /* ── editor 实例生命周期：懒加载 Monaco、Ctrl+S、光标追踪 ── */
  useEffect(() => {
    let disposed = false;
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      monacoRef.current = monaco;

      const editor = monaco.editor.create(containerRef.current, {
        theme: editorThemeFor(resolvedTheme),
        automaticLayout: true,
        fontSize: 13,
        lineHeight: 22,
        scrollBeyondLastLine: false,
        minimap: { enabled: true },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        padding: { top: 10, bottom: 12 },
      });
      editorRef.current = editor;
      setReady(true);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const path = activePathRef.current;
        if (path !== null) void workspaceRef.current.saveTab(path);
      });

      editor.onDidChangeCursorPosition((e) => {
        setCursor({ line: e.position.lineNumber, column: e.position.column });
      });
    });

    const models = modelsRef.current;

    return () => {
      disposed = true;
      for (const model of models.values()) model.dispose();
      models.clear();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // 主题初始化仅一次；后续切换由独立 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 主题切换 ── */
  useEffect(() => {
    void loadMonaco().then((monaco) => {
      monaco.editor.setTheme(editorThemeFor(resolvedTheme));
    });
  }, [resolvedTheme]);

  /* ── model 同步：为新增 tab 建 model、为已关 tab 释放 model ── */
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !ready) return;

    for (const tab of workspace.tabs) {
      if (modelsRef.current.has(tab.path)) continue;
      const model = monaco.editor.createModel(tab.content, languageForPath(tab.path));
      // model → state 单向同步：仅用户编辑触发，state 侧不回写 model
      model.onDidChangeContent(() => {
        workspaceRef.current.updateContent(tab.path, model.getValue());
      });
      modelsRef.current.set(tab.path, model);
    }

    const livePaths = new Set(workspace.tabs.map((t) => t.path));
    for (const [path, model] of modelsRef.current) {
      if (!livePaths.has(path)) {
        model.dispose();
        modelsRef.current.delete(path);
      }
    }
  }, [workspace.tabs, ready]);

  /* ── 激活 tab：切换 model 与只读态 ── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    const model = workspace.activePath !== null
      ? modelsRef.current.get(workspace.activePath)
      : undefined;
    editor.setModel(model ?? null);
    editor.updateOptions({ readOnly: workspace.activeTab?.readOnly ?? false });
  }, [workspace.activePath, workspace.activeTab?.readOnly, ready]);

  const activeTab = workspace.activeTab;

  return (
    <section className={`editor-view ${hidden ? "editor-view--hidden" : ""}`} aria-label={isJa ? "コードエディター" : "代码编辑器"}>
      <div className="editor-view__container">
        {/* 左侧轻量工作区文件树侧栏 */}
        {!sidebarCollapsed ? (
          <aside className="editor-view__sidebar" aria-label={isJa ? "ワークスペースのファイル" : "工作区文件浏览"}>
            <div className="editor-sidebar__header">
              <div className="editor-sidebar__title" title={activeProject || (isJa ? "ワークスペース" : "工作区")}>
                <Folder size={14} className="editor-sidebar__folder-icon" />
                <span className="editor-sidebar__name">{activeProject ? getWorkspaceName(activeProject) : (isJa ? "ワークスペース" : "工作区")}</span>
              </div>
              <div className="editor-sidebar__actions">
                {activeProject ? (
                  <button
                    type="button"
                    className="editor-sidebar__btn"
                    onClick={refreshTree}
                    title={copy?.refreshFileTree ?? "刷新文件树"}
                  >
                    <RefreshCw size={13} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="editor-sidebar__btn"
                  onClick={() => void handlePickFolder()}
                  title={isJa ? "プロジェクトを開く" : "打开工作区文件夹"}
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  type="button"
                  className="editor-sidebar__btn"
                  onClick={() => toggleSidebar(true)}
                  title={isJa ? "ファイルツリーを折りたたむ" : "折叠文件树侧栏"}
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>
            </div>
            <div className="editor-sidebar__tree">
              {activeProject ? (
                <FileTree
                  key={`${activeProject}-${treeRefreshKey}`}
                  copy={copy}
                  activePath={workspace.activePath}
                  onOpenFile={(path) => {
                    void workspace.openFile(path);
                  }}
                />
              ) : (
                <div className="editor-sidebar__empty">
                  <p className="editor-sidebar__empty-text">{isJa ? "プロジェクト未選択" : "未选择项目"}</p>
                  <button
                    type="button"
                    className="editor-sidebar__empty-btn"
                    onClick={() => void handlePickFolder()}
                  >
                    <FolderPlus size={13} />
                    <span>{isJa ? "プロジェクトを選択" : "选择项目"}</span>
                  </button>
                </div>
              )}
            </div>
          </aside>
        ) : null}

        {/* 右侧主编辑区 */}
        <div className="editor-view__main">
          <div className="editor-view__tabs" role="tablist">
            {sidebarCollapsed ? (
              <button
                type="button"
                className="editor-tab editor-tab--sidebar-toggle"
                onClick={() => toggleSidebar(false)}
                title={isJa ? "ファイルツリーを展開" : "展开工作区文件树"}
                aria-label={isJa ? "ファイルツリーを展開" : "展开工作区文件树"}
              >
                <PanelLeft size={13} />
              </button>
            ) : null}

            {workspace.tabs.map((tab) => {
              const dirty = tab.content !== tab.savedContent;
              return (
                <button
                  key={tab.path}
                  type="button"
                  role="tab"
                  aria-selected={tab.path === workspace.activePath}
                  className={`editor-tab ${tab.path === workspace.activePath ? "editor-tab--active" : ""}`}
                  onClick={() => {
                    workspace.setActive(tab.path);
                  }}
                  title={tab.path}
                >
                  {dirty ? <span className="editor-tab__dirty-dot" aria-label={copy?.editorModified ?? "未保存"} /> : null}
                  <FileCode size={13} className="editor-tab__icon" />
                  <span className="editor-tab__name">{baseName(tab.path)}</span>
                  <span
                    className="editor-tab__close"
                    role="button"
                    tabIndex={0}
                    aria-label={copy?.editorCloseTab ?? "关闭标签页"}
                    onClick={(e) => {
                      e.stopPropagation();
                      workspace.closeTab(tab.path);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        workspace.closeTab(tab.path);
                      }
                    }}
                  >
                    <X size={11} />
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              role="tab"
              aria-selected={false}
              className="editor-tab editor-tab--review"
              onClick={onOpenReview}
              title={copy?.reviewTitle ?? "变更审阅"}
            >
              <GitCompareArrows size={13} className="editor-tab__icon" />
              <span className="editor-tab__name">{copy?.reviewTitle ?? "变更审阅"}</span>
            </button>
          </div>

          <div className="editor-view__body">
            <div
              ref={containerRef}
              className="editor-view__monaco"
              style={{ display: workspace.tabs.length === 0 ? "none" : "block" }}
            />
            {workspace.tabs.length === 0 ? (
              <div className="editor-view__empty-state">
                <Code2 size={40} className="editor-view__empty-icon" />
                <h3 className="editor-view__empty-title">{isJa ? "ワークスペースのコードエディター" : "工作区代码编辑器"}</h3>
                <p className="editor-view__empty-desc">
                  {activeProject
                    ? (isJa ? "左側のファイルツリーからファイルを選択して開く" : "从左侧选择文件打开")
                    : (isJa ? "プロジェクトフォルダを開いて開発を開始してください。" : "从左侧文件树直接选择并打开代码文件，或点击下方打开本地文件夹开启工程开发。")}
                </p>
                {!activeProject ? (
                  <button
                    type="button"
                    className="editor-view__empty-btn"
                    onClick={() => void handlePickFolder()}
                  >
                    <FolderPlus size={14} />
                    <span>{isJa ? "プロジェクトを開く" : "打开工作区文件夹"}</span>
                  </button>
                ) : null}
                <div className="editor-view__empty-hints">
                  <span>Ctrl+S 保存</span>
                  <span>•</span>
                  <span>{isJa ? "Ctrl+1 会話" : "Ctrl+1 对话"}</span>
                  <span>•</span>
                  <span>{isJa ? "Ctrl+2 エディター" : "Ctrl+2 编辑器"}</span>
                </div>
              </div>
            ) : null}
          </div>

          <footer className="editor-view__statusbar">
            <span className="editor-status__item editor-status__item--path" title={activeTab?.path ?? ""}>
              {activeTab?.path ?? "—"}
            </span>
            <span className="editor-status__item">
              {activeTab ? languageForPath(activeTab.path) : "—"}
            </span>
            <span className="editor-status__item">
              Ln {cursor.line}, Col {cursor.column}
            </span>
            {activeTab?.readOnly ? (
              <span className="editor-status__item editor-status__item--warn">
                {copy?.editorReadOnly ?? "只读（大文件）"}
              </span>
            ) : (
              <span className={`editor-status__item ${activeTab && activeTab.content !== activeTab.savedContent ? "editor-status__item--warn" : ""}`}>
                {workspace.saving
                  ? copy?.editorSaving ?? "保存中…"
                  : activeTab && activeTab.content !== activeTab.savedContent
                    ? copy?.editorModified ?? "● 已修改"
                    : copy?.editorSaved ?? "已保存"}
              </span>
            )}
            <span className="editor-status__item editor-status__item--hint">
              <Save size={11} />
              {copy?.editorSaveHint ?? "Ctrl+S 保存（write_file + checkpoint）"}
            </span>
          </footer>
        </div>
      </div>
    </section>
  );
}
