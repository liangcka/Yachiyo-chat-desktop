import { Sparkles, X } from "lucide-react";
import type { CharacterMetadata, MascotSpeechState } from "../types";

export interface Live2dSpeechBubbleProps {
  speech: MascotSpeechState;
  character: CharacterMetadata;
  side?: "left" | "right";
  onDismiss?: () => void;
}

export function Live2dSpeechBubble({
  speech,
  character,
  side = "left",
  onDismiss,
}: Live2dSpeechBubbleProps) {
  if (!speech.visible || !speech.text) return null;

  // 跨角色切换时优先使用 characterOverride，避免异步状态延迟导致名称不匹配
  const displayChar = speech.characterOverride ?? character;

  return (
    <div
      className={`live2d-speech-bubble live2d-speech-bubble--${side} ${speech.visible ? "live2d-speech-bubble--active" : ""}`}
      style={{
        ["--mascot-accent" as string]: displayChar.themeColor,
      }}
      role="status"
      aria-live="polite"
    >
      <div className="live2d-speech-bubble__header">
        <div className="live2d-speech-bubble__badge">
          <Sparkles size={12} className="live2d-speech-bubble__sparkle" />
          <span className="live2d-speech-bubble__name">{displayChar.name}</span>
        </div>
        {onDismiss ? (
          <button
            type="button"
            className="live2d-speech-bubble__close"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            title="关闭气泡"
            aria-label="关闭气泡"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <div className="live2d-speech-bubble__content">{speech.text}</div>
      <div className="live2d-speech-bubble__tail" />
    </div>
  );
}
