import { useEffect, useState } from "react";
import { History, RefreshCw, Undo2 } from "lucide-react";
import { listCheckpoints, restoreCheckpoint, type Checkpoint } from "../../services/checkpoint-client";
import { useProjectState } from "../../services/project-manager";

interface CheckpointPanelProps {
  isRunning: boolean;
  onRestored?: () => void;
}

export function CheckpointPanel({ isRunning, onRestored }: CheckpointPanelProps) {
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
          setError(cause instanceof Error ? cause.message : "无法读取检查点，请重试。");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeProject, refreshKey, isRunning]);

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
      setError(cause instanceof Error ? cause.message : "恢复失败，请重试。");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="checkpoint-panel" aria-label="文件检查点">
      <div className="checkpoint-panel__header">
        <h3><History size={14} /> 检查点</h3>
        <button
          type="button"
          className="workspace-panel__btn workspace-panel__btn--icon"
          aria-label="刷新检查点"
          title="刷新检查点"
          disabled={restoring}
          onClick={() => setRefreshKey((value) => value + 1)}
        ><RefreshCw size={13} /></button>
      </div>
      {error ? <p className="checkpoint-panel__error" role="alert">{error}</p> : null}
      {!activeProject ? <p className="checkpoint-panel__hint">选择工作区后可查看文件检查点。</p> : null}
      {activeProject && checkpoints.length === 0 && !error ? <p className="checkpoint-panel__hint">Agent 修改文件前会自动保存检查点。</p> : null}
      {isRunning ? <p className="checkpoint-panel__hint">请先停止任务，再恢复文件。</p> : null}
      <ul className="checkpoint-panel__list">
        {checkpoints.map((checkpoint) => (
          <li key={checkpoint.id}>
            <div className="checkpoint-panel__row">
              <span title={checkpoint.runId}>第 {checkpoint.turn} 轮之前</span>
              <time dateTime={new Date(checkpoint.createdAt).toISOString()}>{new Date(checkpoint.createdAt).toLocaleString()}</time>
              <button
                type="button"
                className="workspace-panel__btn workspace-panel__btn--xs"
                disabled={isRunning || restoring}
                aria-label={`退回第 ${checkpoint.turn} 轮之前`}
                onClick={() => setConfirmId(checkpoint.id)}
              ><Undo2 size={12} /> 退回</button>
            </div>
            {confirmId === checkpoint.id ? (
              <div className="checkpoint-panel__confirm">
                <p>将恢复这一轮之前的源码文件，之后的文件修改会被覆盖，已打开的编辑器标签会关闭。构建产物和工作区外的操作不在恢复范围内。</p>
                <button type="button" className="workspace-panel__btn" disabled={isRunning || restoring} onClick={() => void handleRestore(checkpoint.id)}>{restoring ? "正在恢复…" : "确认恢复"}</button>
                <button type="button" className="workspace-panel__btn" disabled={restoring} onClick={() => setConfirmId(undefined)}>取消</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
