import { useContext, useState } from "react";
import type { ChatMessage, Locale, RunRecoveryRecord } from "../../domain/chat";
import { unconfirmedOperations, type UnconfirmedOperation } from "../../domain/run-result";
import { ConfirmDialog } from "../ConfirmDialog";
import { FollowUpContext, OpenReviewContext } from "./review-context";

function statusText(recovery: RunRecoveryRecord, ja: boolean): string {
  const base = (() => {
    switch (recovery.status) {
      case "completed":
        return ja ? "タスクはバックグラウンドで完了しましたが、最後の出力を受け取れませんでした。" : "任务已在后台完成，但最后的输出没有接收到。";
      case "failed":
        return ja ? "タスクはバックグラウンドで失敗しました。最後の出力は受け取れていません。" : "任务已在后台失败，最后的输出没有接收到。";
      case "cancelled":
        return ja ? "タスクはバックグラウンドでキャンセルされました。" : "任务已在后台取消。";
      case "interrupted":
        return ja ? "タスクは終了前に中断されました（アプリの終了またはゲートウェイの再起動）。" : "任务在结束前被中断（应用退出或网关重启）。";
      case "unknown":
        return ja ? "タスクの結果を確認できません（ゲートウェイに記録がないか、接続できません）。" : "无法确认任务结果（网关没有这次运行的记录或无法连接）。";
    }
  })();
  return recovery.gap === true ? `${base}${ja ? "一部の過程は復元できませんでした。" : "部分过程未能回填。"}` : base;
}

function describe(operation: UnconfirmedOperation): string {
  return operation.target !== undefined ? `${operation.name} ${operation.target}` : operation.name;
}

function continuationPrompt(recovery: RunRecoveryRecord, operations: ReadonlyArray<UnconfirmedOperation>, ja: boolean): string {
  const list = operations.map((operation) => `- ${describe(operation)}`).join("\n");
  if (ja) {
    return [
      `前回のタスクは正常に終了しませんでした（${statusText(recovery, true)}）。`,
      operations.length > 0 ? `次の操作は結果が確認できていません：\n${list}` : "",
      "まず現在のファイルと状態を確認し、これらの操作が反映されているかを確かめてからタスクを続けてください。実行済み・未実行のどちらとも決めつけないでください。",
    ].filter(Boolean).join("\n");
  }
  return [
    `上次任务没有正常结束（${statusText(recovery, false)}）`,
    operations.length > 0 ? `以下操作没有确认结果：\n${list}` : "",
    "请先检查当前文件和状态，确认这些操作是否已生效，再继续完成任务；不要假设它们已执行或未执行。",
  ].filter(Boolean).join("\n");
}

/**
 * 运行没能正常接收到终止事件时的说明与入口：查看该运行的改动、继续任务（附上未确认结果的操作）、
 * 重新尝试（存在未确认的写入时先确认，因为重新执行可能重复写入）。任何操作都不会自动重放。
 */
export function RunRecoveryNotice({ message, locale, latest, onRegenerate }: {
  message: ChatMessage;
  locale: Locale;
  latest: boolean;
  onRegenerate?: () => void;
}) {
  const openReview = useContext(OpenReviewContext);
  const followUp = useContext(FollowUpContext);
  const [confirming, setConfirming] = useState(false);
  const ja = locale === "ja-JP";
  if (message.reconnecting === true) {
    return (
      <div className="message-bubble__run-note message-bubble__run-note--warning" role="status">
        <span>{ja ? "ゲートウェイとの接続が切れました。再接続しています…" : "与本地网关的连接中断，正在重新连接…"}</span>
      </div>
    );
  }
  const recovery = message.recovery;
  if (recovery === undefined) return null;
  const operations = unconfirmedOperations(message);
  const sideEffects = operations.filter((operation) => operation.sideEffect);
  const workspace = message.run?.workspace ?? null;
  const settledAsCompleted = recovery.status === "completed" && recovery.gap === true;
  return (
    <div className="message-bubble__run-note message-bubble__run-note--warning run-recovery" role="status">
      <span>{statusText(recovery, ja)}</span>
      {operations.length > 0 ? (
        <span className="run-recovery__operations">
          {ja ? "結果未確認の操作：" : "未确认结果的操作："}{operations.map(describe).join("、")}
          {ja ? "（自動で再実行はしません）" : "（不会自动重放）"}
        </span>
      ) : null}
      <span className="run-recovery__actions">
        {message.run !== undefined && workspace !== null && openReview !== undefined ? (
          <button type="button" onClick={() => openReview({ runId: message.run!.id, workspace })}>{ja ? "変更を確認" : "查看改动"}</button>
        ) : null}
        {latest && followUp !== undefined && !settledAsCompleted ? (
          <button type="button" onClick={() => followUp(continuationPrompt(recovery, operations, ja))}>{ja ? "タスクを続ける" : "继续任务"}</button>
        ) : null}
        {latest && onRegenerate !== undefined && !settledAsCompleted ? (
          <button type="button" onClick={() => (sideEffects.length > 0 ? setConfirming(true) : onRegenerate())}>{ja ? "やり直す" : "重新尝试"}</button>
        ) : null}
      </span>
      <ConfirmDialog
        open={confirming}
        title={ja ? "最初からやり直しますか？" : "从头重新尝试这个任务？"}
        message={ja
          ? `次の操作は結果が確認できていません。やり直すと同じ書き込みが重複する可能性があります：${sideEffects.map(describe).join("、")}。すでに変更されたファイルは自動で元に戻りません。先に「変更を確認」で処理できます。`
          : `以下操作没有确认结果，重新执行可能重复写入：${sideEffects.map(describe).join("、")}。已改动的文件不会自动撤销，可先在“查看改动”中处理。`}
        confirmLabel={ja ? "やり直す" : "重新尝试"}
        cancelLabel={ja ? "キャンセル" : "取消"}
        danger
        onConfirm={() => { setConfirming(false); onRegenerate?.(); }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
