import { Download, X } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { openExternalUrl } from "../../services/desktop-bridge";
import type { AvailableUpdate } from "../../services/update-check";

export interface DesktopUpdateNoticeProps {
  copy: UiCopy;
  update: AvailableUpdate;
  onDismiss: () => void;
}

export function DesktopUpdateNotice({ copy, update, onDismiss }: DesktopUpdateNoticeProps) {
  return (
    <div className="desktop-update-notice" role="status">
      <Download aria-hidden="true" size={16} className="desktop-update-notice__icon" />
      <span className="desktop-update-notice__text">{copy.desktopUpdateAvailable(update.version)}</span>
      <button
        type="button"
        className="desktop-update-notice__action"
        onClick={() => {
          void openExternalUrl(update.url);
          onDismiss();
        }}
      >
        {copy.desktopUpdateAction}
      </button>
      <button
        type="button"
        className="desktop-update-notice__dismiss"
        aria-label={copy.cancel}
        onClick={onDismiss}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
