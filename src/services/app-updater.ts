import { useCallback, useState } from "react";
import { isDesktopApp } from "./app-platform";
import { openExternalUrl } from "./desktop-bridge";

export type AppUpdateState =
  | { kind: "idle" }
  | { kind: "downloading"; percent?: number }
  | { kind: "installing" }
  | { kind: "failed" };

/**
 * 下载并安装最新的签名安装包，完成后重启应用。
 * 发布未生成签名包（latest.json 不存在）、离线或非桌面端时返回 false，由调用方退回打开下载页；
 * 下载中断或签名校验失败会抛错，不会安装任何未通过校验的文件。
 */
export async function installLatestUpdate(onProgress: (percent: number | undefined) => void): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check().catch(() => null);
  if (update === null) return false;

  let total: number | undefined;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength;
      onProgress(total ? 0 : undefined);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}

/** 通知条与设置页共用的更新流程：优先应用内安装，没有签名包时打开 Release 页面 */
export function useAppUpdateInstaller(releaseUrl: string | undefined): {
  state: AppUpdateState;
  start: () => Promise<void>;
} {
  const [state, setState] = useState<AppUpdateState>({ kind: "idle" });

  const start = useCallback(async () => {
    setState({ kind: "downloading" });
    try {
      const installed = await installLatestUpdate((percent) => {
        setState(percent === 100 ? { kind: "installing" } : { kind: "downloading", percent });
      });
      if (!installed) {
        setState({ kind: "idle" });
        if (releaseUrl !== undefined) await openExternalUrl(releaseUrl);
      }
    } catch {
      setState({ kind: "failed" });
    }
  }, [releaseUrl]);

  return { state, start };
}
