/**
 * 小鲸鱼记账内核，移植自上游 lib/accounting.mjs（MIT）。
 * 余额观测不是交易流水：余额下降记为消费，上升单独记录，校正需要用户显式填写到账金额。
 * 金额一律按 1e-8 定点整数运算，避免浮点累加误差。
 */
export const ACCOUNTING_VERSION = 1;
const SCALE = 100_000_000;
const DAY_MS = 86_400_000;

export interface Correction {
  at: number;
  creditsUnits: number;
  otherDebitsUnits: number;
  amountUnits: number;
  debitUnits: number;
  creditUnits: number;
}

export interface DayRow {
  day: string;
  firstAt: number;
  lastAt: number;
  openingUnits: number;
  lastUnits: number;
  debitUnits: number;
  creditUnits: number;
  revision: number;
  correction: Correction | null;
  correctionLog?: Array<{ at: number; previous: Correction | null; next: Correction | null }>;
}

export interface Book {
  currency: string;
  days: Record<string, DayRow>;
  lastAt?: number;
}

export interface Accounting {
  version: number;
  active: string;
  books: Record<string, Book>;
  migratedAt: number;
  legacyHistory: Record<string, number>;
}

export interface UsageEvent {
  ts: number;
  day: string;
  model: string;
  cost: number;
  tokens: number;
}

export interface Ledger {
  date: string;
  lastBalance: number | null;
  todayUsage: number;
  history: Record<string, number>;
  dayStart?: number;
  accounting?: Accounting;
  events?: UsageEvent[];
  settings?: Record<string, unknown>;
}

export class AccountingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AccountingError";
  }
}

export function moneyUnits(value: unknown): number {
  const n = Number(value);
  const units = Math.round(n * SCALE);
  if (!Number.isFinite(n) || !Number.isSafeInteger(units)) throw new AccountingError("金额无效或超出可记账范围");
  return units;
}

export function preciseMoney(value: unknown): number {
  return moneyUnits(value) / SCALE;
}

export function sumMoney(values: readonly unknown[]): number {
  let units = 0;
  for (const value of values) units += moneyUnits(value);
  if (!Number.isSafeInteger(units)) throw new AccountingError("金额合计超出可记账范围");
  return units / SCALE;
}

export function addMoney(a: unknown, b: unknown): number {
  return sumMoney([a, b]);
}

export function beijingDay(time: number = Date.now()): string {
  const d = new Date(Number(time) + 8 * 3_600_000);
  if (!Number.isFinite(d.getTime())) throw new AccountingError("无效的观测时间");
  return d.toISOString().slice(0, 10);
}

export function dayOffset(day: string, offset: number): string {
  return beijingDay(Date.parse(`${day}T00:00:00+08:00`) + offset * DAY_MS);
}

export function freshLedger(now: number = Date.now()): Ledger {
  return { date: beijingDay(now), lastBalance: null, todayUsage: 0, history: {} };
}

/**
 * 观测缺口超过 10 分钟即视为部分数据：记账只在界面开着且能取到余额时发生，
 * 跨零点或长时间关闭的那一段消费不会被看到。
 */
const PARTIAL_GAP_MS = 10 * 60 * 1000;

function partialDayOf(day: string, row: { firstAt?: number; lastAt?: number }, now: number): boolean {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  if (!Number.isFinite(start)) return true;
  const end = start + DAY_MS;
  const first = Number(row.firstAt);
  const last = Number(row.lastAt);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return true;
  const beforeGap = first - start;
  const afterGap = now >= end ? end - last : 0;
  return beforeGap > PARTIAL_GAP_MS || afterGap > PARTIAL_GAP_MS;
}

export function partialDayInfo(day: string, row: { firstAt?: number; lastAt?: number }, now: number = Date.now()) {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  const first = Number(row.firstAt);
  const last = Number(row.lastAt);
  return {
    partialDay: partialDayOf(day, row, now),
    observedFromMs: Number.isFinite(first) ? first : null,
    observedToMs: Number.isFinite(last) ? last : null,
    leadingGapMs: Number.isFinite(first) && Number.isFinite(start) ? Math.max(0, first - start) : null,
    trailingGapMs: Number.isFinite(last) && Number.isFinite(start) && now >= start + DAY_MS
      ? Math.max(0, start + DAY_MS - last)
      : 0,
  };
}

function currentBook(ledger: Ledger): Book | undefined {
  const a = ledger.accounting;
  return a && a.version === ACCOUNTING_VERSION && a.books ? a.books[a.active] : undefined;
}

