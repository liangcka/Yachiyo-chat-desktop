import { buildSystemPrompt } from "../prompt";
import type { ExtractedDelta, TokenUsage } from "../stream";
import type { ClientChatRequest, ClientHistoryMessage } from "../validation";
import type { EnrichedChatRequest } from "../web-search";
import { type CompatVendor, compatVendorBodyPatch, detectCompatVendor } from "./compat-vendors";
import type {
  BuiltProviderRequest,
  JudgeRequestInput,
  ProviderAdapter,
  ProviderRequestInput,
} from "./registry";

export interface OpenAICompatConfig {
  readonly endpoint: string;
  readonly defaultModel: string;
  readonly allowedModels: readonly string[];
  readonly supportsImage: boolean;
  readonly imageModels: readonly string[];
  /** 该 provider 的模型为推理型且支持 OpenAI 风格 reasoning_effort 参数（思考 token 计入 max_tokens，需显式控制） */
  readonly reasoningEffort?: boolean;
  /** 该 provider 使用 DeepSeek 格式的 thinking 开关（thinking.type），默认开启思考，辅助请求需显式关闭 */
  readonly deepseekThinking?: boolean;
  /**
   * OpenAI 官方端点规则，仅在未自定义 baseUrl 时生效：GPT-5/6 推理模型拒绝 max_tokens，
   * 输出预算改用 max_completion_tokens，并为推理模型下发 reasoning_effort；第三方兼容网关不一定认这两个字段
   */
  readonly openaiOfficialRules?: boolean;
}

/** 请求体构造选项：由 adapter 按厂商配置、所选模型与是否自定义端点解析得出 */
export interface OpenAICompatBodyOptions {
  readonly supportsImage: boolean;
  /** 下发 reasoning_effort：思考 token 计入输出预算，需显式压低思考档位 */
  readonly reasoningEffort?: boolean;
  /** DeepSeek 格式 thinking 开关：辅助请求关闭思考 */
  readonly deepseekThinking?: boolean;
  /** 输出预算字段使用 max_completion_tokens 而非 max_tokens */
  readonly maxCompletionTokens?: boolean;
  /** 自定义端点识别出的第三方厂商，按其协议补充思考开关与思考强度 */
  readonly compatVendor?: CompatVendor;
}

/** GPT-5/GPT-6 系列为推理模型（接受 reasoning_effort）；gpt-4.1 等非推理模型传该字段会被拒绝 */
function isOpenAIReasoningModel(model: string): boolean {
  return /^gpt-[56]/u.test(model);
}

function resolveBodyOptions(
  config: OpenAICompatConfig,
  model: string,
  baseUrl: string | undefined,
): OpenAICompatBodyOptions {
  const official = config.openaiOfficialRules === true && baseUrl === undefined;
  return {
    supportsImage: config.supportsImage,
    reasoningEffort: config.reasoningEffort === true || (official && isOpenAIReasoningModel(model)),
    deepseekThinking: config.deepseekThinking === true,
    maxCompletionTokens: official,
    compatVendor: detectCompatVendor(baseUrl),
  };
}

interface OpenAITextPart {
  type: "text";
  text: string;
}

interface OpenAIImagePart {
  type: "image_url";
  image_url: { url: string };
}

type OpenAIMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<OpenAITextPart | OpenAIImagePart> };

function mapHistoryMessage(
  message: ClientHistoryMessage,
  locale: ClientChatRequest["locale"],
  supportsImage: boolean,
): OpenAIMessage {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.text };
  }
  if (message.imageDataUrl === undefined || !supportsImage) {
    return { role: "user", content: message.text };
  }
  const text =
    message.text.length > 0
      ? message.text
      : locale === "ja-JP"
        ? "この画像を見てください。"
        : "请看看这张图片。";
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "image_url", image_url: { url: message.imageDataUrl } },
    ],
  };
}

