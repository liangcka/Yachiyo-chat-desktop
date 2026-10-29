import { useContext } from "react";
import type { Locale, SupplementRecord } from "../../domain/chat";
import { FollowUpContext } from "./review-context";

function stateLabel(state: SupplementRecord["state"], ja: boolean): string {
  switch (state) {
    case "queued":
      return ja ? "待機中" : "排队中";
    case "delivered":
      return ja ? "送信済み" : "已送达";
    case "undelivered":
      return ja ? "未送信" : "未送达";
  }
}

/** 运行中追加的补充要求：排队中、已送达模型、运行结束前未送达（可作为新消息发送） */
export function SupplementList({ supplements, locale }: { supplements: ReadonlyArray<SupplementRecord>; locale: Locale }) {
  const followUp = useContext(FollowUpContext);
  if (supplements.length === 0) return null;
  const ja = locale === "ja-JP";
  const title = ja ? "追加の指示" : "补充要求";
  return (
    <section className="supplement-list" aria-label={title}>
      <p className="supplement-list__title">{title}</p>
      <ul>
        {supplements.map((item) => (
          <li key={item.id} className={`supplement-list__item supplement-list__item--${item.state}`}>
            <span className="supplement-list__text">{item.text}</span>
            <span className="supplement-list__state">{stateLabel(item.state, ja)}</span>
            {item.state === "undelivered" && followUp !== undefined ? (
              <button type="button" className="supplement-list__resend" onClick={() => followUp(item.text)}>
                {ja ? "新しいメッセージとして送信" : "作为新消息发送"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
