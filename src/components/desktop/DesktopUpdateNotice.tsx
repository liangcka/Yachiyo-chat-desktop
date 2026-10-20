import { Download, X } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import { useAppUpdateInstaller } from "../../services/app-updater";
import { openExternalUrl } from "../../services/desktop-bridge";
import type { AvailableUpdate } from "../../services/update-check";

export interface DesktopUpdateNoticeProps {
  copy: UiCopy;
  update: AvailableUpdate;
  onDismiss: () => void;
}

export function DesktopUpdateNotice({ copy, update, onDismiss }: DesktopUpdateNoticeProps) {
  const { state, start } = useAppUpdateInstaller(update.url);
  const busy = state.kind === "downloading" || state.kind === "installing";
  const text = state.kind === "downloading"
    ? copy.desktopUpdateDownloading(state.percent)
    : state.kind === "installing"
      ? copy.desktopUpdateInstalling
      : state.kind === "failed"
        ? copy.desktopUpdateFailed
        : copy.desktopUpdateAvailable(update.version);

  return (
    <div className="desktop-update-notice" role="status">
      <Download aria-hidden="true" size={16} className="desktop-update-notice__icon" />
      <span className="desktop-update-notice__text">{text}</span>
      {state.kind === "failed" ? (
        <button
          type="button"
          className="desktop-update-notice__action"
          onClick={() => {
            void openExternalUrl(update.url);
            onDismiss();
          }}
        >
          {copy.desktopUpdateOpenRelease}
        </button>
      ) : busy ? null : (
        <button type="button" className="desktop-update-notice__action" onClick={() => void start()}>
          {copy.desktopUpdateAction}
        </button>
      )}
      {busy ? null : (
        <button
          type="button"
          className="desktop-update-notice__dismiss"
          aria-label={copy.cancel}
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}
