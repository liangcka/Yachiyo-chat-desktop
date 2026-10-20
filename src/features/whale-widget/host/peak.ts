/**
 * DeepSeek 峰谷计价规则，移植自上游 lib/index.js（MIT）。
 * 北京时间工作日 9–12、14–18 点为高峰；2026-08-23 起周末全天谷价，
 * 2026-09-19 起法定节假日全天谷价。挂件前端的倒计时依赖宿主下发的切换点与节假日清单。
 */
const PEAK_HOURS: ReadonlyArray<readonly [number, number]> = [[9, 12], [14, 18]];
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000);
const HOLIDAY_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000);

/** 只列放假日期；调休上班日都落在周末，按周末规则已是谷价。每年国务院公布次年安排后需补充 */
export const HOLIDAY_VALLEY_LIST: readonly string[] = [
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
  "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
];
const HOLIDAYS = new Set(HOLIDAY_VALLEY_LIST);

export function isPeakTime(timeSec: number): boolean {
  if (!Number.isFinite(timeSec)) return false;
  // 平移 8 小时后按 UTC 读即为北京时间
  const bj = new Date(timeSec * 1000 + 8 * 3600 * 1000);
  if (timeSec >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay();
    if (dow === 0 || dow === 6) return false;
  }
  if (timeSec >= HOLIDAY_VALLEY_FROM_SEC && HOLIDAYS.has(bj.toISOString().slice(0, 10))) return false;
  const hour = bj.getUTCHours();
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end);
}

/** 下一个峰谷切换时刻（epoch 秒）；最长假期 9 天，扫 12 天足够，找不到返回 null 交给前端自行推算 */
export function nextPeakChangeAt(timeSec: number): number | null {
  if (!Number.isFinite(timeSec)) return null;
  const current = isPeakTime(timeSec);
  const day0 = Math.floor((timeSec + 8 * 3600) / 86400) * 86400;
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const candidate = day0 + d * 86400 + edge * 3600 - 8 * 3600;
      if (candidate <= timeSec + 1) continue;
      if (isPeakTime(candidate) !== current) return candidate;
    }
  }
  return null;
}
