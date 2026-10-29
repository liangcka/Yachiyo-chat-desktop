import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, GitCompareArrows, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useLocale } from "../../i18n/locale-context";
import {
  keepRunChange,
  listRunChanges,
  readRunChange,
  restoreRunChange,
  revertRunChange,
  revertRunChanges,
  type RunChangeContent,
  type RunChangeResult,
  type RunChangesResult,
  type RunFileChange,
} from "../../services/desktop-bridge";
import { emitWorkspaceFilesChanged, subscribeWorkspaceFilesChanged } from "../../services/workspace-events";
import { runChangeStateLabel } from "../chat/run-change-state";
import { revertSelectedHunks, toReviewHunks } from "./diff-merge";

export interface TaskReviewPanelProps {
  /** 运行所在的工作区；读写都显式落到这里，与界面当前项目无关 */
  workspace: string;
  runId: string;
  refreshKey?: number;
}

function kindBadge(change: RunFileChange): { text: string; className: string } {
  if (change.kind === "added") return { text: "A", className: "review-file__badge--added" };
  if (change.kind === "deleted") return { text: "D", className: "review-file__badge--deleted" };
  return { text: "M", className: "review-file__badge--modified" };
}

/**
 * 本次任务的改动审阅：基线是任务第一次改动该文件之前的内容，不是 Git HEAD。
 * Agent 已经写入工作区，这里提供“保留 / 撤销”：未处理的块保持现状；
 * 任务写入后又被修改过的文件以冲突呈现，不允许直接撤销。
 */
