import { useContext, useEffect, useState } from "react";
import type { AgentRunRecord, Locale } from "../../domain/chat";
import { listRunChanges, type RunFileChange } from "../../services/desktop-bridge";
import { subscribeWorkspaceFilesChanged } from "../../services/workspace-events";
import { OpenReviewContext } from "./review-context";
import { runChangeStateLabel } from "./run-change-state";
import "../../styles/agent-tools.css";

/**
 * 每轮文件修改汇总。运行绑定了项目时以 Rust 改动账本为准（包含命令产生的改动与审阅状态）；
 * 没有账本记录的旧消息退回到文件工具参数里的路径。
 */
export function FileChangeSummary({ paths, locale, run, settled }: {
  paths: readonly string[];
  locale: Locale;
  run?: AgentRunRecord;
  settled: boolean;
}) {
  const openReview = useContext(OpenReviewContext);
  const ja = locale === "ja-JP";
  const runId = run?.id;
  const workspace = run?.workspace ?? null;
  const ledgerKey = settled && runId !== undefined && workspace !== null ? `${workspace}\u0000${runId}` : undefined;
  const [loaded, setLoaded] = useState<{ key: string; changes: readonly RunFileChange[] | undefined } | undefined>(undefined);
  const ledger = loaded !== undefined && loaded.key === ledgerKey ? loaded.changes : undefined;

  useEffect(() => {
    if (ledgerKey === undefined || runId === undefined || workspace === null) return;
    let cancelled = false;
    let tracked = false;
    const load = (): void => {
      void listRunChanges(workspace, runId).then((result) => {
        if (cancelled) return;
        const changes = "error" in result ? undefined : result;
        tracked = changes !== undefined && changes.length > 0;
        setLoaded({ key: ledgerKey, changes });
      });
    };
    load();
    // 审阅撤销、保存或恢复检查点后刷新状态；没有账本记录的运行不必重读
    const unsubscribe = subscribeWorkspaceFilesChanged((event) => {
      if (tracked && event.workspace === workspace) load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [ledgerKey, runId, workspace]);

  if (!settled) return null;
  const entries: ReadonlyArray<{ path: string; change?: RunFileChange }> = ledger !== undefined && ledger.length > 0
    ? ledger.map((change) => ({ path: change.path, change }))
    : paths.map((path) => ({ path }));
  if (entries.length === 0) return null;

  const title = ja ? `${entries.length} 個のファイルを変更` : `修改了 ${entries.length} 个文件`;
  const target = runId !== undefined && workspace !== null && ledger !== undefined && ledger.length > 0 ? { runId, workspace } : undefined;
  return <section className="file-change-summary" aria-label={title}>
    <p className="file-change-summary__title">{title}</p>
    <ul>{entries.map(({ path, change }) => <li key={path}>
      <code>{path}</code>
      {change !== undefined && change.state !== "agent"
        ? <span className={`file-change-summary__state file-change-summary__state--${change.state}`}>{runChangeStateLabel(change.state, ja)}</span>
        : null}
      {change?.source === "command" ? <span className="file-change-summary__source">{ja ? "コマンド" : "命令产生"}</span> : null}
    </li>)}</ul>
    <button className="file-change-summary__review" type="button" onClick={() => openReview?.(target)} disabled={!openReview}>
      {ja ? "変更を確認" : "查看改动"}
    </button>
  </section>;
}
