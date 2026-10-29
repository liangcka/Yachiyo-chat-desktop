import type { Locale } from "../../domain/chat";
import type { VerificationSummary as Summary } from "../../domain/verification";
import "../../styles/agent-tools.css";

/**
 * 本次回复的验证结论。只依据命令执行记录：没有运行验证、验证失败、
 * 验证后又改了代码都会明确说明，不会因为模型声称完成就显示通过
 */
export function VerificationSummary({ summary, modifiedFiles, locale }: { summary: Summary; modifiedFiles: number; locale: Locale }) {
  const ja = locale === "ja-JP";
  if (summary.state === "not_run" && modifiedFiles === 0) return null;
  const label = (() => {
    switch (summary.state) {
      case "not_run":
        return ja ? "検証コマンドは実行されていません" : "未运行验证命令";
      case "passed":
        return ja ? "検証済み" : "验证通过";
      case "failed":
        return ja ? "検証失敗" : "验证失败";
      case "stale":
        return ja ? "検証後にコードが変更されました。再検証が必要です" : "验证后又修改了代码，需要重新验证";
      case "incomplete":
        return ja ? "検証が完了していません" : "验证未完成";
    }
  })();
  return (
    <section className={`verification-summary verification-summary--${summary.state}`} aria-label={label}>
      <p className="verification-summary__title">{label}</p>
      {summary.latest.length > 0 ? (
        <ul>
          {summary.latest.map((record) => (
            <li key={record.callId}>
              <code>{record.command}</code>
              <span className={`verification-summary__status verification-summary__status--${record.status}`}>
                {statusText(record.status, record.exitCode, ja)}
                {record.stale ? (ja ? "（変更前の結果）" : "（修改前的结果）") : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.state === "stale" && summary.modifiedAfter.length > 0 ? (
        <p className="verification-summary__hint">{(ja ? "検証後に変更：" : "验证后修改：") + summary.modifiedAfter.join("、")}</p>
      ) : null}
    </section>
  );
}

function statusText(status: string, exitCode: number | undefined, ja: boolean): string {
  switch (status) {
    case "passed":
      return ja ? "成功" : "通过";
    case "failed":
      return exitCode !== undefined ? (ja ? `失敗（終了コード ${exitCode}）` : `失败（退出码 ${exitCode}）`) : (ja ? "失敗" : "失败");
    case "timed_out":
      return ja ? "タイムアウト" : "超时";
    case "cancelled":
      return ja ? "停止" : "已停止";
    default:
      return ja ? "結果不明" : "结果未知";
  }
}
