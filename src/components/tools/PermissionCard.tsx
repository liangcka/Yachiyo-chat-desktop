import { ShieldAlert } from "lucide-react";

export interface PermissionCardProps {
  toolName: string;
  argumentsJson: string;
  onApprove: (sessionScope: boolean) => void;
  onDeny: () => void;
}

/** 写类工具的批准卡片（跟随 ToolCard 的硬编码中文现状，不入 i18n） */
export function PermissionCard({ toolName, argumentsJson, onApprove, onDeny }: PermissionCardProps) {
  return (
    <div aria-label="工具执行授权" className="permission-card" role="alertdialog">
      <div className="permission-card__header">
        <ShieldAlert size={16} />
        <span>八千代请求执行写操作</span>
      </div>
      <div className="permission-card__body">
        <p className="permission-card__tool">{toolName}</p>
        <pre className="permission-card__args">{argumentsJson}</pre>
      </div>
      <div className="permission-card__actions">
        <button className="permission-card__btn permission-card__btn--deny" onClick={onDeny} type="button">
          拒绝
        </button>
        <button className="permission-card__btn" onClick={() => onApprove(false)} type="button">
          批准一次
        </button>
        <button className="permission-card__btn permission-card__btn--primary" onClick={() => onApprove(true)} type="button">
          批准并本会话不再询问
        </button>
      </div>
    </div>
  );
}
