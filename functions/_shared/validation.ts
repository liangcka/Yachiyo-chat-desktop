export type ChatLocale = "zh-CN" | "ja-JP";

export interface ClientHistoryMessage {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
}

export type ProviderId = "stepfun" | "deepseek" | "glm" | "openai" | "claude" | "gemini";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "stepfun",
  "deepseek",
  "glm",
  "openai",
  "claude",
  "gemini",
];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type RequestMode = "chat" | "summary" | "title";

/** 自定义模型的线路协议；与前端 src/domain/llm.ts 的 ApiFormat 一致 */
export type ApiFormat = "chat_completions" | "responses" | "anthropic_messages";

/** 模型系列：决定思考开关的参数写法与 OpenAI 兼容厂商规则 */
export type ModelFamily = "deepseek" | "qwen" | "glm" | "kimi" | "doubao" | "minimax" | "gpt" | "claude";

/** 「自定义模型」随请求下发的协议与采样参数；只与 baseUrl 同时出现，缺省字段由上游决定 */
export interface CustomModelOptions {
  apiFormat: ApiFormat;
  /** 按 baseUrl 原样请求，不补全协议路径 */
  fullUrl?: boolean;
  family?: ModelFamily;
  maxOutputTokens?: number;
  /** 缺省跟随模型默认配置，不发送思考字段 */
  thinking?: "on" | "off";
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface ClientChatRequest {
  locale: ChatLocale;
  messages: ClientHistoryMessage[];
  mode?: RequestMode;
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  /** 自定义 OpenAI 兼容端点；仅用户自带 Key 路径有效 */
  baseUrl?: string;
  /** 自定义模型的协议与参数；必须与 baseUrl 同时出现 */
  customModel?: CustomModelOptions;
  webSearch?: boolean;
  /** 智能搜索：联网搜索开启时的双市场并行检索（结果更多、带发布日期） */
  smartSearch?: boolean;
  /** 发送消息时的客户端本地格式化时间戳 */
  currentTime?: string;
}

export class ChatValidationError extends Error {
  readonly code = "INVALID_REQUEST";

  constructor() {
    super("Invalid chat request");
    this.name = "ChatValidationError";
  }
}

export const MAX_CHAT_BODY_BYTES = 3 * 1_024 * 1_024;

const maximumMessages = 20;
const maximumMessageCharacters = 4_000;
const maximumTotalCharacters = 24_000;
/** 上文的图随请求重发，模型才能回看；张数与客户端 maximumRequestImages 一致，总体积由请求体上限兜住 */
const maximumImages = 4;
const maximumImageBytes = 2 * 1_024 * 1_024;
const maximumEncodedImageLength = Math.ceil(maximumImageBytes / 3) * 4;
const allowedTopLevelKeys = new Set([
  "locale",
  "messages",
  "mode",
  "provider",
  "apiKey",
  "model",
  "baseUrl",
  "customModel",
  "webSearch",
  "smartSearch",
  "currentTime",
]);
const allowedMessageKeys = new Set(["role", "text", "imageDataUrl"]);
const allowedCustomModelKeys = new Set([
  "apiFormat",
  "fullUrl",
  "family",
  "maxOutputTokens",
  "thinking",
  "temperature",
  "topP",
  "topK",
]);
const apiFormats: readonly ApiFormat[] = ["chat_completions", "responses", "anthropic_messages"];
const modelFamilies: readonly ModelFamily[] = ["deepseek", "qwen", "glm", "kimi", "doubao", "minimax", "gpt", "claude"];

function invalid(): never {
  throw new ChatValidationError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedUnicodeLength(value: string, maximum: number): number {
  let length = 0;
  const iterator = value[Symbol.iterator]();
  while (!iterator.next().done) {
    length += 1;
    if (length > maximum) {
      break;
    }
  }
  return length;
}

function decodedBase64Length(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function hasExpectedImageSignature(mimeType: string, base64: string): boolean {
  try {
    const header = atob(base64.slice(0, 24));
    const byte = (index: number) => header.charCodeAt(index);

    if (mimeType === "jpeg") {
      return byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
    }
    if (mimeType === "png") {
      return (
        byte(0) === 0x89 &&
        header.slice(1, 4) === "PNG" &&
        byte(4) === 0x0d &&
        byte(5) === 0x0a &&
        byte(6) === 0x1a &&
        byte(7) === 0x0a
      );
    }
    return header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}

function validateImageDataUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > maximumEncodedImageLength + 64) {
    return invalid();
  }

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (match === null) {
    return invalid();
  }

  const mimeType = match[1];
  const base64 = match[2];
  if (
    mimeType === undefined ||
    base64 === undefined ||
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    decodedBase64Length(base64) > maximumImageBytes ||
    !hasExpectedImageSignature(mimeType, base64)
  ) {
    return invalid();
  }

  return value;
}

function optionalNumber(value: unknown, min: number, max: number, integer: boolean): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    return invalid();
  }
  return value;
}

