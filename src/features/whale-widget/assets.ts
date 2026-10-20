/**
 * 小鲸鱼前端脚本 upstream/whale-widget.js 原样取自上游 DeepSeek-Balance-Whale-Widget 发布的
 * npm 包 dsh-whale-widget（代码为 MIT）。上游声明美术素材（图片、动图、音效）不在 MIT 范围内、
 * 不授予再许可，因此仓库不收录素材，运行时从 jsDelivr 加载与脚本同一版本的文件。
 */
export const WHALE_WIDGET_PACKAGE = "dsh-whale-widget";
/** 必须与 upstream/whale-widget.js 的来源版本一致：新版脚本可能引用新的素材文件 */
export const WHALE_WIDGET_VERSION = "0.4.2";
export const WHALE_UPSTREAM_URL = "https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget";

const LATEST_VERSION_URL = `https://data.jsdelivr.com/v1/packages/npm/${WHALE_WIDGET_PACKAGE}/resolved?specifier=latest`;

export function whaleAssetUrl(file: string): string {
  return `https://cdn.jsdelivr.net/npm/${WHALE_WIDGET_PACKAGE}@${WHALE_WIDGET_VERSION}/assets/${file}`;
}

/** 查询上游最新发布版本，供挂件「关于」面板的检查更新使用 */
export async function fetchLatestWhaleVersion(fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(LATEST_VERSION_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const latest = ((await response.json()) as { version?: unknown }).version;
  if (typeof latest !== "string" || !/^\d+\.\d+\.\d+$/u.test(latest)) throw new Error("版本号无效");
  return latest;
}
