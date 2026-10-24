/**
 * 前端 LLM 厂商领域模型。
 *
 * 注意：本文件的 ProviderId/默认模型/可选模型/图片支持标志必须与
 * functions/_shared/providers/registry.ts 的 PROVIDERS 保持一致。
 * 前后端物理分离（src 与 functions 不互相 import），此处为 API 契约的镜像。
 */

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

export type ProviderGroup = "domestic" | "international";

export interface LlmProviderMeta {
  readonly id: ProviderId;
  readonly group: ProviderGroup;
  readonly label: string;
  readonly models: readonly string[];
  readonly defaultModel: string;
  /** 该厂商是否存在支持图片输入的视觉模型(设置面板提示用) */
  readonly supportsImage: boolean;
  /** 可发送图片的具体模型白名单;拍照/发图能力按所选模型判断 */
  readonly imageModels: readonly string[];
}

export const PROVIDER_METADATA: Readonly<Record<ProviderId, LlmProviderMeta>> = Object.freeze({
  stepfun: {
    id: "stepfun",
    group: "domestic",
    label: "阶跃星辰 StepFun（Step Plan）",
    models: [
      "step-3.7-flash",
      "step-5-preview",
      "step-3.5-flash",
      "step-3.5-flash-2603",
      "step-2-16k",
      "step-1-8k",
      "step-1v-8k",
      "step-plan",
    ],
    defaultModel: "step-3.7-flash",
    supportsImage: true,
    imageModels: ["step-3.7-flash", "step-5-preview"],
  },
  deepseek: {
    id: "deepseek",
    group: "domestic",
    label: "DeepSeek",
    models: ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
    defaultModel: "deepseek-flash",
    supportsImage: true,
    imageModels: ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
  },
  glm: {
    id: "glm",
    group: "domestic",
    label: "智谱 GLM",
    models: [
      "glm-5.3",
      "glm-5.3-flash",
      "glm-5.3-flashx",
      "glm-5.2",
      "glm-4.7-flash",
      "glm-4.6",
      "glm-4.6v-flash",
      "glm-4v-flash",
    ],
    defaultModel: "glm-5.3-flash",
    supportsImage: true,
    imageModels: ["glm-5.3-flash", "glm-5.3-flashx", "glm-4.6v-flash", "glm-4v-flash"],
  },
  openai: {
    id: "openai",
    group: "international",
    label: "OpenAI (GPT)",
    models: [
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-4.1",
      "gpt-4.1-mini",
    ],
    defaultModel: "gpt-6-luna",
    supportsImage: true,
    imageModels: [
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-4.1",
      "gpt-4.1-mini",
    ],
  },
  claude: {
    id: "claude",
    group: "international",
    label: "Anthropic (Claude)",
    models: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-5-5",
    supportsImage: true,
    imageModels: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  },
  gemini: {
    id: "gemini",
    group: "international",
    label: "Google (Gemini)",
    models: [
      "gemini-4-argon",
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.7-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ],
    defaultModel: "gemini-3.8-flash",
    supportsImage: true,
    imageModels: [
      "gemini-4-argon",
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.7-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ],
  },
});

export const DOMESTIC_PROVIDERS: readonly ProviderId[] = PROVIDER_IDS.filter(
  (id) => PROVIDER_METADATA[id].group === "domestic",
);
export const INTERNATIONAL_PROVIDERS: readonly ProviderId[] = PROVIDER_IDS.filter(
  (id) => PROVIDER_METADATA[id].group === "international",
);

export function getProviderMeta(id: ProviderId): LlmProviderMeta {
  return PROVIDER_METADATA[id];
}

/**
 * 桌面端 IndexedDB 中的 API Key 占位符：真实 Key 只保存在本地网关的系统加密存储里，
 * 请求体遇到占位符时不携带 apiKey，由网关按厂商读取。满足 isValidApiKey 以复用既有校验。
 */
export const KEYSTORE_MANAGED_API_KEY = "yachiyo-desktop-keystore-managed";