/** 范围与前端 CUSTOM_MODEL_LIMITS 一致；未知字段或越界值整体拒绝 */
function validateCustomModel(value: unknown): CustomModelOptions {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedCustomModelKeys)) {
    return invalid();
  }
  const { apiFormat, fullUrl, family, thinking } = value;
  if (typeof apiFormat !== "string" || !(apiFormats as readonly string[]).includes(apiFormat)) {
    return invalid();
  }
  if (fullUrl !== undefined && typeof fullUrl !== "boolean") {
    return invalid();
  }
  if (family !== undefined && (typeof family !== "string" || !(modelFamilies as readonly string[]).includes(family))) {
    return invalid();
  }
  if (thinking !== undefined && thinking !== "on" && thinking !== "off") {
    return invalid();
  }
  const maxOutputTokens = optionalNumber(value.maxOutputTokens, 1, 1_000_000, true);
  const temperature = optionalNumber(value.temperature, 0, 2, false);
  const topP = optionalNumber(value.topP, 0, 1, false);
  const topK = optionalNumber(value.topK, 1, 100, true);
  return {
    apiFormat: apiFormat as ApiFormat,
    ...(fullUrl === true ? { fullUrl: true } : {}),
    ...(family !== undefined ? { family: family as ModelFamily } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined ? { topK } : {}),
  };
}

export function validateChatRequest(value: unknown): ClientChatRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedTopLevelKeys)) {
    return invalid();
  }

  if (value.locale !== "zh-CN" && value.locale !== "ja-JP") {
    return invalid();
  }
  const rawMessages = value.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > maximumMessages) {
    return invalid();
  }

  let totalCharacters = 0;
  let imageCount = 0;
  const messages = rawMessages.map((message): ClientHistoryMessage => {
    if (!isRecord(message) || !hasOnlyKeys(message, allowedMessageKeys)) {
      return invalid();
    }
    if (message.role !== "user" && message.role !== "assistant") {
      return invalid();
    }
    if (typeof message.text !== "string") {
      return invalid();
    }

    const textLength = boundedUnicodeLength(message.text, maximumMessageCharacters);
    if (textLength > maximumMessageCharacters) {
      return invalid();
    }
    totalCharacters += textLength;
    if (totalCharacters > maximumTotalCharacters) {
      return invalid();
    }

    let imageDataUrl: string | undefined;
    if (message.imageDataUrl !== undefined) {
      imageCount += 1;
      if (message.role !== "user" || imageCount > maximumImages) {
        return invalid();
      }
      imageDataUrl = validateImageDataUrl(message.imageDataUrl);
    }

    if (message.text.trim().length === 0 && imageDataUrl === undefined) {
      return invalid();
    }

    return imageDataUrl === undefined
      ? { role: message.role, text: message.text }
      : { role: message.role, text: message.text, imageDataUrl };
  });

  if (messages.at(-1)?.role !== "user") {
    return invalid();
  }

  if (value.mode !== undefined && value.mode !== "chat" && value.mode !== "summary" && value.mode !== "title") {
    return invalid();
  }

  const mode = value.mode as RequestMode | undefined;

  if (value.webSearch !== undefined && typeof value.webSearch !== "boolean") {
    return invalid();
  }
  const webSearch = value.webSearch as boolean | undefined;

  if (value.smartSearch !== undefined && typeof value.smartSearch !== "boolean") {
    return invalid();
  }
  const smartSearch = value.smartSearch as boolean | undefined;

  if (
    value.currentTime !== undefined &&
    (typeof value.currentTime !== "string" ||
      value.currentTime.trim().length === 0 ||
      value.currentTime.length > 100)
  ) {
    return invalid();
  }
  const currentTime = value.currentTime as string | undefined;

  const hasProvider = value.provider !== undefined;
  const hasApiKey = value.apiKey !== undefined;
  const hasModel = value.model !== undefined;
  if (hasProvider !== hasApiKey || hasProvider !== hasModel) {
    return invalid();
  }

  if (!hasProvider) {
    return {
      locale: value.locale,
      messages,
      ...(mode !== undefined ? { mode } : {}),
      ...(webSearch !== undefined ? { webSearch } : {}),
      ...(smartSearch !== undefined ? { smartSearch } : {}),
      ...(currentTime !== undefined ? { currentTime: currentTime.trim() } : {}),
    };
  }

  if (!isProviderId(value.provider)) {
    return invalid();
  }
  if (
    typeof value.apiKey !== "string" ||
    value.apiKey.trim().length < 20 ||
    value.apiKey.length > 512
  ) {
    return invalid();
  }
  if (typeof value.model !== "string" || value.model.length === 0 || value.model.length > 64) {
    return invalid();
  }

  // 自定义端点：https 起始、无空白、≤2048；与前端 isValidBaseUrl 对齐
  if (value.baseUrl !== undefined) {
    if (
      typeof value.baseUrl !== "string" ||
      value.baseUrl.length === 0 ||
      value.baseUrl.length > 2048 ||
      !value.baseUrl.startsWith("https://") ||
      /\s/u.test(value.baseUrl)
    ) {
      return invalid();
    }
  }
  const baseUrl = value.baseUrl as string | undefined;
  // 自定义模型参数只对自定义端点有意义，单独出现视为非法请求
  if (value.customModel !== undefined && baseUrl === undefined) {
    return invalid();
  }
  const customModel = value.customModel === undefined ? undefined : validateCustomModel(value.customModel);

  return {
    locale: value.locale,
    messages,
    ...(mode !== undefined ? { mode } : {}),
    ...(webSearch !== undefined ? { webSearch } : {}),
    ...(smartSearch !== undefined ? { smartSearch } : {}),
    ...(currentTime !== undefined ? { currentTime: currentTime.trim() } : {}),
    provider: value.provider,
    apiKey: value.apiKey,
    model: value.model,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(customModel !== undefined ? { customModel } : {}),
  };
}

export async function readJsonBodyWithLimit(
  request: Request,
  maximumBytes = MAX_CHAT_BODY_BYTES,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      return invalid();
    }
  }

  if (request.body === null) {
    return invalid();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return invalid();
      }
      chunks.push(value);
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ChatValidationError) {
      throw error;
    }
    return invalid();
  }
}
