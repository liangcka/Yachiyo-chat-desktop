import { REQUEST_CHARACTER_BUDGET } from "../domain/context-budget";
import type { ChatMessage, Locale, StoredImage } from "../domain/chat";

const maximumRequestCharacters = REQUEST_CHARACTER_BUDGET;
const maximumRequestMessageCharacters = REQUEST_CHARACTER_BUDGET;
export const maximumRequestMessages = 20;

export function blobToDataUrl(image: StoredImage): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new TypeError("Image could not be encoded."));
    });
    reader.addEventListener("error", () => reject(new TypeError("Image could not be encoded.")));
    reader.readAsDataURL(image.blob);
  });
}

export function isHistoryMessage(message: ChatMessage): boolean {
  if (message.status === "complete" || message.status === "stopped") {
    return true;
  }
  // 核心契约：如果消息包含已执行的工具步骤（Agent 模式），这是客观发生的操作记录，
  // 即使消息末尾发生网络抖动或断流（failed），也必须作为有效历史带入上下文，防止重试或重连时丢失已查验的事实
  if (
    message.status === "failed" &&
    message.role === "assistant" &&
    message.toolSteps !== undefined &&
    message.toolSteps.length > 0
  ) {
    return true;
  }
  return false;
}

const weekdaysZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;
const weekdaysJa = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"] as const;

export function formatClientTimestamp(timestamp: number, locale: Locale): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  const weekday = locale === "ja-JP" ? weekdaysJa[date.getDay()] : weekdaysZh[date.getDay()];
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${weekday}`;
}

function truncateUnicode(value: string, maximum: number): string {
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= maximum) break;
    result += character;
    length += 1;
  }
  return result;
}

export function requestHistory(
  messages: ChatMessage[],
  reserveCharacters = 0,
  maxMessages = maximumRequestMessages,
  compressedUpTo?: number,
  oldestFirst = false,
): Array<{ message: ChatMessage; text: string }> {
  // 早于压缩边界的消息已被摘要取代，不再重复进入请求（retained-tail 语义）
  const eligible = messages.filter(
    (message) =>
      isHistoryMessage(message) &&
      (compressedUpTo === undefined || message.createdAt > compressedUpTo),
  );
  const selected: Array<{ message: ChatMessage; text: string }> = [];
  let totalCharacters = reserveCharacters;

  for (let offset = 0; offset < eligible.length && selected.length < maxMessages; offset += 1) {
    const index = oldestFirst ? offset : eligible.length - 1 - offset;
    const message = eligible[index];
    if (message === undefined) continue;
    const text = truncateUnicode(message.text, maximumRequestMessageCharacters);
    const isLastMessage = index === eligible.length - 1;
    if (!isLastMessage && text.trim().length === 0) continue;
    const characterLength = [...text].length;
    if (totalCharacters + characterLength > maximumRequestCharacters) break;
    if (oldestFirst) selected.push({ message, text });
    else selected.unshift({ message, text });
    totalCharacters += characterLength;
  }

  return selected;
}
