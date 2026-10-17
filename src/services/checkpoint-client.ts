import { isDesktopApp } from "./app-platform";

export interface Checkpoint {
  id: string;
  /** Unix 时间戳，单位毫秒。 */
  createdAt: number;
  turn: number;
  runId: string;
}

function parseCheckpoints(value: unknown): Checkpoint[] {
  if (!Array.isArray(value)) throw new Error("检查点列表格式无效");
  return value.map((entry: unknown): Checkpoint => {
    if (typeof entry !== "object" || entry === null) throw new Error("检查点格式无效");
    const checkpoint = entry as Record<string, unknown>;
    const { id, createdAt, turn, runId } = checkpoint;
    if (
      typeof id !== "string" || !/^[a-zA-Z0-9-]{1,96}$/.test(id)
      || typeof runId !== "string" || runId.trim().length === 0
      || typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 1
      || typeof createdAt !== "number" || !Number.isSafeInteger(createdAt)
      || createdAt < 0 || createdAt > 8_640_000_000_000_000
    ) throw new Error("检查点字段无效");
    return { id, createdAt, turn, runId };
  });
}

/** 最新检查点优先；非桌面环境返回空列表，读取失败抛出 Error。 */
export async function listCheckpoints(workspace: string): Promise<Checkpoint[]> {
  if (!isDesktopApp()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return parseCheckpoints(await invoke<unknown>("list_checkpoints", { workspace }));
  } catch (error) {
    throw new Error(String(error));
  }
}

/** 恢复指定检查点；运行中的工作区及不支持的平台会拒绝操作。 */
export async function restoreCheckpoint(workspace: string, id: string): Promise<void> {
  if (!isDesktopApp()) throw new Error("检查点恢复仅在桌面端可用");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke<void>("restore_checkpoint", { workspace, id });
  } catch (error) {
    throw new Error(String(error));
  }
}
