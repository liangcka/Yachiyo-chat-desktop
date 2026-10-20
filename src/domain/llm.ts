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

/** IndexedDB llmSettings 表中每家厂商的配置记录 */
export interface LlmSettingsRecord {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly updatedAt: number;
  /** 自定义 OpenAI 兼容端点；存在时跳过模型白名单，模型名交由上游校验 */
  readonly baseUrl?: string;
}

/** 发送聊天请求时携带的激活配置（未配置 Key 时为 undefined，走服务端 fallback） */
export interface ActiveLlmConfig {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
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
 * 按端点主机名找回已保存配置所属的卡片；未自定义端点时对应不带默认端点的原生卡片。
 */
export function findVendorForEntry(
  provider: ProviderId,
  baseUrl: string | undefined,
): ModelVendorItem | undefined {
  const host = endpointHost(baseUrl);
  return MODEL_VENDORS.find(
    (vendor) =>
      vendor.mappedProvider === provider &&
      (host === undefined
        ? vendor.defaultBaseUrl === undefined
        : endpointHost(vendor.defaultBaseUrl) === host),
  );
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

