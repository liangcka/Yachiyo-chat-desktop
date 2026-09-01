import {
  Home,
  MessageSquareHeart,
  Palette,
  Power,
  Users,
} from "lucide-react";
import type { CharacterMetadata } from "../types";

export interface Live2dQuickBarProps {
  character: CharacterMetadata;
  side?: "left" | "right";
  onNextCharacter: () => void;
  onOpenPicker: () => void;
  onInteract: () => void;
  onHome: () => void;
  onHide?: () => void;
}

export function Live2dQuickBar({
  character,
  side = "left",
  onNextCharacter,
  onOpenPicker,
  onInteract,
  onHome,
  onHide,
}: Live2dQuickBarProps) {
  return (
    <div
      className={`live2d-quick-bar live2d-quick-bar--${side}`}
      style={{ ["--mascot-accent" as string]: character.themeColor }}
      role="toolbar"
      aria-label="桌宠快捷控制栏"
    >
      <button
        type="button"
        className="live2d-quick-btn"
        onClick={onInteract}
        title="互动交流 / 听她说句话"
        aria-label="互动交流"
      >
        <MessageSquareHeart size={16} />
      </button>

      <button
        type="button"
        className="live2d-quick-btn"
        onClick={onOpenPicker}
        title="换装 & 角色立绘选择"
        aria-label="换装选择"
      >
        <Palette size={16} />
      </button>

      <button
        type="button"
        className="live2d-quick-btn"
        onClick={onNextCharacter}
        title="切换下一位 MyGO 成员"
        aria-label="切换角色"
      >
        <Users size={16} />
      </button>

      <button
        type="button"
        className="live2d-quick-btn"
        onClick={onHome}
        title="归位回家"
        aria-label="归位回家"
      >
        <Home size={16} />
      </button>

      {onHide ? (
        <button
          type="button"
          className="live2d-quick-btn live2d-quick-btn--danger"
          onClick={onHide}
          title="收起桌宠挂件"
          aria-label="收起桌宠"
        >
          <Power size={16} />
        </button>
      ) : null}
    </div>
  );
}
