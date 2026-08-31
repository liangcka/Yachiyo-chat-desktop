import { PanelLeftClose, Sparkles } from "lucide-react";

interface SidebarBrandHeaderProps {
  onNewChat: () => Promise<void>;
  onToggleCollapse?: () => void;
}

export function SidebarBrandHeader({ onNewChat, onToggleCollapse }: SidebarBrandHeaderProps) {
  return (
    <div className="desktop-sidebar__brand-row">
      <button
        type="button"
        className="desktop-sidebar__brand-btn"
        onClick={() => void onNewChat()}
        title="月见八千代 (Tsukimi Yachiyo)"
      >
        <span className="desktop-sidebar__brand-icon-wrap">
          <Sparkles size={15} className="desktop-sidebar__brand-icon" />
        </span>
        <span className="desktop-sidebar__brand-title">月见八千代</span>
      </button>
      {onToggleCollapse ? (
        <button
          type="button"
          className="desktop-sidebar__ghost-btn"
          onClick={onToggleCollapse}
          title="折叠侧边栏 (Ctrl+[)"
          aria-label="折叠侧边栏"
        >
          <PanelLeftClose size={16} />
        </button>
      ) : null}
    </div>
  );
}
