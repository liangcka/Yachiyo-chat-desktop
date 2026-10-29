import type { CommandRecord, Locale } from "../../domain/chat";

function formatSeconds(ms: number, locale: Locale): string {
  if (ms < 1000) return locale === "ja-JP" ? `${ms} ミリ秒` : `${ms} 毫秒`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/** 命令结论的短标签：以网关回报的退出码与结束原因为准 */
export function commandStatusLabel(record: CommandRecord, locale: Locale): { text: string; tone: "ok" | "error" | "warning" } {
  const ja = locale === "ja-JP";
  const duration = formatSeconds(record.durationMs, locale);
  if (!record.exitConfirmed) {
    return { text: ja ? "停止を確認できず · 結果不明" : "未能确认进程退出 · 结果未知", tone: "warning" };
  }
  switch (record.endReason) {
    case "exited":
      return record.exitCode === 0
        ? { text: ja ? `終了コード 0 · ${duration}` : `退出码 0 · ${duration}`, tone: "ok" }
        : { text: record.exitCode === undefined ? (ja ? "シグナルで終了" : "被信号终止") : (ja ? `終了コード ${record.exitCode} · ${duration}` : `退出码 ${record.exitCode} · ${duration}`), tone: "error" };
    case "timed_out":
      return { text: ja ? `タイムアウト · ${duration}` : `超时 · ${duration}`, tone: "error" };
    case "cancelled":
      return { text: ja ? `停止済み · ${duration}` : `已停止 · ${duration}`, tone: "warning" };
    case "spawn_failed":
      return { text: ja ? "起動失敗" : "未能启动", tone: "error" };
    case "blocked":
      return { text: ja ? "安全ポリシーで拒否" : "被安全策略拦截", tone: "error" };
  }
}
