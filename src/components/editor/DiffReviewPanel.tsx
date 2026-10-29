import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitCompareArrows, Info, Loader2 } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { executeDesktopAgentTool, readHeadFile, readWorkspaceFile } from "../../services/desktop-bridge";
import { subscribeWorkspaceFilesChanged } from "../../services/workspace-events";
import { parseGitStatusShort, toReviewHunks, type GitChangeEntry, type ReviewHunk } from "./diff-merge";
import { languageForPath } from "./editor-language";
import { editorThemeFor, loadMonaco } from "./monaco-loader";

type DiffEditor = import("monaco-editor").editor.IStandaloneDiffEditor;
type DiffModelPair = { original: import("monaco-editor").editor.ITextModel; modified: import("monaco-editor").editor.ITextModel };

export interface DiffReviewPanelProps {
  /** 审阅的项目；切换项目时由父组件以 key 重挂载，避免同名相对路径串到另一个项目 */
  workspace: string;
  copy?: UiCopy;
  resolvedTheme: "light" | "dark";
  refreshKey?: number;
}

function statusBadgeClass(status: GitChangeEntry["status"]): string {
  if (status === "added") return "review-file__badge--added";
  if (status === "deleted") return "review-file__badge--deleted";
  return "review-file__badge--modified";
}

function statusBadgeText(status: GitChangeEntry["status"]): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

/**
 * 工作区相对 Git HEAD 的全部未提交改动，只读。
 * 其中可能混有任务开始前用户自己的改动，所以这里不提供写回；撤销 Agent 的改动走“本次任务”审阅。
 */
