import { useCallback, useEffect, useRef, useState } from "react";
import type { Live2dSettings } from "../../../services/live2d-settings";
import { getAiReactionDialogue, getRandomDefaultDialogue, getTimedDialogue } from "../data/dialogue";
import { getCharacter, getOutfit, MYGO_CHARACTERS } from "../data/models";
import type { CharacterMetadata, MascotSpeechState, OutfitMetadata } from "../types";

export interface UseLive2dControllerOptions {
  settings: Live2dSettings;
  onSettingsChange?: (partial: Partial<Live2dSettings>) => void;
  chatPhase?: "loading" | "idle" | "streaming" | "offline" | "error" | "compressing";
}

export function useLive2dController({
  settings,
  onSettingsChange,
  chatPhase,
}: UseLive2dControllerOptions) {
  const [speech, setSpeech] = useState<MascotSpeechState>({
    text: "",
    visible: false,
  });
  const [isPickerOpen, setPickerOpen] = useState(false);
  const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPhaseRef = useRef(chatPhase);

  const characterIndex = settings.characterIndex ?? 0;
  const outfitIndex = settings.outfitIndex ?? 0;
  const activeCharacter: CharacterMetadata = getCharacter(characterIndex);
  const activeOutfit: OutfitMetadata = getOutfit(characterIndex, outfitIndex);

  // 显示台词气泡并可选触发动作
  const speak = useCallback(
    (text: string, motion?: string, durationMs = 4000, characterOverride?: CharacterMetadata) => {
      if (!text) return;
      if (speechTimerRef.current) {
        clearTimeout(speechTimerRef.current);
        speechTimerRef.current = null;
      }

      // 如果有对应的 motion，且底层 Live2D 模型支持动作，直接播放动作
      if (motion && typeof window !== "undefined" && window.live2dInstance?.model?.motion) {
        try {
          window.live2dInstance.model.motion(motion);
        } catch {
          // ignore
        }
      }

      setSpeech({
        text,
        motion,
        visible: true,
        characterOverride,
      });

      speechTimerRef.current = setTimeout(() => {
        setSpeech((prev) => ({ ...prev, visible: false }));
        speechTimerRef.current = null;
      }, durationMs);
    },
    [],
  );

  // 触发随机语录/闲置互动
  const triggerRandomQuote = useCallback(() => {
    const timed = getTimedDialogue(characterIndex);
    const quote = timed ?? getRandomDefaultDialogue(characterIndex);
    speak(quote.text, quote.motion, 4500);
  }, [characterIndex, speak]);

  // 切换角色
  const switchCharacter = useCallback(
    (newCharIndex: number) => {
      const safeIndex = Math.max(0, Math.min(newCharIndex, MYGO_CHARACTERS.length - 1));
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("modelId", safeIndex.toString());
          localStorage.setItem("modelTexturesId", "0");
        } catch {
          // ignore
        }
      }
      onSettingsChange?.({
        characterIndex: safeIndex,
        outfitIndex: 0,
      });
      const newChar = getCharacter(safeIndex);
      speak(`我是 ${newChar.name}！`, "smile01", 3000, newChar);
    },
    [onSettingsChange, speak],
  );

  // 切换当前角色的服装
  const switchOutfit = useCallback(
    (newOutfitIndex: number) => {
      const char = getCharacter(characterIndex);
      const safeOutfitIndex = Math.max(0, Math.min(newOutfitIndex, char.outfits.length - 1));
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("modelTexturesId", safeOutfitIndex.toString());
        } catch {
          // ignore
        }
      }
      onSettingsChange?.({
        outfitIndex: safeOutfitIndex,
      });
      const outfit = getOutfit(characterIndex, safeOutfitIndex);
      speak(`换上「${outfit.name}」啦！`, "smile02", 3000);
    },
    [characterIndex, onSettingsChange, speak],
  );

  // 监听 AI 对话状态联动 (AI Reaction)
  useEffect(() => {
    if (!settings.enabled || !settings.aiReactivity || !chatPhase) {
      prevPhaseRef.current = chatPhase;
      return;
    }

    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = chatPhase;

    if (chatPhase === "streaming" && prevPhase !== "streaming") {
      const reaction = getAiReactionDialogue(characterIndex, "streaming");
      speak(reaction.text, reaction.motion, 4500);
    } else if (chatPhase === "idle" && prevPhase === "streaming") {
      const reaction = getAiReactionDialogue(characterIndex, "completed");
      speak(reaction.text, reaction.motion, 4500);
    } else if ((chatPhase === "error" || chatPhase === "offline") && prevPhase === "streaming") {
      const reaction = getAiReactionDialogue(characterIndex, "error");
      speak(reaction.text, reaction.motion, 5000);
    }
  }, [characterIndex, chatPhase, settings.aiReactivity, settings.enabled, speak]);

  // 定时闲置互动台词提醒
  useEffect(() => {
    if (!settings.enabled) return;

    const interval = setInterval(() => {
      // 随机触发闲置台词（若当前没有气泡显示）
      if (!speech.visible && Math.random() < 0.35) {
        triggerRandomQuote();
      }
    }, 45000);

    return () => clearInterval(interval);
  }, [settings.enabled, speech.visible, triggerRandomQuote]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (speechTimerRef.current) {
        clearTimeout(speechTimerRef.current);
      }
    };
  }, []);

  return {
    speech,
    speak,
    triggerRandomQuote,
    switchCharacter,
    switchOutfit,
    isPickerOpen,
    setPickerOpen,
    activeCharacter,
    activeOutfit,
  };
}
