import { apiFetch } from "./api-origins";
import { isDesktopApp } from "./app-platform";

export interface ModelListRequest {
  readonly baseUrl: string;
  /** 表单里刚输入的 Key；为空时桌面网关改用 slot 对应配置已保存的 Key */
  readonly apiKey?: string;
  /** 已保存配置的 id（桌面端密钥槽名） */
  readonly slot?: string;
}

/** 解析 OpenAI 兼容 `/models` 响应的 `data[].id`（网页端直连上游时使用），去重并按字母序排列 */
export function parseModelIds(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((item: unknown) =>
      item !== null && typeof item === "object" ? (item as Record<string, unknown>).id : undefined,
    )
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)].sort();
}

/**
 * 拉取 OpenAI 兼容端点的可用模型列表。
 * 桌面端经本地网关代理（规避 CORS，且已保存的 Key 只在网关内）；网页端由浏览器直连上游，
 * 端点不允许跨域时会失败，调用方提示手动填写模型名即可。
 */
export async function fetchModelList(request: ModelListRequest): Promise<string[]> {
  const baseUrl = request.baseUrl.trim();
  const apiKey = request.apiKey?.trim() ?? "";
  if (isDesktopApp()) {
    const response = await apiFetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl,
        ...(apiKey.length > 0 ? { key: apiKey } : {}),
        ...(request.slot !== undefined ? { slot: request.slot } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Failed to list models (${response.status})`);
    const body: unknown = await response.json();
    const models = body !== null && typeof body === "object" ? (body as Record<string, unknown>).models : undefined;
    return Array.isArray(models) ? models.filter((id): id is string => typeof id === "string") : [];
  }
  const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/models`, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Failed to list models (${response.status})`);
  return parseModelIds(await response.json());
}