export function DiffReviewPanel({ workspace, copy, resolvedTheme, refreshKey: externalRefreshKey }: DiffReviewPanelProps) {
  const [changes, setChanges] = useState<GitChangeEntry[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [hunks, setHunks] = useState<ReviewHunk[]>([]);
  const [mode, setMode] = useState<"cards" | "compare">("cards");
  const [loadingFile, setLoadingFile] = useState(false);
  const [internalRefreshKey, setInternalRefreshKey] = useState(0);
  const refreshKey = (externalRefreshKey ?? 0) + internalRefreshKey;

  const panelRef = useRef<HTMLElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [isFilesCollapsed, setIsFilesCollapsed] = useState(false);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompact(entry.contentRect.width < 640);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selected = changes?.find((c) => c.path === selectedPath) ?? null;

  // 保存、撤销任务改动或恢复检查点后重新读取
  useEffect(() => subscribeWorkspaceFilesChanged((event) => {
    if (event.workspace === workspace) setInternalRefreshKey((key) => key + 1);
  }), [workspace]);

  /* ── 变更列表：git status → 结构化条目 ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await executeDesktopAgentTool("git_status", {}, workspace);
      if (cancelled) return;
      const parsed = res.isError ? [] : parseGitStatusShort(res.output);
      setChanges(parsed);
      setSelectedPath((prev) => {
        if (prev !== null && parsed.some((c) => c.path === prev)) return prev;
        return parsed[0]?.path ?? null;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, workspace]);

  /* ── 选中文件：HEAD 基线 + 工作区原文 → hunks ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (selectedPath === null) {
        setOriginal("");
        setModified("");
        setHunks([]);
        setLoadingFile(false);
        return;
      }

      setLoadingFile(true);
      const head =
        selected?.status === "added"
          ? { present: false, content: "" }
          : await readHeadFile(workspace, selectedPath);
      const work = selected?.status === "deleted" ? undefined : await readWorkspaceFile(workspace, selectedPath);
      if (cancelled) return;

      const orig = head?.present === true ? head.content : "";
      const mod = work !== undefined && !("error" in work) && work.present ? work.content : "";
      setOriginal(orig);
      setModified(mod);
      setHunks(toReviewHunks(orig, mod));
      setLoadingFile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPath, selected?.status, refreshKey, workspace]);

  /* ── 对比模式：Monaco DiffEditor（只读并排） ── */
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<DiffEditor | null>(null);
  const diffModelsRef = useRef<DiffModelPair | null>(null);

  useEffect(() => {
    if (mode !== "compare") return;
    let disposed = false;
    void loadMonaco().then((monaco) => {
      if (disposed || !diffContainerRef.current) return;

      // 主题走全局 setTheme（updateOptions 的类型不接受 theme；主题注册于 monaco-loader）
      monaco.editor.setTheme(editorThemeFor(resolvedTheme));

      let editor = diffEditorRef.current;
      if (editor === null) {
        editor = monaco.editor.createDiffEditor(diffContainerRef.current, {
          readOnly: true,
          renderSideBySide: true,
          automaticLayout: true,
          fontSize: 12,
          renderOverviewRuler: false,
          originalEditable: false,
          scrollBeyondLastLine: false,
        });
        diffEditorRef.current = editor;
      }

      // 全量替换 model（旧 pair 显式释放，避免泄漏）
      diffModelsRef.current?.original.dispose();
      diffModelsRef.current?.modified.dispose();
      const lang = languageForPath(selectedPath ?? "");
      diffModelsRef.current = {
        original: monaco.editor.createModel(original, lang),
        modified: monaco.editor.createModel(modified, lang),
      };
      editor.setModel(diffModelsRef.current);
    });
    return () => {
      disposed = true;
    };
  }, [mode, original, modified, selectedPath, resolvedTheme]);

  // 卸载销毁 diff editor 与 model
  useEffect(() => {
    return () => {
      diffModelsRef.current?.original.dispose();
      diffModelsRef.current?.modified.dispose();
      diffModelsRef.current = null;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
    };
  }, []);

  if (changes?.length === 0) {
    return (
      <section className="review-panel review-panel--empty" aria-label={copy?.reviewGitTitle ?? "工作区差异（相对 HEAD）"}>
        <div className="review-empty-state">
          <GitCompareArrows size={36} className="review-empty-icon" />
          <h3 className="review-empty-title">{copy?.reviewEmptyTitle ?? "没有未提交的改动"}</h3>
          <p className="review-empty-desc">
            {copy?.reviewEmptyDesc ?? "Agent 修改项目内的文件后，改动会显示在这里"}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section ref={panelRef} className={`review-panel ${isCompact ? "review-panel--compact" : ""}`} aria-label={copy?.reviewGitTitle ?? "工作区差异（相对 HEAD）"}>
      <div className="review-panel__toolbar">
        <span className="review-panel__title">
          <GitCompareArrows size={15} />
          {copy?.reviewGitTitle ?? "工作区差异（相对 HEAD）"}
          {changes !== null ? (
            <span className="review-panel__count">{changes.length}</span>
          ) : null}
        </span>

        <div className="review-panel__modes" role="tablist">
          <button
            type="button"
            className={`review-mode-btn ${mode === "cards" ? "review-mode-btn--active" : ""}`}
            onClick={() => setMode("cards")}
          >
            {copy?.reviewCards ?? "卡片"}
          </button>
          <button
            type="button"
            className={`review-mode-btn ${mode === "compare" ? "review-mode-btn--active" : ""}`}
            onClick={() => setMode("compare")}
          >
            {copy?.reviewCompare ?? "对比"}
          </button>
        </div>

      </div>

      <p className="task-review__notice task-review__notice--info">
        <Info size={12} />
        <span>{copy?.reviewGitReadOnlyNote ?? "只读：包含任务开始前就有的改动。要撤销 Agent 的改动，请在“本次任务”中操作。"}</span>
      </p>

      <div className="review-panel__body">
        {/* 变更文件列表 */}
        {isCompact ? (
          <div className="review-files-collapsible">
            <button
              type="button"
              className="review-files-collapsible__trigger"
              onClick={() => setIsFilesCollapsed((v) => !v)}
              aria-expanded={!isFilesCollapsed}
            >
              <ChevronDown
                size={13}
                className={`review-files-collapsible__caret ${isFilesCollapsed ? "review-files-collapsible__caret--collapsed" : ""}`}
              />
              <span className="review-files-collapsible__title">
                {copy?.reviewFilesLabel ?? "变更文件"} ({changes?.length ?? 0})
              </span>
              {selectedPath ? (
                <span className="review-files-collapsible__selected" title={selectedPath}>
                  {selectedPath}
                </span>
              ) : null}
            </button>
            {!isFilesCollapsed ? (
              <div className="review-files review-files--compact">
                {changes === null ? (
                  <p className="review-files__hint">
                    <Loader2 size={12} className="review-spin" /> …
                  </p>
                ) : changes.length === 0 ? (
                  <p className="review-files__hint">{copy?.reviewEmpty ?? "工作区无未提交变更"}</p>
                ) : (
                  changes.map((change) => (
                    <button
                      key={change.path}
                      type="button"
                      className={`review-file ${change.path === selectedPath ? "review-file--active" : ""}`}
                      onClick={() => setSelectedPath(change.path)}
                      title={change.path}
                    >
                      <span className={`review-file__badge ${statusBadgeClass(change.status)}`}>
                        {statusBadgeText(change.status)}
                      </span>
                      <span className="review-file__path">{change.path}</span>
                      {change.status !== "modified" ? (
                        <span className="review-file__note">
                          {change.status === "added"
                            ? copy?.reviewAddedNote ?? "未跟踪的新文件"
                            : copy?.reviewDeletedNote ?? "已删除"}
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="review-files">
            <p className="review-files__label">{copy?.reviewFilesLabel ?? "变更文件"}</p>
            {changes === null ? (
              <p className="review-files__hint">
                <Loader2 size={12} className="review-spin" /> …
              </p>
            ) : changes.length === 0 ? (
              <p className="review-files__hint">{copy?.reviewEmpty ?? "工作区无未提交变更"}</p>
            ) : (
              changes.map((change) => (
                <button
                  key={change.path}
                  type="button"
                  className={`review-file ${change.path === selectedPath ? "review-file--active" : ""}`}
                  onClick={() => setSelectedPath(change.path)}
                  title={change.path}
                >
                  <span className={`review-file__badge ${statusBadgeClass(change.status)}`}>
                    {statusBadgeText(change.status)}
                  </span>
                  <span className="review-file__path">{change.path}</span>
                  {change.status !== "modified" ? (
                    <span className="review-file__note">
                      {change.status === "added"
                        ? copy?.reviewAddedNote ?? "未跟踪的新文件"
                        : copy?.reviewDeletedNote ?? "已删除"}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        )}

        {/* 差异区 */}
        <div className="review-content">
          {loadingFile ? (
            <div className="review-content__loading">
              <Loader2 size={16} className="review-spin" />
            </div>
          ) : selectedPath === null ? (
            <div className="review-content__placeholder">
              {copy?.reviewNoSelection ?? "选择左侧变更文件查看差异"}
            </div>
          ) : hunks.length === 0 ? (
            <div className="review-content__placeholder">
              {copy?.reviewDiffEmpty ?? "与 HEAD 无内容差异"}
            </div>
          ) : mode === "cards" ? (
            <div className="review-hunks">
              {hunks.map((hunk) => {
                let oldLine = hunk.oldStart;
                let newLine = hunk.newStart;
                return (
                  <article key={`${hunk.oldStart}-${hunk.newStart}`} className="review-hunk">
                    <header className="review-hunk__head">
                      <span className="review-hunk__range">
                        @@ -{hunk.oldStart} +{hunk.newStart} @@
                      </span>
                    </header>
                    <div className="review-hunk__lines">
                      {hunk.lines.map((line, lineIndex) => {
                        const oldNo = line.type === "add" ? null : oldLine;
                        const newNo = line.type === "del" ? null : newLine;
                        if (line.type !== "add") oldLine += 1;
                        if (line.type !== "del") newLine += 1;
                        return (
                          <div key={lineIndex} className={`review-line review-line--${line.type}`}>
                            <i>{oldNo ?? ""}</i>
                            <i>{newNo ?? ""}</i>
                            <code>{line.text}</code>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div ref={diffContainerRef} className="review-compare" />
          )}
        </div>
      </div>
    </section>
  );
}
