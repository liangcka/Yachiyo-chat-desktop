import { checkDesktopUpdate } from "./desktop-bridge";

export interface AvailableUpdate {
  version: string;
  url: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  available?: AvailableUpdate;
}

/** 解析 `v1.2.3` / `1.2.3` 的主次修订号；预发布后缀不参与比较 */
function parseVersion(raw: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(raw.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseVersion(latest);
  const now = parseVersion(current);
  if (next === undefined || now === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index]! > now[index]!;
  }
  return false;
}

/** 检查是否有新版本；非桌面端或网络失败返回 undefined，由调用方决定是否提示 */
export async function checkForUpdate(): Promise<UpdateCheckResult | undefined> {
  const info = await checkDesktopUpdate();
  if (info === undefined) return undefined;
  const { currentVersion, latestTag, releaseUrl } = info;
  if (latestTag === null || releaseUrl === null || !isNewerVersion(latestTag, currentVersion)) {
    return { currentVersion };
  }
  return { currentVersion, available: { version: latestTag.replace(/^v/u, ""), url: releaseUrl } };
}
