const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface PeakStatus {
  readonly peak: boolean;
  /** 下一次在高峰与谷价之间切换的时刻 */
  readonly nextChange: Date;
}

/** DeepSeek 峰谷计价按北京时间：工作日 9–12 点、14–18 点为高峰，其余时段与周末全天为谷价 */
function isPeakAt(time: number): boolean {
  const beijing = new Date(time + BEIJING_OFFSET_MS);
  const day = beijing.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = beijing.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

/** 时段边界都落在整点，逐小时向后找到第一个状态翻转的整点即可（最长跨越一个周末） */
export function peakStatus(now: Date): PeakStatus {
  const time = now.getTime();
  const peak = isPeakAt(time);
  let boundary = Math.floor(time / HOUR_MS) * HOUR_MS + HOUR_MS;
  while (isPeakAt(boundary) === peak) boundary += HOUR_MS;
  return { peak, nextChange: new Date(boundary) };
}
