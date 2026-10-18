import { useEffect, useState } from "react";
import { History, RefreshCw, Undo2 } from "lucide-react";
import { listCheckpoints, restoreCheckpoint, type Checkpoint } from "../../services/checkpoint-client";
import { useProjectState } from "../../services/project-manager";
import { useLocale } from "../../i18n/locale-context";

export interface CheckpointPanelProps {
  isRunning: boolean;
  onRestored?: () => void;
  hideHeader?: boolean;
  externalRefreshKey?: number;
}

export function CheckpointPanel({ isRunning, onRestored, hideHeader, externalRefreshKey }: CheckpointPanelProps) {
  const ja = useLocale() === "ja-JP";
  const { activeProject } = useProjectState();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmId, setConfirmId] = useState<string>();
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = activeProject ? await listCheckpoints(activeProject) : [];
        if (!cancelled) {
          setCheckpoints(next);
          setConfirmId(undefined);
          setError(undefined);
        }
      } catch (cause) {
        if (!cancelled) {
          setCheckpoints([]);
          setError(cause instanceof Error ? cause.message : ja ? "チェックポイントを読み込めませんでした。再試行してください。" : "无法读取检查点，请重试。");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeProject, refreshKey, externalRefreshKey, isRunning, ja]);

  const handleRestore = async (id: string): Promise<void> => {
    if (!activeProject || isRunning || restoring) return;
    setRestoring(true);
    setError(undefined);
    try {
      await restoreCheckpoint(activeProject, id);
      setConfirmId(undefined);
      setRefreshKey((value) => value + 1);
      onRestored?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ja ? "復元できませんでした。再試行してください。" : "恢复失败，请重试。");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="checkpoint-panel" aria-label={ja ? "ファイルのチェックポイント" : "文件检查点"}>
      {!hideHeader ? (
        <div className="checkpoint-panel__header">
          <h3><History size={14} /> {ja ? "チェックポイント" : "检查点"}</h3>
          <button
            type="button"
            className="workspace-panel__btn workspace-panel__btn--icon"
            aria-label={ja ? "チェックポイントを更新" : "刷新检查点"}
            title={ja ? "チェックポイントを更新" : "刷新检查点"}
            disabled={restoring}
            onClick={() => setRefreshKey((value) => value + 1)}
          ><RefreshCw size={13} /></button>
        </div>
      ) : null}
      {error ? <p className="checkpoint-panel__error" role="alert">{error}</p> : null}
      {!activeProject ? <p className="checkpoint-panel__hint">{ja ? "ワークスペースを選択するとチェックポイントを確認できます。" : "选择工作区后可查看文件检查点。"}</p> : null}
      {activeProject && checkpoints.length === 0 && !error ? <p className="checkpoint-panel__hint">{ja ? "Agent はファイルを変更する前に自動でチェックポイントを保存します。" : "Agent 修改文件前会自动保存检查点。"}</p> : null}
      {isRunning ? <p className="checkpoint-panel__hint">{ja ? "タスクを停止してからファイルを復元してください。" : "请先停止任务，再恢复文件。"}</p> : null}
      <ul className="checkpoint-panel__list">
        {checkpoints.map((checkpoint) => (
          <li key={checkpoint.id}>
            <div className="checkpoint-panel__row">
              <span title={checkpoint.runId}>{ja ? `${checkpoint.turn} ターン目の前` : `第 ${checkpoint.turn} 轮之前`}</span>
              <time dateTime={new Date(checkpoint.createdAt).toISOString()}>{new Date(checkpoint.createdAt).toLocaleString(ja ? "ja-JP" : "zh-CN")}</time>
              <button
                type="button"
                className="workspace-panel__btn workspace-panel__btn--xs"
                disabled={isRunning || restoring}
                aria-label={ja ? `${checkpoint.turn} ターン目の前に戻す` : `退回第 ${checkpoint.turn} 轮之前`}
                onClick={() => setConfirmId(checkpoint.id)}
              ><Undo2 size={12} /> {ja ? "戻す" : "退回"}</button>
            </div>
            {confirmId === checkpoint.id ? (
              <div className="checkpoint-panel__confirm">
                <p>
                  {ja
                    ? "このターンより前のソースファイルを復元します。以降のファイル変更は上書きされ、開いているエディタータブは閉じられます。ビルド成果物やワークスペース外の操作は復元されません。"
                    : "将恢复这一轮之前的源码文件，之后的文件修改会被覆盖，已打开的编辑器标签会关闭。构建产物和工作区外的操作不在恢复范围内。"}
                </p>
                <button type="button" className="workspace-panel__btn" disabled={isRunning || restoring} onClick={() => void handleRestore(checkpoint.id)}>{restoring ? (ja ? "復元中…" : "正在恢复…") : ja ? "復元する" : "确认恢复"}</button>
                <button type="button" className="workspace-panel__btn" disabled={restoring} onClick={() => setConfirmId(undefined)}>{ja ? "キャンセル" : "取消"}</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
