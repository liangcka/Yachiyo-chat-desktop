import { CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, ListTodo } from "lucide-react";
import { useState } from "react";
import type { TodoItem } from "../../domain/chat";
import { useLocale } from "../../i18n/locale-context";
import "./PlanStrip.css";

export interface PlanStripProps {
  todos: ReadonlyArray<TodoItem>;
  /** 是否有运行在进行：运行结束后计划里的“进行中”只是停下的位置，不再显示为正在执行 */
  running?: boolean;
  className?: string;
}

/**
 * Agent 自己维护的计划进度。它只反映模型的自我报告，不是执行结果：
 * 验证结论与未解决的问题以命令记录为准，见消息下方的结果区。
 */
export function PlanStrip({ todos, running = true, className = "" }: PlanStripProps) {
  const ja = useLocale() === "ja-JP";
  const [expanded, setExpanded] = useState(false);

  if (!todos || todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const currentItem = todos.find((t) => t.status === "in_progress");
  const inProgressItem = running ? currentItem : undefined;
  const stoppedAt = running ? undefined : currentItem;
  const totalCount = todos.length;

  return (
    <div
      className={`plan-strip ${expanded ? "plan-strip--expanded" : ""} ${className}`.trim()}
      role="region"
      aria-label={ja ? "Agent の計画" : "Agent 计划"}
    >
      <div
        className="plan-strip__header"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <div className="plan-strip__icon-badge">
          {inProgressItem ? (
            <Loader2 className="plan-strip__spinner" size={14} />
          ) : completedCount === totalCount ? (
            <CheckCircle2 size={14} className="plan-strip__icon--done" />
          ) : (
            <ListTodo size={14} />
          )}
        </div>

        <div className="plan-strip__summary">
          <span className="plan-strip__counter">
            {ja ? "計画の進捗" : "计划进度"} {completedCount}/{totalCount}
          </span>
          {inProgressItem ? (
            <span className="plan-strip__active-task" title={inProgressItem.content}>
              {inProgressItem.content}
            </span>
          ) : stoppedAt !== undefined ? (
            <span className="plan-strip__idle-label" title={stoppedAt.content}>
              {ja ? `ここで停止：${stoppedAt.content}` : `停在：${stoppedAt.content}`}
            </span>
          ) : completedCount === totalCount ? (
            <span className="plan-strip__completed-label">{ja ? "計画のステップはすべて完了と記録されています" : "计划步骤均已标记完成"}</span>
          ) : (
            <span className="plan-strip__idle-label">{ja ? "続きを待っています" : "待继续推进"}</span>
          )}
        </div>

        <button
          type="button"
          className="plan-strip__toggle"
          aria-label={
            expanded
              ? ja ? "タスクリストを閉じる" : "收起任务清单"
              : ja ? "タスクリストを開く" : "展开任务清单"
          }
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {expanded ? (
        <ul className="plan-strip__list">
          {todos.map((item, index) => {
            const isDone = item.status === "completed";
            const isActive = item.status === "in_progress" && running;
            const isStopped = item.status === "in_progress" && !running;

            return (
              <li
                key={index}
                className={`plan-strip__item plan-strip__item--${item.status}`}
              >
                <div className="plan-strip__item-status" aria-hidden="true">
                  {isDone ? (
                    <CheckCircle2 size={14} className="plan-strip__icon--done" />
                  ) : isActive ? (
                    <Loader2 size={14} className="plan-strip__spinner" />
                  ) : (
                    <Circle size={14} className="plan-strip__icon--pending" />
                  )}
                </div>
                <span className="plan-strip__item-content">{item.content}</span>
                {isActive ? (
                  <span className="plan-strip__item-badge">{ja ? "実行中" : "进行中"}</span>
                ) : isStopped ? (
                  <span className="plan-strip__item-badge">{ja ? "未完了" : "未完成"}</span>
                ) : null}
              </li>
            );
          })}
          <li className="plan-strip__note">
            {ja ? "計画は Agent 自身が更新します。検証結果はコマンドの実行記録を基準にしてください。" : "计划由 Agent 自行更新；是否通过验证以命令执行记录为准。"}
          </li>
        </ul>
      ) : null}
    </div>
  );
}
