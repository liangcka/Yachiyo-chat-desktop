import type { ChatMessage } from "../domain/chat";
import { isHistoryMessage, maximumRequestMessages } from "./request-history";

/** 未压缩历史消息达到该数量时，发送前自动触发增量压缩（为摘要/长期记忆前缀预留槽位） */
export const compressionTriggerUncompressedMessages = maximumRequestMessages - 4;

/** 解析压缩请求的双区块输出；模型未按格式输出时整体降级为会话记忆 */
export function parseCompressionOutput(text: string): { conversationMemory: string; userProfile?: string } {
  const memoryMatch = text.match(/<conversation_memory>([\s\S]*?)<\/conversation_memory>/i);
  const profileMatch = text.match(/<user_profile>([\s\S]*?)<\/user_profile>/i);
  const conversationMemory = memoryMatch?.[1]?.trim() ?? "";
  if (conversationMemory.length > 0) {
    const userProfile = profileMatch?.[1]?.trim();
    return {
      conversationMemory,
      ...(userProfile !== undefined && userProfile.length > 0 ? { userProfile } : {}),
    };
  }
  return { conversationMemory: text.trim() };
}

/** 压缩指令：要求合并既有记忆并顺带提炼用户长期画像，双区块输出 */
export const compressionInstruction: Record<"zh-CN" | "ja-JP", string> = {
  "zh-CN": `请整理以上内容，输出以下两个区块，不要输出其他内容：

<conversation_memory>
合并【已有记忆摘要】与最新对话内容，输出更新后的完整会话记忆，按以下结构组织：
【核心事实】双方确认的重要事实与设定
【用户特征与偏好】彩叶表现出的喜好、习惯与性格特点
【双方约定】互相许下的承诺与约定
【关系与情绪】当前关系状态与情绪脉络
【剧情进展】故事线的关键节点
旧记忆中仍然有效的内容必须保留，不得遗漏。
</conversation_memory>

<user_profile>
从对话中提炼用户「酒寄彩叶」的长期画像（称呼、喜好、重要经历等），与【现有用户画像】合并去重后输出完整版本；没有新增内容时原样输出既有画像。
</user_profile>`,
  "ja-JP": `以上の内容を整理し、次の2つのブロックのみを出力してください：

<conversation_memory>
【既存の記憶要約】と最新の会話を統合し、更新後の完全な会話メモリーを以下の構成で出力してください：
【核心的事実】両者が確認した重要な事実と設定
【ユーザーの特徴と好み】彩葉の好み・習慣・性格
【約束事項】交わした約束
【関係と感情】現在の関係性と感情の流れ
【ストーリーの進展】物語の重要な節目
古い記憶のうち今も有効な内容は必ず残してください。
</conversation_memory>

<user_profile>
会話からユーザー「酒寄彩葉」の長期プロフィール（呼び名、好み、大切な出来事など）を抽出し、【既存のユーザープロフィール】と統合・重複排除した完全版を出力してください。追加情報がない場合は既存のプロフィールをそのまま出力してください。
</user_profile>`,
};

/** 仅统计压缩边界之后（未被摘要取代）的 eligible 消息数 */
export function countUncompressedMessages(messages: ChatMessage[], compressedUpTo?: number): number {
  return messages.filter(
    (message) =>
      isHistoryMessage(message) &&
      (compressedUpTo === undefined || message.createdAt > compressedUpTo),
  ).length;
}
