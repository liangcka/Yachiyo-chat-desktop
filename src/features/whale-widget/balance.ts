import { apiFetch } from "../../services/api-origins";

export interface DeepSeekBalance {
  readonly currency: string;
  /** 总余额 = 充值余额 + 赠金 */
  readonly total: number;
  readonly granted: number;
  readonly toppedUp: number;
  /** DeepSeek 判定余额是否足以继续调用 */
  readonly available: boolean;
}

/** 按日累计的余额观测账本：余额下降计为消费，上升（充值、赠金）只移动基准 */
export interface BalanceLedger {
  /** 本地日期 YYYY-MM-DD，跨天后清零 */
  readonly date: string;
  readonly currency: string;
  readonly lastBalance: number;
  readonly todaySpent: number;
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

/** 金额保留 6 位小数，避免浮点减法把 0.0288 记成 0.028800000000003876 */
function roundAmount(value: number): number {
  return Math.round(value * 1e6) / 1e6;
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
      credentials: "include",
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

export function localDateKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * 记一次余额观测，返回新账本与这次观测计入的消费额。
 * 跨天或换币种时重新起账：币种切换造成的数值跳变不是消费，旧币种的累计也不能换个单位继续显示。
 */
export function observeBalance(
  ledger: BalanceLedger | null,
  balance: Pick<DeepSeekBalance, "currency" | "total">,
  date: string,
): { ledger: BalanceLedger; spent: number } {
  if (ledger === null || ledger.date !== date || ledger.currency !== balance.currency) {
    return { ledger: { date, currency: balance.currency, lastBalance: balance.total, todaySpent: 0 }, spent: 0 };
  }
  const spent = Math.max(0, roundAmount(ledger.lastBalance - balance.total));
  return {
    ledger: { ...ledger, lastBalance: balance.total, todaySpent: roundAmount(ledger.todaySpent + spent) },
    spent,
  };
}
