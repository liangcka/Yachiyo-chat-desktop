/**
 * 桌宠 (Live2D 看板娘) 核心领域模型与类型契约
 */

export interface OutfitMetadata {
  id: string;
  name: string;
  folderName: string;
  previewImage?: string;
  isDefault?: boolean;
}

export interface CharacterMetadata {
  id: "tomori" | "anon" | "rana" | "soyo" | "taki";
  name: string;
  romaji: string;
  bandRole: string;
  themeColor: string;
  accentColor: string;
  iconImage: string;
  outfits: OutfitMetadata[];
}

export interface DialogueItem {
  text: string;
  motion?: string;
  expression?: string;
}

export interface TimedDialogue {
  hourStart: number;
  hourEnd: number;
  dialogues: DialogueItem[][];
}

export interface SeasonalDialogue {
  dateRange: string;
  dialogues: DialogueItem[][];
}

export interface AiReactionPreset {
  streaming: DialogueItem[];
  completed: DialogueItem[];
  error: DialogueItem[];
  idle: DialogueItem[];
}

export type MascotMotionType =
  | "idle"
  | "smile"
  | "thinking"
  | "sing"
  | "kime"
  | "cry"
  | "sad"
  | "serious"
  | "angry"
  | "surprised"
  | "shame"
  | "bye"
  | "kandou";

export interface MascotSpeechState {
  text: string;
  motion?: string;
  expression?: string;
  visible: boolean;
  priority?: number;
  /** 跨角色切换时临时覆盖气泡显示的角色，避免异步状态更新导致名称不匹配 */
  characterOverride?: CharacterMetadata;
}