/** 记账按「账户 + 币种」分本：换 Key 等于换一本账，旧本的日期仍需在界面里可见 */
function booksOf(ledger: Ledger): Array<{ scope: string; book: Book; active: boolean; lastAt: number }> {
  const a = ledger.accounting;
  if (!a || a.version !== ACCOUNTING_VERSION || !a.books) return [];
  return Object.entries(a.books)
    .filter(([, book]) => book?.days)
    .map(([scope, book]) => ({ scope, book, active: scope === a.active, lastAt: Number(book.lastAt) || 0 }));
}

function observedAmount(row: DayRow): number {
  const c = row.correction;
  return (c ? c.amountUnits + row.debitUnits - c.debitUnits : row.debitUnits) / SCALE;
}

function needsReviewOf(row: DayRow): boolean {
  return row.creditUnits > (row.correction ? row.correction.creditUnits : 0);
}

function revisionOf(ledger: Ledger, row: DayRow): string {
  return [ledger.accounting?.active, row.day, row.firstAt, row.lastUnits, row.debitUnits, row.creditUnits, row.revision || 0].join(":");
}

export function bookBreakdown(ledger: Ledger, day: string) {
  const rows = booksOf(ledger).flatMap(({ scope, book, active, lastAt }) => {
    const row = book.days[day];
    if (!row) return [];
    return [{
      scope,
      currency: book.currency,
      active,
      lastAt,
      amount: preciseMoney(observedAmount(row)),
      firstObservedAt: row.firstAt,
      lastObservedAt: row.lastAt,
      needsReview: needsReviewOf(row),
    }];
  });
  return rows.sort((a, b) => (a.active === b.active ? b.lastAt - a.lastAt : a.active ? -1 : 1));
}

export function accountingDays(ledger: Ledger): string[] {
  const set = new Set<string>();
  for (const { book } of booksOf(ledger)) for (const day of Object.keys(book.days)) set.add(day);
  return [...set].sort();
}

export function balanceSummary(ledger: Ledger, day: string = beijingDay()) {
  const book = currentBook(ledger);
  const row = book?.days?.[day];
  if (!book || !row) return null;
  const correction = row.correction;
  const needsReview = needsReviewOf(row);
  const source = needsReview ? "balance-needs-review" : correction ? "balance-corrected" : "balance-observed";
  return {
    day,
    amount: preciseMoney(observedAmount(row)),
    currency: book.currency,
    source,
    label: needsReview ? "已观测消费 · 待核对余额调整" : correction ? "已校正消费" : "已观测消费",
    firstObservedAt: row.firstAt,
    lastObservedAt: row.lastAt,
    openingBalance: row.openingUnits / SCALE,
    currentBalance: row.lastUnits / SCALE,
    observedDecrease: row.debitUnits / SCALE,
    observedIncrease: row.creditUnits / SCALE,
    needsReview,
    revision: revisionOf(ledger, row),
    ...partialDayInfo(day, row),
    credits: correction ? correction.creditsUnits / SCALE : null,
    otherDebits: correction ? correction.otherDebitsUnits / SCALE : null,
    correctedAt: correction ? correction.at : null,
  };
}

export interface BalanceSnapshot {
  balance: number;
  currency: string;
  scope: string;
  at: number;
}

/** 直接修改传入的账本；本模块不做任何持久化 */
export function observeBalance(ledger: Ledger, snapshot: BalanceSnapshot) {
  const at = Number(snapshot.at);
  const day = beijingDay(at);
  const units = moneyUnits(snapshot.balance);
  const currency = String(snapshot.currency || "CNY").toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new AccountingError("余额币种无效");
  const scope = String(snapshot.scope || "default");
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(scope)) throw new AccountingError("账户标识无效");
  const context = `${scope}-${currency}`;
  let a = ledger.accounting;
  if (!a || a.version !== ACCOUNTING_VERSION) {
    a = ledger.accounting = {
      version: ACCOUNTING_VERSION,
      active: context,
      books: {},
      migratedAt: at,
      legacyHistory: { ...ledger.history },
    };
  }
  const book = (a.books[context] ??= { currency, days: {} });
  // 重复或乱序的样本（含昨天迟到的样本）一律忽略
  if (book.lastAt != null && at <= book.lastAt) return balanceSummary(ledger, ledger.date);
  a.active = context;
  let row = book.days[day];
  if (!row) {
    row = book.days[day] = {
      day, firstAt: at, lastAt: at, openingUnits: units, lastUnits: units,
      debitUnits: 0, creditUnits: 0, revision: 0, correction: null,
    };
  } else {
    const delta = row.lastUnits - units;
    if (delta > 0) row.debitUnits += delta;
    if (delta < 0) row.creditUnits -= delta;
    row.lastUnits = units;
    row.lastAt = at;
  }
  book.lastAt = at;
  ledger.date = day;
  ledger.dayStart = row.openingUnits / SCALE;
  ledger.lastBalance = row.lastUnits / SCALE;
  const summary = balanceSummary(ledger, day);
  if (summary) {
    ledger.todayUsage = summary.amount;
    ledger.history[day] = summary.amount;
  }
  return summary;
}

