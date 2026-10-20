import { apiFetch } from "../../services/api-origins";
import { apiCredentials } from "../../services/app-platform";

export interface DeepSeekBalance {
  readonly currency: string;
  /** 总余额 = 充值余额 + 赠金 */
  readonly total: number;
  readonly granted: number;
  readonly toppedUp: number;
  /** DeepSeek 判定余额是否足以继续调用 */
  readonly available: boolean;
}

export class BalanceRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BalanceRequestError";
  }
}

function toAmount(value: unknown): number | null {
  const amount = typeof value === "string" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

/**
 * 从 /user/balance 的响应里挑出要展示的一项。接口返回的多币种数组顺序不固定，
 * 依次取：有余额的 CNY、任意有余额的币种、CNY、第一项。
 */
export function pickDeepSeekBalance(raw: unknown): DeepSeekBalance | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { is_available: isAvailable, balance_infos: infos } = raw as { is_available?: unknown; balance_infos?: unknown };
  if (!Array.isArray(infos)) return null;

  const parsed = infos.flatMap((info: unknown) => {
    if (typeof info !== "object" || info === null) return [];
    const record = info as Record<string, unknown>;
    const total = toAmount(record.total_balance);
    if (typeof record.currency !== "string" || total === null) return [];
    return [{
      currency: record.currency,
      total,
      granted: toAmount(record.granted_balance) ?? 0,
      toppedUp: toAmount(record.topped_up_balance) ?? 0,
      available: isAvailable !== false,
    }];
  });

  return parsed.find((item) => item.currency === "CNY" && item.total > 0)
    ?? parsed.find((item) => item.total > 0)
    ?? parsed.find((item) => item.currency === "CNY")
    ?? parsed[0]
    ?? null;
}

/**
 * 网页版把浏览器本地的 Key 交给同源代理；桌面端不传 Key，由网关从系统加密存储取用。
 * 两端错误体都是 `{ error: { code } }`。
 */
export async function fetchDeepSeekBalance(apiKey: string | undefined): Promise<DeepSeekBalance> {
  let response: Response;
  try {
    response = await apiFetch("/api/deepseek/balance", {
      method: "POST",
      credentials: apiCredentials(),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(apiKey === undefined ? {} : { apiKey }),
    });
  } catch {
    throw new BalanceRequestError("NETWORK_ERROR");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    throw new BalanceRequestError(typeof code === "string" ? code : "PROVIDER_ERROR");
  }
  const balance = pickDeepSeekBalance(body);
  if (balance === null) throw new BalanceRequestError("PROVIDER_ERROR");
  return balance;
}
