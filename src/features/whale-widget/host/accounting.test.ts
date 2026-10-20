import { describe, expect, it } from "vitest";
import { balanceSummary, daySummary, freshLedger, observeBalance, reconcileBalance } from "./accounting";
import { isPeakTime, nextPeakChangeAt } from "./peak";

// 北京时间 2026-10-20 10:00
const T0 = Date.parse("2026-10-20T02:00:00Z");

describe("小鲸鱼记账", () => {
  it("余额下降记为消费，上升单独记录且不冲掉已有消费", () => {
    const ledger = freshLedger(T0);
    observeBalance(ledger, { balance: 88.8, currency: "CNY", scope: "key-a", at: T0 });
    observeBalance(ledger, { balance: 88.7712, currency: "CNY", scope: "key-a", at: T0 + 60_000 });
    observeBalance(ledger, { balance: 188.7712, currency: "CNY", scope: "key-a", at: T0 + 120_000 });
    const summary = observeBalance(ledger, { balance: 188.7, currency: "CNY", scope: "key-a", at: T0 + 180_000 });
    expect(summary?.amount).toBe(0.1);
    expect(summary?.observedIncrease).toBe(100);
    expect(summary?.needsReview).toBe(true);
    expect(summary?.label).toBe("已观测消费 · 待核对余额调整");
  });

  it("乱序样本被忽略，跨天重新起算", () => {
    const ledger = freshLedger(T0);
    observeBalance(ledger, { balance: 10, currency: "CNY", scope: "default", at: T0 });
    observeBalance(ledger, { balance: 9, currency: "CNY", scope: "default", at: T0 - 1 });
    expect(balanceSummary(ledger, "2026-10-20")?.amount).toBe(0);
    observeBalance(ledger, { balance: 8, currency: "CNY", scope: "default", at: T0 + 86_400_000 });
    expect(balanceSummary(ledger, "2026-10-21")?.amount).toBe(0);
    expect(ledger.date).toBe("2026-10-21");
  });

  it("换 Key 后旧账本的日期仍可见", () => {
    const ledger = freshLedger(T0);
    observeBalance(ledger, { balance: 10, currency: "CNY", scope: "key-a", at: T0 });
    observeBalance(ledger, { balance: 9.5, currency: "CNY", scope: "key-a", at: T0 + 1000 });
    observeBalance(ledger, { balance: 50, currency: "CNY", scope: "key-b", at: T0 + 86_400_000 });
    expect(daySummary(ledger, "2026-10-20")).toMatchObject({ amount: 0.5, source: "balance-observed-other-account" });
  });

  it("余额校正按累计到账金额重算消费，版本不符时拒绝", () => {
    const ledger = freshLedger(T0);
    observeBalance(ledger, { balance: 10, currency: "CNY", scope: "default", at: T0 });
    observeBalance(ledger, { balance: 110, currency: "CNY", scope: "default", at: T0 + 1000 });
    observeBalance(ledger, { balance: 108, currency: "CNY", scope: "default", at: T0 + 2000 });
    const revision = balanceSummary(ledger, "2026-10-20")?.revision;
    expect(() => reconcileBalance(ledger, { day: "2026-10-20", revision: "stale", confirmed: true, credits: "100" })).toThrow(/重新打开/u);
    const corrected = reconcileBalance(ledger, { day: "2026-10-20", revision, confirmed: true, credits: "100" });
    expect(corrected).toMatchObject({ amount: 2, source: "balance-corrected", needsReview: false });
  });
});

describe("峰谷时段", () => {
  const sec = (iso: string) => Date.parse(iso) / 1000;

  it("工作日北京时间 9–12、14–18 点为高峰", () => {
    expect(isPeakTime(sec("2026-10-20T02:30:00Z"))).toBe(true);
    expect(isPeakTime(sec("2026-10-20T04:30:00Z"))).toBe(false);
    expect(nextPeakChangeAt(sec("2026-10-20T02:30:00Z"))).toBe(sec("2026-10-20T04:00:00Z"));
  });

  it("周末与法定节假日全天谷价", () => {
    expect(isPeakTime(sec("2026-10-24T02:30:00Z"))).toBe(false);
    expect(isPeakTime(sec("2026-10-05T02:30:00Z"))).toBe(false);
    // 周五 18 点后下一次高峰是周一 9 点
    expect(nextPeakChangeAt(sec("2026-10-23T11:00:00Z"))).toBe(sec("2026-10-26T01:00:00Z"));
  });
});
