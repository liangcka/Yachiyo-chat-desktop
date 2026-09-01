import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { MYGO_CHARACTERS } from "../data/models";

export interface Live2dOutfitPickerProps {
  characterIndex: number;
  outfitIndex: number;
  onSelect: (charIndex: number, outfitIndex: number) => void;
  onClose: () => void;
}

export function Live2dOutfitPicker({
  characterIndex,
  outfitIndex,
  onSelect,
  onClose,
}: Live2dOutfitPickerProps) {
  const [activeTab, setActiveTab] = useState(characterIndex);

  const selectedChar = MYGO_CHARACTERS[activeTab] ?? MYGO_CHARACTERS[0];

  return (
    <div
      className="live2d-picker-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
    >
      <div
        className="live2d-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="MyGO!!!!! 角色与换装工坊"
        style={{
          ["--char-theme" as string]: selectedChar.themeColor,
        }}
      >
        <div className="live2d-picker-header">
          <div className="live2d-picker-title">
            <Sparkles size={18} style={{ color: selectedChar.themeColor }} />
            <h3>MyGO!!!!! 角色与换装工坊</h3>
          </div>
          <button
            type="button"
            className="live2d-picker-close-btn"
            onClick={onClose}
            aria-label="关闭窗口"
          >
            <X size={18} />
          </button>
        </div>

        {/* 角色切换标签栏 */}
        <div className="live2d-picker-tabs">
          {MYGO_CHARACTERS.map((char, idx) => {
            const isCharActive = activeTab === idx;
            return (
              <button
                key={char.id}
                type="button"
                className={`live2d-picker-tab ${isCharActive ? "live2d-picker-tab--active" : ""}`}
                style={{
                  borderColor: isCharActive ? char.themeColor : undefined,
                  background: isCharActive ? char.accentColor : undefined,
                }}
                onClick={() => {
                  setActiveTab(idx);
                }}
              >
                <img
                  src={char.iconImage}
                  alt={char.name}
                  className="live2d-picker-tab__icon"
                />
                <div className="live2d-picker-tab__info">
                  <span className="live2d-picker-tab__name">{char.name}</span>
                  <span className="live2d-picker-tab__role">{char.bandRole}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 服装/立绘卡片网格 */}
        <div className="live2d-picker-grid">
          {selectedChar.outfits.map((outfit, oIdx) => {
            const isSelected = activeTab === characterIndex && outfitIndex === oIdx;
            return (
              <button
                key={outfit.id}
                type="button"
                className={`live2d-outfit-card ${isSelected ? "live2d-outfit-card--selected" : ""}`}
                onClick={() => {
                  onSelect(activeTab, oIdx);
                }}
              >
                <div className="live2d-outfit-card__preview">
                  {outfit.previewImage ? (
                    <img
                      src={outfit.previewImage}
                      alt={outfit.name}
                      loading="lazy"
                      className="live2d-outfit-card__img"
                    />
                  ) : (
                    <div className="live2d-outfit-card__placeholder">
                      <Sparkles size={24} />
                    </div>
                  )}
                  {isSelected ? (
                    <div className="live2d-outfit-card__badge">
                      <Check size={14} />
                    </div>
                  ) : null}
                </div>
                <span className="live2d-outfit-card__title">{outfit.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
