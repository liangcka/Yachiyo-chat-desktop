import type { ActiveLlmConfig } from "../domain/llm";
import { apiFetch } from "./api-origins";

/** 对话框统一的思考档位（轻度 / 中 / 高 / 极高 / Ultra），由浅到深；各厂商原生取值由桌面网关映射 */
export type ReasoningLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const REASONING_LEVELS: readonly ReasoningLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** 模型可选档位（由浅到深）与不指定档位时上游实际生效的档位；levels 为空表示不支持调节 */
export interface ReasoningSupport {
  readonly levels: readonly ReasoningLevel[];
  readonly defaultLevel?: ReasoningLevel;
}

export type ReasoningModel = Pick<ActiveLlmConfig, "provider" | "model" | "baseUrl">;

const STORAGE_KEY = "yachiyo_reasoning_effort";
const UNSUPPORTED: ReasoningSupport = { levels: [] };

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

/** 档位按模型分别记忆：同一厂商的不同模型、不同自定义端点可选的档位并不相同 */
export function reasoningModelKey(model: ReasoningModel): string {
  return [model.provider, model.baseUrl ?? "", model.model].join("|");
}

/** 读取全部模型的档位选择；存储不可用或内容非法时视为都未选择 */
export function readReasoningChoices(): Readonly<Record<string, ReasoningLevel>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ReasoningLevel] => isReasoningLevel(entry[1])));
  } catch {
    return {};
  }
}

export function readReasoningEffort(model: ReasoningModel): ReasoningLevel | undefined {
  return readReasoningChoices()[reasoningModelKey(model)];
}

/** 写入某模型的档位；level 为 undefined 时清除选择，恢复模型默认档。返回写入后的全部选择 */
export function writeReasoningEffort(
  model: ReasoningModel,
  level: ReasoningLevel | undefined,
): Readonly<Record<string, ReasoningLevel>> {
  const next: Record<string, ReasoningLevel> = { ...readReasoningChoices() };
  if (level === undefined) delete next[reasoningModelKey(model)];
  else next[reasoningModelKey(model)] = level;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时本次选择只在当前界面生效
  }
  return next;
}

const supportCache = new Map<string, Promise<ReasoningSupport>>();

function parseSupport(value: unknown): ReasoningSupport {
  if (value === null || typeof value !== "object") return UNSUPPORTED;
  const record = value as Record<string, unknown>;
  const levels = Array.isArray(record.levels) ? record.levels.filter(isReasoningLevel) : [];
  if (levels.length < 2) return UNSUPPORTED;
  return isReasoningLevel(record.defaultLevel) && levels.includes(record.defaultLevel)
    ? { levels, defaultLevel: record.defaultLevel }
    : { levels };
}

/** 向桌面网关查询模型可选档位（网关是能力表的唯一来源）；同一模型只查询一次，失败时不缓存以便下次重试 */
export function fetchReasoningSupport(model: ReasoningModel): Promise<ReasoningSupport> {
  const key = reasoningModelKey(model);
  const cached = supportCache.get(key);
  if (cached !== undefined) return cached;
  const request = apiFetch("/api/reasoning/levels", {
    body: JSON.stringify({ provider: model.provider, model: model.model, ...(model.baseUrl !== undefined ? { baseUrl: model.baseUrl } : {}) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseSupport(await response.json());
    })
    .catch(() => {
      supportCache.delete(key);
      return UNSUPPORTED;
    });
  supportCache.set(key, request);
  return request;
}
