import { CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, ListTodo } from "lucide-react";
import { useState } from "react";
import type { TodoItem } from "../../domain/chat";
import "./PlanStrip.css";

export interface PlanStripProps {
  todos: ReadonlyArray<TodoItem>;
  className?: string;
}

export function PlanStrip({ todos, className = "" }: PlanStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (!todos || todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const inProgressItem = todos.find((t) => t.status === "in_progress");
  const totalCount = todos.length;

  return (
    <div
      className={`plan-strip ${expanded ? "plan-strip--expanded" : ""} ${className}`.trim()}
      role="region"
      aria-label="Agent 任务清单"
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
            任务进度 {completedCount}/{totalCount}
          </span>
          {inProgressItem ? (
            <span className="plan-strip__active-task" title={inProgressItem.content}>
              {inProgressItem.content}
            </span>
          ) : completedCount === totalCount ? (
            <span className="plan-strip__completed-label">所有计划步骤已完成</span>
          ) : (
            <span className="plan-strip__idle-label">待继续推进</span>
          )}
        </div>

        <button
          type="button"
          className="plan-strip__toggle"
          aria-label={expanded ? "收起任务清单" : "展开任务清单"}
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
            const isActive = item.status === "in_progress";

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
                  <span className="plan-strip__item-badge">进行中</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
