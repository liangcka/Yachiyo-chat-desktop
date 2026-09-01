import type { Conversation, Locale } from "../../../domain/chat";
import type { UiCopy } from "../../../i18n/messages";
import type { SettingsTabKey } from "../../../components/settings/SettingsModal";

export type DesktopRightTab = "workspace" | "llm" | "skills" | "memory" | "settings" | "none";

export type TimeGroupKey = "pinned" | "today" | "yesterday" | "previous7Days" | "older";

export interface ConversationGroup {
  key: TimeGroupKey;
  label: string;
  items: Conversation[];
}

export interface DesktopSidebarProps {
  activeConversationId?: string;
  activeRightTab: DesktopRightTab;
  collapsed?: boolean;
  conversations: Conversation[];
  copy: UiCopy;
  locale: Locale;
  onClearData?: () => Promise<void>;
  onCompress?: () => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onLocale?: (locale: Locale) => Promise<void>;
  onNewChat: () => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabKey) => void;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onSelectRightTab: (tab: DesktopRightTab) => void;
  onSignOut?: () => Promise<void>;
  onToggleCollapse?: () => void;
  onTogglePinConversation?: (id: string) => void;
  onToggleTheme?: () => void;
  resolvedTheme?: "light" | "dark";
}
