import { Plus } from "lucide-react";
import type { UiCopy } from "../../../i18n/messages";

interface SidebarNewChatProps {
  copy: UiCopy;
  onNewChat: () => Promise<void>;
}

export function SidebarNewChat({ copy, onNewChat }: SidebarNewChatProps) {
  return (
    <button
      type="button"
      className="desktop-sidebar__new-btn"
      onClick={() => void onNewChat()}
      title="新建对话 (Ctrl+N)"
    >
      <Plus size={16} />
      <span className="desktop-sidebar__new-btn-label">{copy.newChat}</span>
      <kbd className="desktop-sidebar__kbd">^N</kbd>
    </button>
  );
}