/** 为新配置生成 id（同时是桌面端密钥槽名），格式须与网关 is_valid_slot 一致 */
export function newLlmEntryId(provider: ProviderId): string {
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${provider}~${suffix}`;
}

/** 自定义模型的线路协议；缺省（含旧版保存的自定义端点）为 Chat Completions */
export type ApiFormat = "chat_completions" | "responses" | "anthropic_messages";

export const API_FORMATS: readonly ApiFormat[] = ["chat_completions", "responses", "anthropic_messages"];

/** 各协议在 Base URL 后补全的路径；开启「完整 URL」时不拼接 */
export const API_FORMAT_PATHS: Readonly<Record<ApiFormat, string>> = {
  chat_completions: "/chat/completions",
  responses: "/responses",
  anthropic_messages: "/messages",
};

/** 模型系列：决定思考开关的参数写法与厂商兼容规则；缺省按端点主机名识别 */
export type ModelFamily = "deepseek" | "qwen" | "glm" | "kimi" | "doubao" | "minimax" | "gpt" | "claude";

export const MODEL_FAMILIES: readonly ModelFamily[] = ["deepseek", "qwen", "glm", "kimi", "doubao", "minimax", "gpt", "claude"];

/** 思考模式：缺省跟随模型默认配置，不下发任何思考字段 */
export type ThinkingMode = "on" | "off";

/** 工具调用轮数缺省值；Agent 达到上限后按截断结束 */
export const DEFAULT_MAX_TOOL_ROUNDS = 500;

/** 自定义模型各数值字段的合法范围（含端点），前后端校验一致 */
export const CUSTOM_MODEL_LIMITS = {
  displayName: 64,
  contextWindow: { min: 1_024, max: 10_000_000 },
  maxOutputTokens: { min: 1, max: 1_000_000 },
  maxToolRounds: { min: 1, max: 10_000 },
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 100 },
} as const;

/** 「自定义模型」表单保存的全部设置；只存在于自定义模型配置上，其余配置沿用厂商规则 */
export interface CustomModelSettings {
  readonly apiFormat: ApiFormat;
  /** 按填写的地址原样请求，不再补全协议路径 */
  readonly fullUrl?: boolean;
  readonly displayName?: string;
  readonly family?: ModelFamily;
  /** 输入上下文窗口（Token），用于界面上下文用量估算 */
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly maxToolRounds?: number;
  /** 缺省视为支持图片输入 */
  readonly supportsImage?: boolean;
  readonly thinking?: ThinkingMode;
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
}

/** 随聊天请求下发给后端的自定义模型参数（界面专用的展示名、上下文窗口、轮数与图片能力不下发） */
export interface CustomModelRequestOptions {
  readonly apiFormat: ApiFormat;
  readonly fullUrl?: true;
  readonly family?: ModelFamily;
  readonly maxOutputTokens?: number;
  readonly thinking?: ThinkingMode;
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
}

type NumericLimit = { readonly min: number; readonly max: number };

function inRange(value: unknown, limit: NumericLimit, integer: boolean): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    value >= limit.min &&
    value <= limit.max
  );
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/**
 * 从 IndexedDB 等边界数据还原自定义模型设置：非法字段逐个丢弃而不是整条作废，
 * 未知或缺失的协议回退为 Chat Completions；非对象返回 undefined
 */
export function normalizeCustomModelSettings(value: unknown): CustomModelSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const limits = CUSTOM_MODEL_LIMITS;
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  return {
    apiFormat: isOneOf(raw.apiFormat, API_FORMATS) ? raw.apiFormat : "chat_completions",
    ...(raw.fullUrl === true ? { fullUrl: true } : {}),
    ...(displayName.length > 0 ? { displayName: [...displayName].slice(0, limits.displayName).join("") } : {}),
    ...(isOneOf(raw.family, MODEL_FAMILIES) ? { family: raw.family } : {}),
    ...(inRange(raw.contextWindow, limits.contextWindow, true) ? { contextWindow: raw.contextWindow } : {}),
    ...(inRange(raw.maxOutputTokens, limits.maxOutputTokens, true) ? { maxOutputTokens: raw.maxOutputTokens } : {}),
    ...(inRange(raw.maxToolRounds, limits.maxToolRounds, true) ? { maxToolRounds: raw.maxToolRounds } : {}),
    ...(raw.supportsImage === false ? { supportsImage: false } : {}),
    ...(raw.thinking === "on" || raw.thinking === "off" ? { thinking: raw.thinking } : {}),
    ...(inRange(raw.temperature, limits.temperature, false) ? { temperature: raw.temperature } : {}),
    ...(inRange(raw.topP, limits.topP, false) ? { topP: raw.topP } : {}),
    ...(inRange(raw.topK, limits.topK, true) ? { topK: raw.topK } : {}),
  };
}

export function customModelRequestOptions(settings: CustomModelSettings): CustomModelRequestOptions {
  return {
    apiFormat: settings.apiFormat,
    ...(settings.fullUrl === true ? { fullUrl: true } : {}),
    ...(settings.family !== undefined ? { family: settings.family } : {}),
    ...(settings.maxOutputTokens !== undefined ? { maxOutputTokens: settings.maxOutputTokens } : {}),
    ...(settings.thinking !== undefined ? { thinking: settings.thinking } : {}),
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.topP !== undefined ? { topP: settings.topP } : {}),
    ...(settings.topK !== undefined ? { topK: settings.topK } : {}),
  };
}

/** 实际请求地址：完整 URL 原样使用，否则剥掉尾部斜杠后补全协议路径（与后端解析一致） */
export function resolveCustomEndpoint(baseUrl: string, apiFormat: ApiFormat, fullUrl: boolean): string {
  const trimmed = baseUrl.trim();
  return fullUrl ? trimmed : `${trimmed.replace(/\/+$/u, "")}${API_FORMAT_PATHS[apiFormat]}`;
}

/** IndexedDB llmEntries 表中的一条模型配置；同一厂商可有多条，各用各的 Key */
export interface LlmSettingsRecord {
  /** 配置 id，兼作桌面端密钥槽名：旧版迁移来的记录为厂商名，新建的为“厂商名~随机后缀” */
  readonly id: string;
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly updatedAt: number;
  /** 自定义 OpenAI 兼容端点；存在时跳过模型白名单，模型名交由上游校验 */
  readonly baseUrl?: string;
  /** 停用后不出现在聊天区模型选择器中；缺省视为启用 */
  readonly disabled?: boolean;
  /** 「自定义模型」表单的设置；只与 baseUrl 一同存在 */
  readonly custom?: CustomModelSettings;
}

/** 发送聊天请求时携带的激活配置（未配置 Key 时为 undefined，走服务端 fallback） */
export interface ActiveLlmConfig {
  readonly provider: ProviderId;
  /** 桌面端网关据此从加密存储取对应配置的 Key */
  readonly keySlot?: string;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly custom?: CustomModelSettings;
}

/** 配置在列表与模型选择器中的名称：自定义模型优先用展示名 */
export function entryDisplayModel(entry: { readonly model: string; readonly custom?: CustomModelSettings }): string {
  return entry.custom?.displayName ?? entry.model;
}

/**
 * 当前配置能否发送图片：自定义模型按其「支持图片输入」设置；内置预设模型按白名单判断；
 * 其余自定义端点或非内置模型交由上游判定；未配置（服务端 fallback）视为支持
 */
export function supportsImageInput(config: ActiveLlmConfig | undefined): boolean {
  if (config?.custom !== undefined) return config.custom.supportsImage !== false;
  if (config === undefined || config.baseUrl !== undefined) return true;
  const meta = PROVIDER_METADATA[config.provider];
  return !meta.models.includes(config.model) || meta.imageModels.includes(config.model);
}

/** 扩展供应商展示卡片模型（支持图 2 丰富的供应商选择列表） */
export interface ModelVendorItem {
  readonly id: string;
  readonly name: string;
  readonly mappedProvider: ProviderId;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly defaultBaseUrl?: string;
  /** 获取 API Key 的控制台地址或名称，界面按语言拼接提示语 */
  readonly keySource: string;
  readonly supportsImage: boolean;
  readonly isCustom?: boolean;
}

export const MODEL_VENDORS: readonly ModelVendorItem[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    mappedProvider: "deepseek",
    defaultModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    keySource: "platform.deepseek.com",
    supportsImage: true,
  },
  {
    id: "volcengine",
    name: "火山引擎",
    mappedProvider: "openai",
    defaultModel: "doubao-seed-2-1-turbo-260628",
    models: [
      "doubao-seed-2-1-turbo-260628",
      "doubao-seed-2-1-pro-260915",
      "doubao-seed-2-1-lite-260915",
      "doubao-seed-2-0-lite-260428",
      "doubao-seed-2-0-mini-260428",
      "doubao-seed-evolving",
    ],
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    keySource: "console.volcengine.com/ark",
    supportsImage: true,
  },
  {
    id: "minimax_cn",
    name: "MiniMax CN",
    mappedProvider: "openai",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M3.1-Flash"],
    defaultBaseUrl: "https://api.minimax.cn/v1",
    keySource: "platform.minimax.cn",
    supportsImage: true,
  },
  {
    id: "minimax_global",
    name: "MiniMax Global",
    mappedProvider: "openai",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M3.1-Flash"],
    defaultBaseUrl: "https://api.minimax.io/v1",
    keySource: "platform.minimax.io",
    supportsImage: true,
  },
  {
    id: "glm",
    name: "Bigmodel",
    mappedProvider: "glm",
    defaultModel: "glm-5.3-flash",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.2", "glm-4.7-flash", "glm-4.6", "glm-4.6v-flash"],
    keySource: "open.bigmodel.cn",
    supportsImage: true,
  },
  {
    id: "aliyun",
    name: "阿里云百炼",
    mappedProvider: "openai",
    defaultModel: "qwen3.8-flash",
    models: ["qwen3.8-flash", "qwen3.8-max", "qwen3.7-plus", "qwen3.7-flash"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keySource: "dashscope.console.aliyun.com",
    supportsImage: true,
  },
  {
    id: "xiaomi_mimo",
    name: "Xiaomi MiMo",
    mappedProvider: "openai",
    defaultModel: "mimo-v2.6-flash",
    models: ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed"],
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    keySource: "mimo.mi.com",
    supportsImage: true,
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    mappedProvider: "openai",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"],
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    keySource: "cloud.siliconflow.cn",
    supportsImage: true,
  },
  {
    id: "zai",
    name: "Z.ai",
    mappedProvider: "glm",
    defaultModel: "glm-5.3-flash",
    models: ["glm-5.3-flash", "glm-5.3", "glm-5.3-flashx", "glm-5.2"],
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    keySource: "z.ai",
    supportsImage: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    mappedProvider: "openai",
    defaultModel: "anthropic/claude-3.7-sonnet",
    models: ["anthropic/claude-3.7-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1", "google/gemini-2.5-flash"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    keySource: "openrouter.ai/keys",
    supportsImage: true,
  },
  {
    id: "kimi_cn",
    name: "Kimi CN",
    mappedProvider: "openai",
    defaultModel: "kimi-k2.6",
    models: ["kimi-k2.6", "kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"],
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    keySource: "platform.kimi.com",
    supportsImage: true,
  },
  {
    id: "kimi_global",
    name: "Kimi Global",
    mappedProvider: "openai",
    defaultModel: "kimi-k2.6",
    models: ["kimi-k2.6", "kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"],
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    keySource: "platform.kimi.ai",
    supportsImage: true,
  },
  {
    id: "byteplus",
    name: "BytePlus ModelArk",
    mappedProvider: "openai",
    defaultModel: "dola-seed-2-1-turbo-260628",
    models: ["dola-seed-2-1-turbo-260628", "seed-2-0-pro-260328", "seed-2-0-lite-260428", "seed-2-0-mini-260428"],
    defaultBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    keySource: "console.byteplus.com/ark",
    supportsImage: true,
  },
  {
    id: "aws",
    name: "AWS",
    mappedProvider: "claude",
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-haiku-4-5"],
    keySource: "aws.amazon.com/bedrock",
    supportsImage: true,
  },
  {
    id: "tencent",
    name: "腾讯云 TokenHub",
    mappedProvider: "openai",
    defaultModel: "hy3",
    models: ["hy3", "hy4-preview", "hy-vision-2.0-instruct"],
    defaultBaseUrl: "https://tokenhub.tencentmaas.com/v1",
    keySource: "腾讯云 TokenHub 控制台",
    supportsImage: true,
  },
  {
    id: "qianfan",
    name: "百度千帆",
    mappedProvider: "openai",
    defaultModel: "ernie-5.1",
    models: ["ernie-5.1", "ernie-5.0-thinking-preview", "ernie-4.5-turbo-vl"],
    defaultBaseUrl: "https://qianfan.baidubce.com/v2",
    keySource: "console.bce.baidu.com/qianfan",
    supportsImage: true,
  },
  {
    id: "magic_ark",
    name: "魔力方舟",
    mappedProvider: "openai",
    defaultModel: "magic-v1-chat",
    models: ["magic-v1-chat", "magic-v1-fast"],
    defaultBaseUrl: "https://api.magicark.cn/v1",
    keySource: "magicark.cn",
    supportsImage: false,
  },
  {
    id: "ppio",
    name: "PPIO",
    mappedProvider: "openai",
    defaultModel: "deepseek/deepseek-v3",
    models: ["deepseek/deepseek-v3", "deepseek/deepseek-r1"],
    defaultBaseUrl: "https://api.ppinfra.com/v3/openai",
    keySource: "ppinfra.com",
    supportsImage: true,
  },
  {
    id: "stepfun",
    name: "阶跃星辰 StepFun",
    mappedProvider: "stepfun",
    defaultModel: "step-3.7-flash",
    models: [
      "step-3.7-flash",
      "step-5-preview",
      "step-3.5-flash",
      "step-3.5-flash-2603",
      "step-2-16k",
      "step-1-8k",
      "step-1v-8k",
      "step-plan",
    ],
    keySource: "StepFun Step Plan",
    supportsImage: true,
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    mappedProvider: "openai",
    defaultModel: "gpt-6-luna",
    models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-4.1", "gpt-4.1-mini"],
    keySource: "platform.openai.com",
    supportsImage: true,
  },
  {
    id: "claude",
    name: "Anthropic (Claude)",
    mappedProvider: "claude",
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    keySource: "console.anthropic.com",
    supportsImage: true,
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    mappedProvider: "gemini",
    defaultModel: "gemini-3.8-flash",
    models: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro"],
    keySource: "aistudio.google.com",
    supportsImage: true,
  },
];

function endpointHost(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * 多张厂商卡片共用同一 ProviderId 存储槽（火山、Kimi、百炼等都映射到 openai），
 * 按端点主机名找回已保存配置所属的卡片；未自定义端点时对应不带默认端点的卡片，
 * 仍有多张时优先取 id 与存储槽同名的原生卡片。
 */
export function findVendorForEntry(
  provider: ProviderId,
  baseUrl: string | undefined,
): ModelVendorItem | undefined {
  const host = endpointHost(baseUrl);
  const candidates = MODEL_VENDORS.filter(
    (vendor) =>
      vendor.mappedProvider === provider &&
      (host === undefined
        ? vendor.defaultBaseUrl === undefined
        : endpointHost(vendor.defaultBaseUrl) === host),
  );
  return candidates.find((vendor) => vendor.id === provider) ?? candidates[0];
}

/** 前端 API Key 宽松校验：非空、长度 20-512、可打印 ASCII（与后端 isValidApiKey 对齐） */
export function isValidApiKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 512) return false;
  return /^[\x20-\x7E]+$/u.test(trimmed);
}

/** 前端 Base URL 校验：https 起始、无空白字符、≤2048（与后端校验对齐） */
export function isValidBaseUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  return /^https:\/\/\S+$/u.test(trimmed);
}

