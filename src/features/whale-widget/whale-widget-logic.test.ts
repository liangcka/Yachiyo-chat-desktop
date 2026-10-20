import { describe, expect, it } from "vitest";
import { localDateKey, observeBalance, pickDeepSeekBalance } from "./balance";
import { peakStatus } from "./peak-hours";

describe("pickDeepSeekBalance", () => {
  it("优先有余额的 CNY，与数组顺序无关", () => {
    const balance = pickDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: "USD", total_balance: "3.00", granted_balance: "0", topped_up_balance: "3.00" },
        { currency: "CNY", total_balance: "110.50", granted_balance: "10.00", topped_up_balance: "100.50" },
      ],
    });
    expect(balance).toEqual({ currency: "CNY", total: 110.5, granted: 10, toppedUp: 100.5, available: true });
  });

  it("CNY 为零时改取有余额的币种，全为零时退回 CNY", () => {
    const zeroCny = { currency: "CNY", total_balance: "0.00" };
    expect(pickDeepSeekBalance({ balance_infos: [zeroCny, { currency: "USD", total_balance: "1.20" }] })?.currency).toBe("USD");
    expect(pickDeepSeekBalance({ balance_infos: [{ currency: "USD", total_balance: "0" }, zeroCny] })?.currency).toBe("CNY");
  });

  it("结构不合法时返回 null", () => {
    expect(pickDeepSeekBalance(null)).toBeNull();
    expect(pickDeepSeekBalance({ balance_infos: "oops" })).toBeNull();
    expect(pickDeepSeekBalance({ balance_infos: [{ currency: "CNY", total_balance: "abc" }] })).toBeNull();
  });
});

describe("observeBalance", () => {
  const day = "2026-10-20";

  it("余额下降累计为当天消费，上升只移动基准", () => {
    let { ledger } = observeBalance(null, { currency: "CNY", total: 88.8 }, day);
    const drop = observeBalance(ledger, { currency: "CNY", total: 88.7712 }, day);
    expect(drop.spent).toBe(0.0288);
    ledger = observeBalance(drop.ledger, { currency: "CNY", total: 188.7712 }, day).ledger;
    const second = observeBalance(ledger, { currency: "CNY", total: 188.7 }, day);
    expect(second.spent).toBe(0.0712);
    expect(second.ledger.todaySpent).toBe(0.1);
  });

  it("跨天或换币种时重新起账", () => {
    const { ledger } = observeBalance(
      { date: day, currency: "CNY", lastBalance: 10, todaySpent: 2 },
      { currency: "CNY", total: 9 },
      "2026-10-21",
    );
    expect(ledger).toEqual({ date: "2026-10-21", currency: "CNY", lastBalance: 9, todaySpent: 0 });
    const switched = observeBalance(ledger, { currency: "USD", total: 1 }, "2026-10-21");
    expect(switched.spent).toBe(0);
    expect(switched.ledger.currency).toBe("USD");
  });

  it("本地日期键补零", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("peakStatus", () => {
  it("工作日高峰在北京时间整点切换", () => {
    // 2026-10-20 是周二，北京时间 10:30 = UTC 02:30
    const status = peakStatus(new Date("2026-10-20T02:30:00Z"));
    expect(status.peak).toBe(true);
    expect(status.nextChange.toISOString()).toBe("2026-10-20T04:00:00.000Z");
  });

  it("午间谷价在 14 点回到高峰", () => {
    const status = peakStatus(new Date("2026-10-20T04:10:00Z"));
    expect(status.peak).toBe(false);
    expect(status.nextChange.toISOString()).toBe("2026-10-20T06:00:00.000Z");
  });

  it("周五 18 点后整个周末为谷价，下周一 9 点进入高峰", () => {
    const status = peakStatus(new Date("2026-10-23T11:00:00Z"));
    expect(status.peak).toBe(false);
    expect(status.nextChange.toISOString()).toBe("2026-10-26T01:00:00.000Z");
  });
});