function adjustmentUnits(value: unknown, required = false): number {
  if (value === "" || value === null || value === undefined) {
    if (required) throw new AccountingError("请填写本统计区间的累计到账金额，未充值请填 0");
    return 0;
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/u.test(String(value))) {
    throw new AccountingError("金额须为非负数，最多保留 8 位小数");
  }
  const units = moneyUnits(value);
  if (units < 0) throw new AccountingError("金额不能为负数");
  return units;
}

export interface ReconcileInput {
  day?: unknown;
  revision?: unknown;
  action?: unknown;
  confirmed?: unknown;
  credits?: unknown;
  otherDebits?: unknown;
}

export function reconcileBalance(ledger: Ledger, input: ReconcileInput, now: number = Date.now()) {
  const day = String(input.day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new AccountingError("请选择有效的记账日期");
  const row = currentBook(ledger)?.days?.[day];
  if (!row) throw new AccountingError("这一天没有余额观测记录，无法校正");
  if (input.revision !== revisionOf(ledger, row)) {
    throw new AccountingError("余额或校正记录已更新，请重新打开校正窗口后核对金额", 409);
  }
  if (input.action !== "reset" && input.confirmed !== true) throw new AccountingError("请先确认已核对本统计区间的全部余额调整");
  let correction: Correction | null = null;
  if (input.action !== "reset") {
    const creditsUnits = adjustmentUnits(input.credits, true);
    const otherDebitsUnits = adjustmentUnits(input.otherDebits);
    const amountUnits = row.openingUnits + creditsUnits - otherDebitsUnits - row.lastUnits;
    if (!Number.isSafeInteger(amountUnits) || amountUnits < 0) {
      throw new AccountingError("校正后消费为负或超出范围，请核对统计起点与累计到账金额");
    }
    correction = { at: now, creditsUnits, otherDebitsUnits, amountUnits, debitUnits: row.debitUnits, creditUnits: row.creditUnits };
  }
  row.correctionLog ??= [];
  row.correctionLog.push({ at: now, previous: row.correction, next: correction });
  if (row.correctionLog.length > 50) row.correctionLog.splice(0, row.correctionLog.length - 50);
  row.correction = correction;
  row.revision = (row.revision || 0) + 1;
  const summary = balanceSummary(ledger, day);
  if (summary) {
    ledger.history[day] = summary.amount;
    if (ledger.date === day) ledger.todayUsage = summary.amount;
  }
  return summary;
}

export function eventEstimate(ledger: Ledger, day: string): number {
  return sumMoney((ledger.events ?? []).filter((e) => e.day === day).map((e) => Number(e.cost) || 0));
}

export function daySummary(ledger: Ledger, day: string) {
  const observed = balanceSummary(ledger, day);
  const estimate = eventEstimate(ledger, day);
  const books = bookBreakdown(ledger, day);
  const others = books.filter((b) => !b.active);
  // 同币种才谈合计；不同币种只列明本数
  const otherSame = others.filter((b) => !observed || b.currency === observed.currency);
  const common = { eventEstimate: estimate, eventCurrency: "CNY", bookBreakdown: books, bookCount: books.length };
  if (observed) {
    if (!otherSame.length) return { ...observed, ...common };
    const other = sumMoney(otherSame.map((b) => b.amount));
    const tail = others.length > otherSame.length ? `（另有其它币种 ${others.length - otherSame.length} 本）` : "";
    // label 会被前端直接当作「今日已用」前缀显示，金额只能放进 historyHint
    return {
      ...observed,
      ...common,
      otherBookAmount: other,
      historyHint: `另有 ${otherSame.length} 个历史记账本（换过 API key）· ${other.toFixed(2)}${tail}`,
    };
  }
  const fromOther = others[0];
  if (fromOther) {
    return {
      day,
      amount: fromOther.amount,
      currency: fromOther.currency,
      source: "balance-observed-other-account",
      label: "已观测消费 · 历史账户",
      firstObservedAt: fromOther.firstObservedAt,
      lastObservedAt: fromOther.lastObservedAt,
      needsReview: fromOther.needsReview,
      ...common,
      ...partialDayInfo(day, { firstAt: fromOther.firstObservedAt, lastAt: fromOther.lastObservedAt }),
    };
  }
  const history = ledger.accounting ? ledger.accounting.legacyHistory : ledger.history;
  const h = history?.[day];
  const hasHistory = typeof h === "number" && Number.isFinite(h);
  return {
    day,
    amount: hasHistory ? preciseMoney(h) : estimate,
    currency: "CNY",
    source: hasHistory ? "legacy" : "events",
    label: hasHistory ? "旧版记录 · 未校正" : "本地估算",
    partialDay: true,
    ...common,
  };
}
