import { REQUEST_CHARACTER_BUDGET } from "../domain/context-budget";
import type { ChatMessage, Locale, StoredImage } from "../domain/chat";

const maximumRequestCharacters = REQUEST_CHARACTER_BUDGET;
const maximumRequestMessageCharacters = REQUEST_CHARACTER_BUDGET;
export const maximumRequestMessages = 20;
/** 一次请求最多带的图片张数，与网关校验一致 */
export const maximumRequestImages = 4;
/** 上文图片的编码体积预算：桌面网关请求体上限 2MB，留出文字余量；本轮新发的图不受此限 */
const historyImageCharacterBudget = 1_500_000;

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
  // 运行中送达模型的补充要求属于用户的话，并入触发该运行的用户消息，保持用户/助手交替
  const supplementNotes = new Map<number, string>();
  eligible.forEach((message, index) => {
    const delivered = message.role === "assistant" ? (message.supplements ?? []).filter((item) => item.state === "delivered") : [];
    const previous = eligible[index - 1];
    if (delivered.length > 0 && previous?.role === "user") {
      supplementNotes.set(index - 1, `\n\n[任务进行中补充的要求]\n${delivered.map((item) => item.text).join("\n\n")}`);
    }
  });

  for (let offset = 0; offset < eligible.length && selected.length < maxMessages; offset += 1) {
    const index = oldestFirst ? offset : eligible.length - 1 - offset;
    const message = eligible[index];
    if (message === undefined) continue;
    const text = truncateUnicode(message.text + (supplementNotes.get(index) ?? ""), maximumRequestMessageCharacters);
    const isLastMessage = index === eligible.length - 1;
    // 只发了图的消息正文为空，仍要留在上下文里，否则模型回看不到这张图
    if (!isLastMessage && text.trim().length === 0 && message.imageId === undefined) continue;
    const characterLength = [...text].length;
    if (totalCharacters + characterLength > maximumRequestCharacters) break;
    if (oldestFirst) selected.push({ message, text });
    else selected.unshift({ message, text });
    totalCharacters += characterLength;
  }

  return selected;
}

/**
 * 从最新往前给带图的用户消息取图（键为 history 下标）：最后一条的图必带，
 * 更早的图在张数与体积预算内随上下文重发，模型才能联系上文看图；超出的由调用方换成文字说明。
 */
export async function selectRequestImages(
  history: ReadonlyArray<{ message: ChatMessage }>,
  load: (imageId: string) => Promise<string | undefined>,
): Promise<Map<number, string>> {
  const selected = new Map<number, string>();
  let historyCharacters = 0;
  for (let index = history.length - 1; index >= 0 && selected.size < maximumRequestImages; index -= 1) {
    const message = history[index]?.message;
    if (message?.role !== "user" || message.imageId === undefined) continue;
    const dataUrl = await load(message.imageId);
    if (dataUrl === undefined) continue;
    if (index !== history.length - 1) {
      if (historyCharacters + dataUrl.length > historyImageCharacterBudget) break;
      historyCharacters += dataUrl.length;
    }
    selected.set(index, dataUrl);
  }
  return selected;
}

/** 图片没能随请求发送时补在正文前，让模型知道这里曾有一张图 */
export function withOmittedImageNote(text: string, locale: Locale): string {
  const note = locale === "ja-JP" ? "（画像が添付されていましたが、このリクエストには含まれていません）" : "（这里附过一张图片，本次请求未附带）";
  return text.trim().length === 0 ? note : `${note}\n${text}`;
}