export function TaskReviewPanel({ workspace, runId, refreshKey = 0 }: TaskReviewPanelProps) {
  const ja = useLocale() === "ja-JP";
  const t = (zh: string, jp: string) => (ja ? jp : zh);
  const [changes, setChanges] = useState<RunFileChange[] | null>(null);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadedContent, setContent] = useState<RunChangeContent | null>(null);
  // 只显示与当前选中文件对应的内容，切换文件时不会短暂显示上一个文件
  const content = loadedContent !== null && loadedContent.change.path === selectedPath ? loadedContent : null;
  const [selection, setSelection] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string; undoPath?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 撤销、保存或恢复检查点后重新读取，避免基于过期内容操作
  useEffect(() => subscribeWorkspaceFilesChanged((event) => {
    if (event.workspace === workspace) setReloadKey((key) => key + 1);
  }), [workspace]);

  useEffect(() => {
    let cancelled = false;
    void listRunChanges(workspace, runId).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setListError(result.error);
        setChanges([]);
        return;
      }
      setListError(undefined);
      setChanges(result);
      setSelectedPath((previous) => (previous !== null && result.some((change) => change.path === previous) ? previous : result[0]?.path ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, runId, refreshKey, reloadKey]);

  useEffect(() => {
    if (selectedPath === null) return;
    let cancelled = false;
    void readRunChange(workspace, runId, selectedPath).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setContent(null);
        setNotice({ tone: "error", text: result.error });
        return;
      }
      setContent(result);
      setSelection([]);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, runId, selectedPath, reloadKey, refreshKey]);

  const textual = content !== null && content.baseline.lossless && content.current.lossless && content.baseline.present && content.current.present;
  const hunks = useMemo(
    () => (content !== null && textual ? toReviewHunks(content.baseline.content, content.current.content) : []),
    [content, textual],
  );
  const state = content?.change.state;
  const actionable = state === "agent" || state === "reviewed";

  const pending = (changes ?? []).filter((change) => change.state === "agent");

  const finish = useCallback(
    (result: RunChangeResult | RunChangesResult, success: string, paths: string[], undoable: boolean) => {
      if (result.ok) {
        setNotice({ tone: "info", text: success, ...(undoable && paths.length === 1 ? { undoPath: paths[0] } : {}) });
        emitWorkspaceFilesChanged({ workspace, paths });
      } else {
        setNotice({
          tone: "error",
          text: result.conflict ? t(`未覆盖：${result.error}`, `上書きしていません：${result.error}`) : result.error,
        });
        setReloadKey((key) => key + 1);
        // 批量撤销可能已处理了一部分文件，刷新所有视图
        if (paths.length > 1) emitWorkspaceFilesChanged({ workspace, paths });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, ja],
  );

  const revertSelected = async () => {
    if (content === null || !textual) return;
    const merged = revertSelectedHunks(content.baseline.content, content.current.content, selection);
    if (merged === undefined) {
      setNotice({ tone: "error", text: t("文件内容已变化，无法按块撤销，请刷新后重试。", "ファイル内容が変わったため、ブロック単位で取り消せません。更新してから再試行してください。") });
      return;
    }
    setBusy(true);
    try {
      finish(await revertRunChange(workspace, runId, content.change.path, content.current.digest, merged), t("已撤销所选改动，其余改动保持不变。", "選択した変更を取り消しました。その他の変更はそのままです。"), [content.change.path], true);
    } finally {
      setBusy(false);
    }
  };

  const revertFile = async () => {
    if (content === null) return;
    setBusy(true);
    try {
      finish(await revertRunChange(workspace, runId, content.change.path, content.current.digest), t("已撤销该文件的本次改动。", "このファイルへの今回の変更を取り消しました。"), [content.change.path], true);
    } finally {
      setBusy(false);
    }
  };

  const keepFile = async () => {
    if (content === null) return;
    setBusy(true);
    try {
      finish(await keepRunChange(workspace, runId, content.change.path, content.current.digest), t("已保留该文件的改动。", "このファイルの変更を残しました。"), [content.change.path], false);
    } finally {
      setBusy(false);
    }
  };

  /** 撤销全部待处理文件；已处理（保留或部分撤销）与冲突的文件不在其中 */
  const revertAllPending = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    try {
      const items = pending.map((change) => ({ path: change.path, expectedDigest: change.current.digest }));
      finish(
        await revertRunChanges(workspace, runId, items),
        t(`已撤销 ${pending.length} 个待处理文件的改动。`, `未処理の ${pending.length} ファイルの変更を取り消しました。`),
        pending.map((change) => change.path),
        false,
      );
    } finally {
      setBusy(false);
    }
  };

  const restoreAgentVersion = async (path: string) => {
    setBusy(true);
    try {
      const current = await readRunChange(workspace, runId, path);
      if ("error" in current) {
        setNotice({ tone: "error", text: current.error });
        return;
      }
      finish(await restoreRunChange(workspace, runId, path, current.current.digest), t("已恢复为 Agent 写入的版本。", "Agent が書き込んだ版に戻しました。"), [path], false);
    } finally {
      setBusy(false);
    }
  };

  if (changes !== null && changes.length === 0) {
    return (
      <section className="review-panel review-panel--empty" aria-label={t("本次任务改动", "今回のタスクの変更")}>
        <div className="review-empty-state">
          <GitCompareArrows size={36} className="review-empty-icon" />
          <h3 className="review-empty-title">{listError ?? t("本次任务没有改动文件", "今回のタスクはファイルを変更していません")}</h3>
          <p className="review-empty-desc">{t("这里只显示该任务自己改动的文件，基线是任务改动前的内容。", "ここにはこのタスク自身が変更したファイルだけを表示します。基準はタスクが変更する前の内容です。")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="review-panel" aria-label={t("本次任务改动", "今回のタスクの変更")}>
      <div className="review-panel__toolbar">
        <span className="review-panel__title">
          <GitCompareArrows size={15} />
          {t("本次任务改动", "今回のタスクの変更")}
          {changes !== null ? <span className="review-panel__count">{changes.length}</span> : null}
        </span>
        {pending.length > 0 ? (
          <span className="task-review__actions">
            <button type="button" className="review-ghost-btn review-ghost-btn--danger" disabled={busy} onClick={() => void revertAllPending()}>
              <RotateCcw size={12} /> {t(`撤销全部待处理（${pending.length}）`, `未処理をすべて取り消す（${pending.length}）`)}
            </button>
          </span>
        ) : null}
      </div>
      {notice !== null ? (
        <div className={`task-review__notice task-review__notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          {notice.undoPath !== undefined ? (
            <button type="button" disabled={busy} onClick={() => void restoreAgentVersion(notice.undoPath!)}>
              <Undo2 size={12} /> {t("恢复 Agent 版本", "Agent の版に戻す")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="review-panel__body">
        <div className="review-files">
          <p className="review-files__label">{t("改动文件", "変更ファイル")}</p>
          {changes === null ? (
            <p className="review-files__hint"><Loader2 size={12} className="review-spin" /> …</p>
          ) : (
            changes.map((change) => {
              const badge = kindBadge(change);
              return (
                <button
                  key={change.path}
                  type="button"
                  className={`review-file ${change.path === selectedPath ? "review-file--active" : ""}`}
                  onClick={() => { setSelectedPath(change.path); setNotice(null); }}
                  title={change.path}
                >
                  <span className={`review-file__badge ${badge.className}`}>{badge.text}</span>
                  <span className="review-file__path">{change.path}</span>
                  <span className={`review-file__note task-review__state--${change.state}`}>{runChangeStateLabel(change.state, ja)}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="review-content">
          {content === null ? (
            <div className="review-content__placeholder">{t("选择左侧文件查看本次改动", "左のファイルを選ぶと今回の変更を表示します")}</div>
          ) : (
            <>
              <div className="task-review__file-head">
                <span>{content.change.source === "command" ? t("由命令执行产生的改动", "コマンド実行による変更") : t("由文件工具写入", "ファイルツールによる書き込み")}</span>
                {actionable ? (
                  <span className="task-review__actions">
                    {hunks.length > 0 ? (
                      <button type="button" className="review-ghost-btn review-ghost-btn--danger" disabled={busy || !selection.some(Boolean)} onClick={() => void revertSelected()}>
                        <RotateCcw size={12} /> {t("撤销所选块", "選択したブロックを取り消す")}
                      </button>
                    ) : null}
                    <button type="button" className="review-ghost-btn review-ghost-btn--danger" disabled={busy} onClick={() => void revertFile()}>
                      <RotateCcw size={12} /> {content.change.kind === "added" ? t("撤销（删除新文件）", "取り消す（新規ファイルを削除）") : t("撤销整个文件", "ファイル全体を取り消す")}
                    </button>
                    {state === "agent" ? (
                      <button type="button" className="review-primary-btn" disabled={busy} onClick={() => void keepFile()}>
                        <Check size={12} /> {t("保留", "残す")}
                      </button>
                    ) : null}
                  </span>
                ) : state === "reverted" ? (
                  <button type="button" className="review-ghost-btn" disabled={busy} onClick={() => void restoreAgentVersion(content.change.path)}>
                    <Undo2 size={12} /> {t("恢复 Agent 版本", "Agent の版に戻す")}
                  </button>
                ) : null}
              </div>
              {state === "conflict" ? (
                <p className="task-review__conflict" role="alert">
                  <AlertTriangle size={13} />
                  {t("该文件在本次任务写入之后又被修改（可能是你或其他任务），差异中包含不属于本任务的内容，因此不能直接撤销。",
                    "このファイルはタスクの書き込み後に変更されました（あなたまたは別のタスク）。差分にこのタスク以外の内容が含まれるため、そのまま取り消せません。")}
                </p>
              ) : null}
              {!textual && content.change.kind === "modified" ? (
                <p className="review-content__placeholder">{t("非 UTF-8 文本，只能整体撤销。", "UTF-8 以外のテキストのため、ファイル全体の取り消しのみ可能です。")}</p>
              ) : null}
              {content.change.kind === "added" && content.current.present ? (
                <pre className="tool-card__code task-review__preview">{content.current.content}</pre>
              ) : null}
              {content.change.kind === "deleted" ? (
                <pre className="tool-card__code task-review__preview">{content.baseline.content}</pre>
              ) : null}
              {textual ? (
                hunks.length === 0 ? (
                  <div className="review-content__placeholder">{t("与改动前没有差异", "変更前との差分はありません")}</div>
                ) : (
                  <div className="review-hunks">
                    {hunks.map((hunk, hunkIndex) => {
                      let oldLine = hunk.oldStart;
                      let newLine = hunk.newStart;
                      const chosen = selection[hunkIndex] === true;
                      return (
                        <article key={`${hunk.oldStart}-${hunk.newStart}`} className={`review-hunk ${chosen ? "review-hunk--picked" : ""}`}>
                          <header className="review-hunk__head">
                            <span className="review-hunk__range">@@ -{hunk.oldStart} +{hunk.newStart} @@</span>
                            {actionable ? (
                              <label className="task-review__pick">
                                <input
                                  type="checkbox"
                                  checked={chosen}
                                  onChange={(event) => setSelection((current) => {
                                    const next = hunks.map((_, index) => current[index] === true);
                                    next[hunkIndex] = event.target.checked;
                                    return next;
                                  })}
                                />
                                {t("撤销此块", "このブロックを取り消す")}
                              </label>
                            ) : null}
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
                )
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
