import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, GitCompareArrows, Loader2, RefreshCw, X } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { executeDesktopAgentTool, readHeadFile } from "../../services/desktop-bridge";
import {
  applySelectedHunks,
  parseGitStatusShort,
  toReviewHunks,
  type GitChangeEntry,
  type ReviewHunk,
} from "./diff-merge";
import { languageForPath } from "./editor-language";
import { editorThemeFor, loadMonaco } from "./monaco-loader";

type DiffEditor = import("monaco-editor").editor.IStandaloneDiffEditor;
type DiffModelPair = { original: import("monaco-editor").editor.ITextModel; modified: import("monaco-editor").editor.ITextModel };

type HunkDecision = "pending" | "accepted" | "rejected";

export interface DiffReviewPanelProps {
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
  if (status === "added") return "?";
  if (status === "deleted") return "D";
  return "M";
}

export function DiffReviewPanel({ copy, resolvedTheme, refreshKey: externalRefreshKey }: DiffReviewPanelProps) {
  const [changes, setChanges] = useState<GitChangeEntry[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [hunks, setHunks] = useState<ReviewHunk[]>([]);
  const [decisions, setDecisions] = useState<HunkDecision[]>([]);
  const [mode, setMode] = useState<"cards" | "compare">("cards");
  const [loadingFile, setLoadingFile] = useState(false);
  const [applying, setApplying] = useState(false);
  const [internalRefreshKey, setInternalRefreshKey] = useState(0);
  const refreshKey = (externalRefreshKey ?? 0) + internalRefreshKey;

  const selected = changes?.find((c) => c.path === selectedPath) ?? null;
  const anyAccepted = decisions.some((d) => d === "accepted");

  /* ── 变更列表：git status → 结构化条目 ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await executeDesktopAgentTool("git_status", {});
      if (cancelled) return;
      const parsed = res.isError ? [] : parseGitStatusShort(res.output);
      setChanges(parsed);
      setSelectedPath((prev) => {
        if (prev !== null && parsed.some((c) => c.path === prev)) return prev;
        return parsed.find((c) => c.status !== "deleted")?.path ?? null;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  /* ── 选中文件：HEAD 基线 + 工作区内容 → hunks ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (selectedPath === null || selected?.status === "deleted") {
        setOriginal("");
        setModified("");
        setHunks([]);
        setDecisions([]);
        setLoadingFile(false);
        return;
      }

      setLoadingFile(true);
      const head =
        selected?.status === "added"
          ? { present: false, content: "" }
          : await readHeadFile(selectedPath);
      const work = await executeDesktopAgentTool("read_file", { path: selectedPath });
      if (cancelled) return;

      const orig = head?.present === true ? head.content : "";
      const mod = work.isError ? "" : work.output;
      setOriginal(orig);
      setModified(mod);
      const next = toReviewHunks(orig, mod);
      setHunks(next);
      setDecisions(next.map(() => "pending" as HunkDecision));
      setLoadingFile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPath, selected?.status, refreshKey]);

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

  const setDecision = useCallback((index: number, decision: HunkDecision) => {
    setDecisions((current) =>
      current.map((d, i) => (i === index ? (d === decision ? "pending" : decision) : d)),
    );
  }, []);

  const resetDecisions = useCallback(() => {
    setDecisions((current) => current.map(() => "pending" as HunkDecision));
  }, []);

  /** 应用采纳：仅 modified 文件可写回（added 仅查看、deleted 不可恢复）；写回走 write_file 自动 checkpoint */
  const handleApply = useCallback(async () => {
    if (selectedPath === null || selected?.status !== "modified" || !anyAccepted || applying) return;
    setApplying(true);
    try {
      const merged = applySelectedHunks(
        original,
        hunks,
        decisions.map((d) => d === "accepted"),
      );
      const res = await executeDesktopAgentTool("write_file", { path: selectedPath, content: merged });
      if (!res.isError) {
        setInternalRefreshKey((key) => key + 1);
      }
    } finally {
      setApplying(false);
    }
  }, [selectedPath, selected?.status, anyAccepted, applying, original, hunks, decisions]);

  const isModifiable = selected?.status === "modified";

  if (changes?.length === 0) {
    return (
      <section className="review-panel review-panel--empty" aria-label="变更审阅">
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
    <section className="review-panel" aria-label="变更审阅">
      <div className="review-panel__toolbar">
        <span className="review-panel__title">
          <GitCompareArrows size={15} />
          {copy?.reviewTitle ?? "变更审阅"}
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

        <div className="review-panel__actions">
          <button
            type="button"
            className="review-ghost-btn"
            onClick={resetDecisions}
            disabled={decisions.length === 0 || decisions.every((d) => d === "pending")}
          >
            {copy?.reviewResetAll ?? "全部重置"}
          </button>
          <button
            type="button"
            className="review-primary-btn"
            onClick={() => void handleApply()}
            disabled={!isModifiable || !anyAccepted || applying}
          >
            {applying ? <Loader2 size={12} className="review-spin" /> : <Check size={12} />}
            {copy?.reviewApply ?? "应用采纳"}
          </button>
          <button
            type="button"
            className="review-ghost-btn review-ghost-btn--icon"
            onClick={() => setInternalRefreshKey((key) => key + 1)}
            title={copy?.refreshFileTree ?? "刷新变更列表"}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="review-panel__body">
        {/* 变更文件列表 */}
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
                className={`review-file ${change.path === selectedPath ? "review-file--active" : ""} ${
                  change.status === "deleted" ? "review-file--disabled" : ""
                }`}
                onClick={() => setSelectedPath(change.path)}
                disabled={change.status === "deleted"}
                title={change.path}
              >
                <span className={`review-file__badge ${statusBadgeClass(change.status)}`}>
                  {statusBadgeText(change.status)}
                </span>
                <span className="review-file__path">{change.path}</span>
                {change.status !== "modified" ? (
                  <span className="review-file__note">
                    {change.status === "added"
                      ? copy?.reviewAddedNote ?? "新文件 · 仅查看"
                      : copy?.reviewDeletedNote ?? "删除 · 不支持恢复"}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>

        {/* 差异区 */}
        <div className="review-content">
          {loadingFile ? (
            <div className="review-content__loading">
              <Loader2 size={16} className="review-spin" />
            </div>
          ) : selectedPath === null || selected?.status === "deleted" ? (
            <div className="review-content__placeholder">
              {copy?.reviewNoSelection ?? "选择左侧变更文件查看差异"}
            </div>
          ) : hunks.length === 0 ? (
            <div className="review-content__placeholder">
              {copy?.reviewDiffEmpty ?? "与 HEAD 无内容差异"}
            </div>
          ) : mode === "cards" ? (
            <div className="review-hunks">
              {hunks.map((hunk, hunkIndex) => {
                const decision = decisions[hunkIndex] ?? "pending";
                let oldLine = hunk.oldStart;
                let newLine = hunk.newStart;
                return (
                  <article
                    key={`${hunk.oldStart}-${hunk.newStart}`}
                    className={`review-hunk review-hunk--${decision}`}
                  >
                    <header className="review-hunk__head">
                      <span className="review-hunk__range">
                        @@ -{hunk.oldStart} +{hunk.newStart} @@
                      </span>
                      <span className={`review-hunk__state review-hunk__state--${decision}`}>
                        {decision === "accepted"
                          ? copy?.reviewAccepted ?? "已采纳"
                          : decision === "rejected"
                            ? copy?.reviewRejected ?? "已拒绝"
                            : copy?.reviewPending ?? "待处理"}
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
                    {isModifiable ? (
                      <footer className="review-hunk__ops">
                        <button
                          type="button"
                          className={`review-ghost-btn review-ghost-btn--ok ${decision === "accepted" ? "review-ghost-btn--on" : ""}`}
                          onClick={() => setDecision(hunkIndex, "accepted")}
                        >
                          <Check size={11} /> {copy?.reviewAccept ?? "采纳"}
                        </button>
                        <button
                          type="button"
                          className={`review-ghost-btn review-ghost-btn--danger ${decision === "rejected" ? "review-ghost-btn--danger-on" : ""}`}
                          onClick={() => setDecision(hunkIndex, "rejected")}
                        >
                          <X size={11} /> {copy?.reviewReject ?? "拒绝"}
                        </button>
                      </footer>
                    ) : (
                      <footer className="review-hunk__ops review-hunk__ops--readonly">
                        <Clock size={11} /> {copy?.reviewAddedNote ?? "新文件 · 仅查看"}
                      </footer>
                    )}
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
