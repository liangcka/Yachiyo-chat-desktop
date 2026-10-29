import { useContext } from "react";
import { AlertTriangle } from "lucide-react";
import type { ChatMessage, Locale } from "../../domain/chat";
import { collectUnresolvedIssues, type UnresolvedIssue } from "../../domain/run-result";
import { commandStatusLabel } from "../tools/command-status";
import { FollowUpContext } from "./review-context";

function describeIssue(issue: UnresolvedIssue, locale: Locale): string {
  const ja = locale === "ja-JP";
  switch (issue.kind) {
    case "command": {
      const status = issue.record !== undefined
        ? commandStatusLabel(issue.record, locale).text
        : issue.unknown
          ? ja ? "結果不明" : "结果未知"
          : ja ? "失敗" : "失败";
      return ja ? `コマンド ${issue.command}：${status}` : `命令 ${issue.command}：${status}`;
    }
    case "write":
      return ja ? `${issue.path} への書き込みに失敗` : `写入 ${issue.path} 失败`;
    case "unknown_operation":
      return ja ? `${issue.name}：結果を確認できません` : `${issue.name}：无法确认结果`;
    case "supplement":
      return ja ? `届かなかった追加の指示：${issue.text}` : `未送达的补充要求：${issue.text}`;
  }
}

/**
 * 运行结果中仍未解决的问题：只依据命令记录、工具结果与补充要求的送达状态。
 * 最新一条回复提供“继续处理”入口，把这些问题作为新消息交给 Agent。
 */
export function RunResultSummary({ message, locale, latest }: { message: ChatMessage; locale: Locale; latest: boolean }) {
  const followUp = useContext(FollowUpContext);
  // 运行没能正常结束时，未确认结果的操作由恢复提示说明，这里不重复列出
  const issues = collectUnresolvedIssues(message).filter((issue) => message.recovery === undefined || issue.kind !== "unknown_operation");
  if (issues.length === 0) return null;
  const ja = locale === "ja-JP";
  const lines = issues.map((issue) => describeIssue(issue, locale));
  const title = ja ? `未解決の問題 ${issues.length} 件` : `${issues.length} 个未解决的问题`;
  const prompt = ja
    ? `タスクを続けてください。まず次の未解決の問題に対応してください：\n${lines.map((line) => `- ${line}`).join("\n")}`
    : `继续完成任务，先处理以下未解决的问题：\n${lines.map((line) => `- ${line}`).join("\n")}`;
  return (
    <section className="run-result" aria-label={title}>
      <p className="run-result__title"><AlertTriangle size={13} aria-hidden="true" />{title}</p>
      <ul className="run-result__issues">
        {lines.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      {latest && followUp !== undefined ? (
        <button type="button" className="run-result__continue" onClick={() => followUp(prompt)}>
          {ja ? "これらの問題の対応を続ける" : "继续处理这些问题"}
        </button>
      ) : null}
    </section>
  );
}
