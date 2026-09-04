import { useEffect, useRef, useState } from "react";
import { FileCode, GitCompareArrows, Save, X } from "lucide-react";
import type { EditorWorkspaceController } from "../../app/use-editor-workspace";
import type { UiCopy } from "../../i18n/messages";
import { DiffReviewPanel } from "./DiffReviewPanel";
import { languageForPath } from "./editor-language";
import { editorThemeFor, loadMonaco } from "./monaco-loader";

type CodeEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type TextModel = import("monaco-editor").editor.ITextModel;
type MonacoNamespace = typeof import("monaco-editor");

export interface EditorViewProps {
  workspace: EditorWorkspaceController;
  copy?: UiCopy;
  resolvedTheme: "light" | "dark";
  /** 隐藏但保持 Monaco 实例与 model 缓存（中栏视图切换不卸载编辑器） */
  hidden?: boolean;
  /** 变更审阅 tab 激活态（受控；激活时以 DiffReviewPanel 替代 Monaco 区域） */
  reviewActive?: boolean;
  onReviewActiveChange?: (active: boolean) => void;
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
  reviewActive = false,
  onReviewActiveChange,
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

    return () => {
      disposed = true;
      for (const model of modelsRef.current.values()) model.dispose();
      modelsRef.current.clear();
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
    <section className={`editor-view ${hidden ? "editor-view--hidden" : ""}`} aria-label="代码编辑器">
      <div className="editor-view__tabs" role="tablist">
        {workspace.tabs.map((tab) => {
          const dirty = tab.content !== tab.savedContent;
          return (
            <button
              key={tab.path}
              type="button"
              role="tab"
              aria-selected={tab.path === workspace.activePath}
              className={`editor-tab ${tab.path === workspace.activePath && !reviewActive ? "editor-tab--active" : ""}`}
              onClick={() => {
                workspace.setActive(tab.path);
                onReviewActiveChange?.(false);
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
        {workspace.tabs.length === 0 && !reviewActive ? (
          <p className="editor-view__empty">{copy?.editorTabEmpty ?? "从右侧文件树选择文件打开"}</p>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={reviewActive}
          className={`editor-tab editor-tab--review ${reviewActive ? "editor-tab--active" : ""}`}
          onClick={() => onReviewActiveChange?.(!reviewActive)}
        >
          <GitCompareArrows size={13} className="editor-tab__icon" />
          <span className="editor-tab__name">{copy?.reviewTitle ?? "变更审阅"}</span>
        </button>
      </div>

      <div className={`editor-view__body ${reviewActive ? "editor-view__body--review" : ""}`}>
        <div ref={containerRef} className="editor-view__monaco" />
        {reviewActive ? <DiffReviewPanel copy={copy} resolvedTheme={resolvedTheme} /> : null}
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
    </section>
  );
}
