import { useContext } from "react";
import type { Locale, RunNoteRecord } from "../../domain/chat";
import { FollowUpContext } from "./review-context";

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

function noteText(note: RunNoteRecord, ja: boolean): string {
  switch (note.kind) {
    case "context_compacted":
      return ja
        ? `文脈を圧縮しました：以前の ${note.foldedTurns} ステップを折りたたみました（約 ${formatTokens(note.beforeTokens)} → ${formatTokens(note.afterTokens)} tokens）。目的・追加の指示・変更ファイル・失敗の記録はまとめに残しています。`
        : `上下文已压缩：折叠了 ${note.foldedTurns} 轮较早的步骤（约 ${formatTokens(note.beforeTokens)} → ${formatTokens(note.afterTokens)} tokens），目标、补充要求、改动文件与失败记录保留在摘要中。`;
    case "context_overflow":
      return ja
        ? `文脈がモデルのウィンドウに収まらないため停止しました（約 ${formatTokens(note.tokens)} tokens、上限 ${formatTokens(note.budgetTokens)}）。`
        : `上下文超出模型窗口，任务已停止（约 ${formatTokens(note.tokens)} tokens，预算 ${formatTokens(note.budgetTokens)}）。`;
    case "verification_reminder":
      return note.reason === "not_verified"
        ? ja
          ? `変更したコードが未検証のまま終わろうとしたため、検証するよう促しました（${note.files.join("、")}）。`
          : `Agent 准备结束时，修改的代码尚未验证（${note.files.join("、")}），已提醒它先验证。`
        : ja
          ? `直近の検証が通っていないため（${note.command}）、対応してから完了するよう促しました。`
          : `最近一次验证未通过（${note.command}），已提醒 Agent 处理后再交付。`;
  }
}

/** 运行过程中的说明：上下文压缩与超限、交付前的执行反馈；超限时最新回复可继续任务 */
export function RunNotes({ notes, locale, latest }: { notes: ReadonlyArray<RunNoteRecord>; locale: Locale; latest: boolean }) {
  const followUp = useContext(FollowUpContext);
  if (notes.length === 0) return null;
  const ja = locale === "ja-JP";
  const overflow = notes.some((note) => note.kind === "context_overflow");
  return (
    <section className="run-notes" aria-label={ja ? "実行中の通知" : "运行提示"}>
      <ul>
        {notes.map((note, index) => (
          <li key={index} className={`run-notes__item run-notes__item--${note.kind}`}>{noteText(note, ja)}</li>
        ))}
      </ul>
      {overflow && latest && followUp !== undefined ? (
        <button
          type="button"
          className="run-notes__continue"
          onClick={() => followUp(ja
            ? "文脈が上限に達したため前回の実行は停止しました。現在のファイルと状態を確認し、残りの作業を続けてください。"
            : "上次运行因上下文已满而停止。请先检查当前文件和状态，再继续完成剩余的工作。")}
        >
          {ja ? "タスクを続ける" : "继续任务"}
        </button>
      ) : null}
    </section>
  );
}