export function buildOpenAICompatBody(
  request: EnrichedChatRequest,
  model: string,
  options: OpenAICompatBodyOptions,
): unknown {
  const auxiliary = request.mode === "title" || request.mode === "summary";
  const containsImage = request.messages.some((message) => message.imageDataUrl !== undefined);
  const maxTokensField = options.maxCompletionTokens === true ? "max_completion_tokens" : "max_tokens";
  return {
    model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request.locale, request.mode, {
          webSearch: request.webSearch,
          smartSearch: request.smartSearch,
          searchResults: request.searchResults,
          currentTime: request.currentTime,
        }),
      },
      ...request.messages.map((message) =>
        mapHistoryMessage(message, request.locale, options.supportsImage),
      ),
    ],
    stream: true,
    stream_options: { include_usage: true },
    // 推理模型的思考 token 计入输出预算，过小会被思考耗尽导致正文为空
    [maxTokensField]: request.mode === "title" ? 512 : request.mode === "summary" ? 4096 : 8192,
    ...(options.reasoningEffort === true ? { reasoning_effort: containsImage ? "medium" : "low" } : {}),
    // 标题与摘要预算有限，默认开启的思考会先耗尽 max_tokens（对齐 DSH 辅助调用的 thinking.disabled）
    ...(options.deepseekThinking === true && auxiliary ? { thinking: { type: "disabled" as const } } : {}),
    ...compatVendorBodyPatch(options.compatVendor, model, auxiliary ? "auxiliary" : "chat"),
  };
}

function isRawUsage(
  value: unknown,
): value is { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
  return typeof value === "object" && value !== null;
}

export function extractOpenAIDeltaText(data: string): ExtractedDelta {
  if (data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  if (typeof parsed !== "object" || parsed === null || "error" in parsed) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const recordObj = parsed as Record<string, unknown>;
  let usage: TokenUsage | undefined;
  if (isRawUsage(recordObj.usage)) {
    const p = recordObj.usage.prompt_tokens;
    const c = recordObj.usage.completion_tokens;
    const t = recordObj.usage.total_tokens;
    usage = {
      ...(typeof p === "number" ? { promptTokens: p } : {}),
      ...(typeof c === "number" ? { completionTokens: c } : {}),
      ...(typeof t === "number" ? { totalTokens: t } : {}),
    };
  }

  const choices = recordObj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return usage !== undefined ? { usage } : null;
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const deltaObj = delta as Record<string, unknown>;
  const content =
    typeof deltaObj.content === "string" && deltaObj.content.length > 0 ? deltaObj.content : null;
  const thought =
    typeof deltaObj.reasoning_content === "string" && deltaObj.reasoning_content.length > 0
      ? deltaObj.reasoning_content
      : typeof deltaObj.reasoning === "string" && deltaObj.reasoning.length > 0
        ? deltaObj.reasoning
        : null;

  if (content === null && thought === null && usage === undefined) {
    return null;
  }
  return {
    content,
    thought,
    ...(usage !== undefined ? { usage } : {}),
  };
}

/** 非流式 judge 响应：提取 choices[0].message.content 完整文本 */
export function extractOpenAIJudgeText(responseJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string" || content.length === 0) return null;
  return content;
}

/** 端点解析：自定义 baseUrl（剥掉尾部斜杠后拼 /chat/completions）覆盖厂商默认端点 */
function resolveEndpoint(baseUrl: string | undefined, defaultEndpoint: string): string {
  if (baseUrl === undefined) return defaultEndpoint;
  return `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
}

export function buildOpenAICompatAdapter(
  id: ProviderAdapter["id"],
  config: OpenAICompatConfig,
): ProviderAdapter {
  return {
    id,
    isOpenAICompat: true,
    supportsImage: config.supportsImage,
    imageModels: config.imageModels,
    defaultModel: config.defaultModel,
    allowedModels: config.allowedModels,
    buildRequest(input: ProviderRequestInput): BuiltProviderRequest {
      const body = buildOpenAICompatBody(
        input.request,
        input.model,
        resolveBodyOptions(config, input.model, input.baseUrl),
      );
      return {
        url: resolveEndpoint(input.baseUrl, config.endpoint),
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      };
    },
    extractDeltaText: extractOpenAIDeltaText,
    buildJudgeRequest(input: JudgeRequestInput): BuiltProviderRequest {
      const options = resolveBodyOptions(config, input.model, input.baseUrl);
      const body = {
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.messages.map((message) => ({ role: message.role, content: message.text })),
        ],
        stream: false,
        // 推理模型的思考 token 计入输出预算，512 足够 YES/NO 输出
        [options.maxCompletionTokens === true ? "max_completion_tokens" : "max_tokens"]: 512,
        ...(options.reasoningEffort === true ? { reasoning_effort: "low" as const } : {}),
        ...(options.deepseekThinking === true ? { thinking: { type: "disabled" as const } } : {}),
        ...compatVendorBodyPatch(options.compatVendor, input.model, "auxiliary"),
      };
      return {
        url: resolveEndpoint(input.baseUrl, config.endpoint),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      };
    },
    extractJudgeText: extractOpenAIJudgeText,
  };
}
