/**
 * 工作区文件变化通知：撤销改动、恢复检查点或保存文件后广播，
 * 文件树、编辑器、任务改动与检查点各自刷新，避免显示过期内容
 */
export interface WorkspaceFilesChanged {
  workspace: string;
  /** 变化的相对路径；缺省表示整个工作区（如恢复检查点） */
  paths?: string[];
}

type Listener = (event: WorkspaceFilesChanged) => void;

const listeners = new Set<Listener>();

export function emitWorkspaceFilesChanged(event: WorkspaceFilesChanged): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      // 单个订阅者出错不影响其他订阅者刷新，但要留下记录
      console.error("[workspace-events] 订阅者处理失败", error);
    }
  }
}

export function subscribeWorkspaceFilesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
