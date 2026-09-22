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
  readonly apiKeyHint: string;
}

export const PROVIDER_METADATA: Readonly<Record<ProviderId, LlmProviderMeta>> = Object.freeze({
  stepfun: {
    id: "stepfun",
    group: "domestic",
    label: "阶跃星辰 StepFun（Step Plan）",
    models: [
      "step-3.7-flash",
      "step-3.5-flash",
      "step-3.5-flash-2603",
      "step-2-16k",
      "step-1-8k",
      "step-1v-8k",
      "step-plan",
    ],
    defaultModel: "step-3.7-flash",
    supportsImage: true,
    imageModels: ["step-3.7-flash"],
    apiKeyHint: "在 StepFun Step Plan 控制台获取 API Key",
  },
  deepseek: {
    id: "deepseek",
    group: "domestic",
    label: "DeepSeek",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
    defaultModel: "deepseek-v4-flash",
    supportsImage: true,
    imageModels: ["deepseek-v4-flash-vision-exp"],
    apiKeyHint: "在 platform.deepseek.com 获取 API Key",
  },
  glm: {
    id: "glm",
    group: "domestic",
    label: "智谱 GLM",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-4.7-flash", "glm-4.6", "glm-4.6v-flash", "glm-4v-flash"],
    defaultModel: "glm-5.3-flash",
    supportsImage: true,
    imageModels: ["glm-5.3-flash", "glm-4.6v-flash", "glm-4v-flash"],
    apiKeyHint: "在 open.bigmodel.cn 控制台获取 API Key",
  },
  openai: {
    id: "openai",
    group: "international",
    label: "OpenAI (GPT)",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-4.1", "gpt-4.1-mini"],
    defaultModel: "gpt-5.6-luna",
    supportsImage: true,
    imageModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-4.1", "gpt-4.1-mini"],
    apiKeyHint: "在 platform.openai.com 获取 API Key",
  },
  claude: {
    id: "claude",
    group: "international",
    label: "Anthropic (Claude)",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-5",
    supportsImage: true,
    imageModels: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    apiKeyHint: "在 console.anthropic.com 获取 API Key",
  },
  gemini: {
    id: "gemini",
    group: "international",
    label: "Google (Gemini)",
    models: [
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.1-flash-lite",
    ],
    defaultModel: "gemini-3.7-flash",
    supportsImage: true,
    imageModels: [
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.1-flash-lite",
    ],
    apiKeyHint: "在 aistudio.google.com 获取 API Key",
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
  readonly keyHint: string;
  readonly supportsImage: boolean;
  readonly isCustom?: boolean;
}

export const MODEL_VENDORS: readonly ModelVendorItem[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    mappedProvider: "deepseek",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp", "deepseek-chat", "deepseek-reasoner"],
    keyHint: "在 platform.deepseek.com 获取 API Key",
    supportsImage: true,
  },
  {
    id: "volcengine",
    name: "火山引擎",
    mappedProvider: "openai",
    defaultModel: "doubao-pro-32k",
    models: ["doubao-pro-32k", "doubao-lite-32k", "doubao-vision-pro"],
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    keyHint: "在 console.volcengine.com/ark 获取 API Key",
    supportsImage: true,
  },
  {
    id: "minimax_cn",
    name: "MiniMax CN",
    mappedProvider: "openai",
    defaultModel: "abab6.5s-chat",
    models: ["abab6.5s-chat", "abab6.5t-chat", "abab7-chat-preview"],
    defaultBaseUrl: "https://api.minimax.chat/v1",
    keyHint: "在 platform.minimaxi.com 获取 API Key",
    supportsImage: true,
  },
  {
    id: "minimax_global",
    name: "MiniMax Global",
    mappedProvider: "openai",
    defaultModel: "abab6.5s-chat",
    models: ["abab6.5s-chat", "abab6.5t-chat"],
    defaultBaseUrl: "https://api.minimaxi.chat/v1",
    keyHint: "在 api.minimaxi.chat 控制台获取 API Key",
    supportsImage: true,
  },
  {
    id: "glm",
    name: "Bigmodel",
    mappedProvider: "glm",
    defaultModel: "glm-5.3-flash",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-4.7-flash", "glm-4.6", "glm-4.6v-flash"],
    keyHint: "在 open.bigmodel.cn 控制台获取 API Key",
    supportsImage: true,
  },
  {
    id: "aliyun",
    name: "阿里云",
    mappedProvider: "openai",
    defaultModel: "qwen-max",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-vl-max"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyHint: "在 dashscope.console.aliyun.com 获取 API Key",
    supportsImage: true,
  },
  {
    id: "xiaomi_mimo",
    name: "Xiaomi MIMO",
    mappedProvider: "openai",
    defaultModel: "mimo-v1-chat",
    models: ["mimo-v1-chat", "mimo-v1-pro"],
    defaultBaseUrl: "https://api.mimo.mi.com/v1",
    keyHint: "在 mimo.mi.com 开放平台获取 API Key",
    supportsImage: false,
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    mappedProvider: "openai",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"],
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    keyHint: "在 cloud.siliconflow.cn 获取 API Key",
    supportsImage: true,
  },
  {
    id: "zai",
    name: "Z.ai",
    mappedProvider: "glm",
    defaultModel: "glm-5.3-flash",
    models: ["glm-5.3-flash", "glm-4.7-flash"],
    keyHint: "在 z.ai 开发者中心获取 API Key",
    supportsImage: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    mappedProvider: "openai",
    defaultModel: "anthropic/claude-3.7-sonnet",
    models: ["anthropic/claude-3.7-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1", "google/gemini-2.5-flash"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    keyHint: "在 openrouter.ai/keys 获取 API Key",
    supportsImage: true,
  },
  {
    id: "kimi_cn",
    name: "Kimi CN",
    mappedProvider: "openai",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    keyHint: "在 platform.moonshot.cn 获取 API Key",
    supportsImage: true,
  },
  {
    id: "kimi_global",
    name: "Kimi Global",
    mappedProvider: "openai",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    keyHint: "在 platform.moonshot.cn 获取 API Key",
    supportsImage: true,
  },
  {
    id: "byteplus",
    name: "BytePlus",
    mappedProvider: "openai",
    defaultModel: "doubao-pro-32k",
    models: ["doubao-pro-32k", "doubao-lite-32k"],
    defaultBaseUrl: "https://api.byteplus.com/v1",
    keyHint: "在 byteplus.com 控制台获取 API Key",
    supportsImage: true,
  },
  {
    id: "aws",
    name: "AWS",
    mappedProvider: "claude",
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-haiku-4-5"],
    keyHint: "在 aws.amazon.com/bedrock 获取凭据",
    supportsImage: true,
  },
  {
    id: "tencent",
    name: "腾讯云",
    mappedProvider: "openai",
    defaultModel: "hunyuan-pro",
    models: ["hunyuan-pro", "hunyuan-standard", "hunyuan-vision"],
    defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    keyHint: "在 console.cloud.tencent.com/hunyuan 获取 API Key",
    supportsImage: true,
  },
  {
    id: "magic_ark",
    name: "魔力方舟",
    mappedProvider: "openai",
    defaultModel: "magic-v1-chat",
    models: ["magic-v1-chat", "magic-v1-fast"],
    defaultBaseUrl: "https://api.magicark.cn/v1",
    keyHint: "在 magicark.cn 开发者控制台获取 API Key",
    supportsImage: false,
  },
  {
    id: "ppio",
    name: "PPIO",
    mappedProvider: "openai",
    defaultModel: "deepseek/deepseek-v3",
    models: ["deepseek/deepseek-v3", "deepseek/deepseek-r1"],
    defaultBaseUrl: "https://api.ppinfra.com/v3/openai",
    keyHint: "在 ppinfra.com 控制台获取 API Key",
    supportsImage: true,
  },
  {
    id: "stepfun",
    name: "阶跃星辰 StepFun",
    mappedProvider: "stepfun",
    defaultModel: "step-3.7-flash",
    models: [
      "step-3.7-flash",
      "step-3.5-flash",
      "step-3.5-flash-2603",
      "step-2-16k",
      "step-1-8k",
      "step-1v-8k",
      "step-plan",
    ],
    keyHint: "在 StepFun Step Plan 控制台获取 API Key",
    supportsImage: true,
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    mappedProvider: "openai",
    defaultModel: "gpt-5.6-luna",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-4.1", "gpt-4.1-mini"],
    keyHint: "在 platform.openai.com 获取 API Key",
    supportsImage: true,
  },
  {
    id: "claude",
    name: "Anthropic (Claude)",
    mappedProvider: "claude",
    defaultModel: "claude-sonnet-5",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    keyHint: "在 console.anthropic.com 获取 API Key",
    supportsImage: true,
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    mappedProvider: "gemini",
    defaultModel: "gemini-3.7-flash",
    models: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro"],
    keyHint: "在 aistudio.google.com 获取 API Key",
    supportsImage: true,
  },
];

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

