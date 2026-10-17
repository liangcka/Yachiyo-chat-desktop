import { Plus } from "lucide-react";
import type { UiCopy } from "../../../i18n/messages";

interface SidebarNewChatProps {
  copy: UiCopy;
  onNewChat: () => Promise<void>;
  onOpenSettings?: () => void;
  onSelectProject?: (path: string | null) => void;
}

export function SidebarNewChat({ copy, onNewChat }: SidebarNewChatProps) {
  return (
    <button
      type="button"
      className="desktop-sidebar__new-btn"
      onClick={() => void onNewChat()}
      title={`${copy.newChat} (Ctrl+N)`}
    >
      <Plus size={15} aria-hidden="true" />
      <span className="desktop-sidebar__new-btn-label">{copy.newChat}</span>
    </button>
  );
}

