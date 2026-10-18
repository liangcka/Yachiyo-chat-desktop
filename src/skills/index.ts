import humanizerContent from "./humanizer/SKILL.md?raw";
import deepReasoningContent from "./deep-reasoning/SKILL.md?raw";
import emotionalInsightContent from "./emotional-insight/SKILL.md?raw";
import factGroundingContent from "./fact-grounding/SKILL.md?raw";
import knowledgeStructuringContent from "./knowledge-structuring/SKILL.md?raw";
import type { Locale } from "../domain/chat";

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 日文界面展示用的名称与说明；缺省时回退为中文 */
  readonly ja?: { readonly name: string; readonly description: string };
  /** SKILL.md 原文，启用后作为技能指令注入对话 */
  readonly content: string;
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    id: "deep-reasoning",
    name: "深度思维",
    description: "多步拆解与逻辑推理，输出深层见解",
    ja: { name: "深い思考", description: "段階的に分解して論理的に推論し、深い洞察を示します" },
    content: deepReasoningContent,
  },
  {
    id: "emotional-insight",
    name: "情感洞察",
    description: "敏锐捕捉情绪与潜台词，提供高情商温暖共鸣",
    ja: { name: "感情の洞察", description: "感情や言外の意味を汲み取り、温かく寄り添います" },
    content: emotionalInsightContent,
  },
  {
    id: "fact-grounding",
    name: "精准事实",
    description: "严谨事实核对与抗幻觉，时序逻辑自洽",
    ja: { name: "正確な事実", description: "事実を慎重に確認し、時系列の矛盾や思い込みを防ぎます" },
    content: factGroundingContent,
  },
  {
    id: "knowledge-structuring",
    name: "知识条理",
    description: "结构化梳理复杂概念，清晰层次分明",
    ja: { name: "知識の整理", description: "複雑な概念を構造的に整理し、わかりやすく階層化します" },
    content: knowledgeStructuringContent,
  },
  {
    id: "humanizer",
    name: "Humanizer",
    description: "去除文本中的 AI 味，让输出更像真人写作",
    ja: { name: "Humanizer", description: "AI っぽさを取り除き、人が書いたような文章にします" },
    content: humanizerContent,
  },
];

/** 按界面语言取技能的展示名称与说明 */
export function skillLabel(skill: SkillDefinition, locale: Locale): { name: string; description: string } {
  return locale === "ja-JP" && skill.ja !== undefined
    ? skill.ja
    : { name: skill.name, description: skill.description };
}
