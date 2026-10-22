import type { useChatController } from "../app/use-chat-controller";
import type { LlmEntryDraft, LlmProviderEntry } from "../components/LlmSettingsPanel";
import type { Conversation, Locale } from "../domain/chat";
import type { ImageProcessingErrorCode, ProcessedImage } from "../features/capture/image-processor";
import type { UiCopy } from "../i18n/messages";
import type { usePwaUpdate } from "../pwa/use-pwa-update";
import type { WebSearchSettings } from "../services/web-search-settings";

export interface SharedViewProps {
  controller: ReturnType<typeof useChatController>;
  copy: UiCopy;
  isOnline: boolean;
  conversations: Conversation[];
  imageUrls: ReadonlyMap<string, string>;
  pendingImageDataUrl?: string;
  composerValue: string;
  setComposerValue: (value: string) => void;
  activeProviderSupportsImage: boolean;
  activeSkillIds: string[];
  /** 当前使用的模型配置 id */
  llmActiveEntryId?: string;
  llmEntries: readonly LlmProviderEntry[];
  webSearchSettings: WebSearchSettings;
  pwa: ReturnType<typeof usePwaUpdate>;
  processImage: (file: File) => Promise<ProcessedImage>;
  setPendingImageDataUrl: (url?: string) => void;

  onSend: (value: string) => void;
  onImage: (image: ProcessedImage) => void;
  onRecall: () => Promise<void>;
  onRegenerate: (messageId?: string) => Promise<void>;
  onNewChat: () => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onArchive?: (id: string, archived: boolean) => Promise<void>;
  onClearData: () => Promise<void>;
  onLocale: (locale: Locale) => Promise<void>;
  onSignOut: () => Promise<void>;
  /** 保存一条模型配置，返回其 id；draft.id 缺省时新建 */
  onLlmSave: (draft: LlmEntryDraft) => Promise<string>;
  onLlmClear: (id: string) => Promise<void>;
  onLlmActivate: (id: string) => Promise<void>;
  onLlmSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  onSkillToggle: (id: string, next: boolean) => Promise<void>;
  onWebSearchSettingsChange: (partial: Partial<WebSearchSettings>) => void;
  showToast: (message: string, tone?: "info" | "error") => void;
  refreshHistory: () => Promise<void>;
  refreshLlm: () => Promise<void>;
}

export function imageErrorMessage(code: ImageProcessingErrorCode, copy: UiCopy): string {
  if (code === "IMAGE_INVALID") return copy.imageInvalid;
  if (code === "IMAGE_TOO_LARGE") return copy.imageTooLarge;
  return copy.genericFailure;
}

export function controllerErrorMessage(code: string, copy: UiCopy): string {
  if (code === "DAILY_QUOTA_EXCEEDED") return copy.quotaReached;
  if (code === "SESSION_REQUIRED") return copy.sessionExpired;
  if (code === "WORKSPACE_REQUIRED") return copy.workspaceRequired;
  if (code === "API_KEY_MISSING") return copy.apiKeyMissing;
  if (code === "NETWORK_ERROR") return copy.offline;
  if (code === "STORAGE_ERROR") return copy.storageFull;
  return copy.genericFailure;
}
