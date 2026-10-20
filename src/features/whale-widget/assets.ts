import { isNewerVersion } from "../../services/update-check";

/**
 * 鲸鱼娘形象取自上游 DeepSeek-Balance-Whale-Widget 发布到 npm 的 dsh-whale-widget 包。
 * 上游声明美术素材不在 MIT 范围内、不授予再许可，因此仓库不收录文件，运行时按版本号从 jsDelivr 加载；
 * 加载失败（离线、上游改名）时挂件退回自绘的 WhaleMark。
 */
export const WHALE_ASSET_PACKAGE = "dsh-whale-widget";
export const DEFAULT_WHALE_ASSET_VERSION = "0.4.2";
export const WHALE_UPSTREAM_URL = "https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const LATEST_VERSION_URL = `https://data.jsdelivr.com/v1/packages/npm/${WHALE_ASSET_PACKAGE}/resolved?specifier=latest`;

/** 版本号会拼进 CDN 地址，只接受纯数字三段式 */
export function isWhaleAssetVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

export function whaleImageUrl(version: string): string {
  return `https://cdn.jsdelivr.net/npm/${WHALE_ASSET_PACKAGE}@${version}/assets/DSniang1.png`;
}

export interface WhaleAssetUpdate {
  readonly latest: string;
  readonly available: boolean;
}

/** 查询上游最新发布版本；网络失败或响应异常时抛错，由设置页提示 */
export async function checkWhaleAssetUpdate(
  current: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<WhaleAssetUpdate> {
  const response = await fetcher(LATEST_VERSION_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const latest = ((await response.json()) as { version?: unknown }).version;
  if (!isWhaleAssetVersion(latest)) throw new Error("Invalid version");
  return { latest, available: isNewerVersion(latest, current) };
}
