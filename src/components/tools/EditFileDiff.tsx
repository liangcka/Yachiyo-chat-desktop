import { useMemo } from "react";
import type { Locale } from "../../domain/chat";
import { toReviewHunks } from "../editor/diff-merge";
import "../../styles/agent-tools.css";

export function EditFileDiff({ args, locale }: { args?: Record<string, unknown>; locale: Locale }) {
  const old = typeof args?.old_string === "string" ? args.old_string : undefined;
  const next = typeof args?.new_string === "string" ? args.new_string : undefined;
  const hunks = useMemo(() => old !== undefined && next !== undefined
    ? toReviewHunks(old.replace(/\r\n/gu, "\n"), next.replace(/\r\n/gu, "\n")) : [], [old, next]);
  if (old === undefined || next === undefined) return null;
  const isJa = locale === "ja-JP";
  const label = isJa ? "変更箇所のプレビュー" : "片段改动预览";
  return (
    <section className="edit-file-diff" aria-label={label}>
      <div className="edit-file-diff__header">
        <span>{label}</span>
        {args?.replace_all === true ? <span>{isJa ? "一致箇所をすべて置換" : "替换所有匹配处"}</span> : null}
      </div>
      <div className="edit-file-diff__body" role="region" aria-label={isJa ? "差分の行" : "差异行"}>
        {hunks.length === 0 ? <p>{isJa ? "内容の差分はありません" : "片段内容无差异"}</p> : hunks.map((hunk) => {
          let oldLine = hunk.oldStart;
          let newLine = hunk.newStart;
          return <div key={`${hunk.oldStart}-${hunk.newStart}`}>
            <div className="edit-file-diff__range">@@ -{hunk.oldStart} +{hunk.newStart} @@</div>
            {hunk.lines.map((line, index) => {
              const oldNo = line.type === "add" ? "" : oldLine++;
              const newNo = line.type === "del" ? "" : newLine++;
              return <div className={`edit-file-diff__line edit-file-diff__line--${line.type}`} key={index}>
                <span className="edit-file-diff__number" aria-hidden="true">{oldNo}</span>
                <span className="edit-file-diff__number" aria-hidden="true">{newNo}</span>
                <span className="edit-file-diff__sign">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                <code>{line.text || " "}</code>
              </div>;
            })}
          </div>;
        })}
      </div>
    </section>
  );
}
