/**
 * 「自定义模型」适配器：按用户选择的 API 格式（Chat Completions / Responses / Anthropic Messages）
 * 构造请求与解析流，并套用输出预算、思考开关与采样参数。
 *
 * 只服务带 baseUrl 的自定义端点；规则须与桌面网关 src-tauri/src/gateway/providers/custom_model.rs 保持一致。
 */

import { buildSystemPrompt } from "../prompt";
import type { ExtractedDelta, TokenUsage } from "../stream";
import type { ApiFormat, ClientChatRequest, ClientHistoryMessage, CustomModelOptions, ModelFamily, RequestMode } from "../validation";
import type { EnrichedChatRequest } from "../web-search";
import {
  buildAnthropicMessages,
  buildAnthropicSystem,
  extractAnthropicDeltaText,
  extractAnthropicJudgeText,
} from "./anthropic";
import { type CompatVendor, compatVendorBodyPatch, detectCompatVendor } from "./compat-vendors";
import {
  buildOpenAICompatBody,
  createOpenAIDeltaExtractor,
  extractOpenAIDeltaText,
  extractOpenAIJudgeText,
} from "./openai-compat";
import type { BuiltProviderRequest, JudgeRequestInput, ProviderAdapter, ProviderRequestInput } from "./registry";

const ANTHROPIC_VERSION = "2023-06-01";

const FORMAT_PATHS: Readonly<Record<ApiFormat, string>> = {
  chat_completions: "/chat/completions",
  responses: "/responses",
  anthropic_messages: "/messages",
};

/** 完整 URL 原样使用，否则剥掉尾部斜杠后补全协议路径 */
export function resolveCustomEndpoint(baseUrl: string, options: CustomModelOptions): string {
  return options.fullUrl === true ? baseUrl : `${baseUrl.replace(/\/+$/u, "")}${FORMAT_PATHS[options.apiFormat]}`;
}

/** 模型系列对应的 OpenAI 兼容厂商规则；DeepSeek / GPT / Claude 不属于主机名识别的兼容厂商 */
const FAMILY_VENDORS: Readonly<Partial<Record<ModelFamily, CompatVendor>>> = {
  qwen: "dashscope",
  glm: "zhipu",
  kimi: "moonshot",
  doubao: "ark",
  minimax: "minimax",
};

/** 显式选择的模型系列优先于端点主机名识别：聚合平台或自建网关的主机名无法反映实际模型 */
export function resolveCustomVendor(options: CustomModelOptions, baseUrl: string): CompatVendor | undefined {
  return options.family !== undefined ? FAMILY_VENDORS[options.family] : detectCompatVendor(baseUrl);
}

function isAuxiliary(mode: RequestMode | undefined): boolean {
  return mode === "title" || mode === "summary";
}

/**
 * 输出预算：缺省沿用各协议原生路径的默认值；用户设置的上限对聊天直接生效，
 * 标题与摘要取两者较小值，避免小预算请求被放大
 */
export function customMaxTokens(format: ApiFormat, mode: RequestMode | undefined, options: CustomModelOptions): number {
  const anthropic = format === "anthropic_messages";
  const fallback = mode === "title" ? (anthropic ? 1024 : 512) : mode === "summary" ? 4096 : anthropic ? 16000 : 8192;
  if (options.maxOutputTokens === undefined) return fallback;
  return isAuxiliary(mode) ? Math.min(fallback, options.maxOutputTokens) : options.maxOutputTokens;
}

type Body = Record<string, unknown>;

/**
 * Chat Completions 的思考开关写法因模型系列而异：GPT 用 reasoning_effort（none 即关闭），
 * 千问用 enable_thinking，MiniMax 思考默认开启且只能用 thinking.disabled 关闭，
 * 其余（DeepSeek、GLM、Kimi、豆包等）沿用最通行的 thinking.type
 */
export function chatThinkingPatch(family: ModelFamily | undefined, thinking: "on" | "off"): Body {
  const on = thinking === "on";
  switch (family) {
    case "gpt":
      return { reasoning_effort: on ? "medium" : "none" };
    case "qwen":
      return { enable_thinking: on };
    case "minimax":
      return on ? {} : { thinking: { type: "disabled" } };
    default:
      return { thinking: { type: on ? "enabled" : "disabled" } };
  }
}

/** 留空的采样参数不发送；Responses 不支持 top_k */
function samplingFields(options: CustomModelOptions, format: ApiFormat, omitTemperatureAndTopK = false): Body {
  return {
    ...(options.temperature !== undefined && !omitTemperatureAndTopK ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.topK !== undefined && format !== "responses" && !omitTemperatureAndTopK ? { top_k: options.topK } : {}),
  };
}

/** 显式的思考开关覆盖厂商规则：关闭时去掉与之互斥的强度字段；开启只作用于聊天，辅助请求保持厂商规则以免耗尽小预算 */
function applyChatThinking(body: Body, options: CustomModelOptions, auxiliary: boolean): void {
  if (options.thinking === "off") {
    delete body.reasoning_effort;
    Object.assign(body, chatThinkingPatch(options.family, "off"));
  } else if (options.thinking === "on" && !auxiliary) {
    Object.assign(body, chatThinkingPatch(options.family, "on"));
  }
}

function buildChatCompletionsBody(request: EnrichedChatRequest, model: string, baseUrl: string, options: CustomModelOptions): Body {
  const auxiliary = isAuxiliary(request.mode);
  const body = buildOpenAICompatBody(request, model, {
    supportsImage: true,
    deepseekThinking: options.family === "deepseek",
    compatVendor: resolveCustomVendor(options, baseUrl),
  });
  // OpenAI 推理模型拒绝 max_tokens，GPT 系列改用 max_completion_tokens
  const budgetField = options.family === "gpt" ? "max_completion_tokens" : "max_tokens";
  delete body.max_tokens;
  body[budgetField] = customMaxTokens("chat_completions", request.mode, options);
  applyChatThinking(body, options, auxiliary);
  return { ...body, ...samplingFields(options, "chat_completions") };
}

/**
 * Anthropic 的显式思考用 budget_tokens 协议（第三方兼容端点普遍支持），预算须 ≥1024 且小于 max_tokens；
 * 开启思考时上游不接受修改 temperature 与 top_k，两者不再发送
 */
export function anthropicThinkingFields(options: CustomModelOptions, maxTokens: number, auxiliary: boolean): Body {
  if (options.thinking === "off") return { thinking: { type: "disabled" } };
  if (options.thinking === "on" && !auxiliary && maxTokens > 1024) {
    return { thinking: { type: "enabled", budget_tokens: Math.max(1024, Math.floor(maxTokens / 2)) } };
  }
  return {};
}

function buildAnthropicMessagesBody(request: EnrichedChatRequest, model: string, options: CustomModelOptions): Body {
  const maxTokens = customMaxTokens("anthropic_messages", request.mode, options);
  const thinking = anthropicThinkingFields(options, maxTokens, isAuxiliary(request.mode));
  return {
    model,
    max_tokens: maxTokens,
    system: buildAnthropicSystem(systemPromptFor(request)),
    messages: buildAnthropicMessages(request.messages, request.locale),
    stream: true,
    ...thinking,
    ...samplingFields(options, "anthropic_messages", "thinking" in thinking && options.thinking === "on"),
  };
}

function systemPromptFor(request: EnrichedChatRequest): string {
  return buildSystemPrompt(request.locale, request.mode, {
    webSearch: request.webSearch,
    smartSearch: request.smartSearch,
    searchResults: request.searchResults,
    currentTime: request.currentTime,
  });
}

type ResponsesInputItem =
  | { role: "assistant"; content: string }
  | {
      role: "user";
      content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }>;
    };

function responsesInput(message: ClientHistoryMessage, locale: ClientChatRequest["locale"]): ResponsesInputItem {
  if (message.role === "assistant") return { role: "assistant", content: message.text };
  if (message.imageDataUrl === undefined) {
    return { role: "user", content: [{ type: "input_text", text: message.text }] };
  }
  const text = message.text.length > 0 ? message.text : locale === "ja-JP" ? "この画像を見てください。" : "请看看这张图片。";
  return {
    role: "user",
    content: [
      { type: "input_text", text },
      { type: "input_image", image_url: message.imageDataUrl },
    ],
  };
}

/** Responses 的思考开关：开启时要求返回推理摘要供思考流展示，关闭为 effort none */
export function responsesReasoningFields(options: CustomModelOptions, auxiliary: boolean): Body {
  if (options.thinking === "off") return { reasoning: { effort: "none" } };
  if (options.thinking === "on" && !auxiliary) return { reasoning: { effort: "medium", summary: "auto" } };
  return {};
}

function buildResponsesBody(request: EnrichedChatRequest, model: string, options: CustomModelOptions): Body {
  return {
    model,
    instructions: systemPromptFor(request),
    input: request.messages.map((message) => responsesInput(message, request.locale)),
    stream: true,
    // 不在上游留存对话，与桌面网关一致
    store: false,
    max_output_tokens: customMaxTokens("responses", request.mode, options),
    ...responsesReasoningFields(options, isAuxiliary(request.mode)),
    ...samplingFields(options, "responses"),
  };
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

/** 解析 Responses 流事件：正文、推理摘要与最终用量；失败事件视为流损坏 */
export function extractResponsesDeltaText(data: string): ExtractedDelta {
  if (data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new TypeError("Invalid Responses SSE data");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Invalid Responses SSE data");
  }
  const event = parsed as Record<string, unknown>;
  const delta = typeof event.delta === "string" && event.delta.length > 0 ? event.delta : null;
  switch (event.type) {
    case "response.output_text.delta":
      return delta === null ? null : { content: delta };
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta":
      return delta === null ? null : { thought: delta };
    case "response.completed": {
      const response = event.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;
      const promptTokens = numberField(usage, "input_tokens");
      const completionTokens = numberField(usage, "output_tokens");
      const totalTokens = numberField(usage, "total_tokens");
      const result: TokenUsage = {
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
      };
      return Object.keys(result).length > 0 ? { usage: result } : null;
    }
    case "response.failed":
    case "error":
      throw new TypeError("Responses stream failed");
    default:
      return null;
  }
}

/** 非流式 Responses：拼接 message 输出项中的 output_text */
export function extractResponsesJudgeText(responseJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const output = (parsed as Record<string, unknown>).output;
  if (!Array.isArray(output)) return null;
  const text = output
    .flatMap((item): unknown[] => {
      if (typeof item !== "object" || item === null) return [];
      const value = item as Record<string, unknown>;
      return value.type === "message" && Array.isArray(value.content) ? value.content : [];
    })
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const value = part as Record<string, unknown>;
      return value.type === "output_text" && typeof value.text === "string" ? value.text : "";
    })
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

function requestHeaders(format: ApiFormat, apiKey: string, accept: string): Record<string, string> {
  return format === "anthropic_messages"
    ? { accept, "content-type": "application/json", "anthropic-version": ANTHROPIC_VERSION, "x-api-key": apiKey }
    : { accept, "content-type": "application/json", authorization: `Bearer ${apiKey}` };
}

const JUDGE_MAX_TOKENS = 512;

function buildJudgeBody(input: JudgeRequestInput, baseUrl: string, options: CustomModelOptions): Body {
  const messages = input.messages.map((message) => ({ role: message.role, content: message.text }));
  switch (options.apiFormat) {
    case "anthropic_messages":
      return {
        model: input.model,
        // 思考 token 计入 max_tokens，留出余量给可能常开的思考
        max_tokens: 1024,
        system: input.systemPrompt,
        messages,
        stream: false,
        ...(options.thinking === "off" ? { thinking: { type: "disabled" } } : {}),
      };
    case "responses":
      return {
        model: input.model,
        instructions: input.systemPrompt,
        input: messages,
        stream: false,
        store: false,
        max_output_tokens: JUDGE_MAX_TOKENS,
        ...responsesReasoningFields(options, true),
      };
    case "chat_completions": {
      const body: Body = {
        model: input.model,
        messages: [{ role: "system", content: input.systemPrompt }, ...messages],
        stream: false,
        [options.family === "gpt" ? "max_completion_tokens" : "max_tokens"]: JUDGE_MAX_TOKENS,
        ...(options.family === "deepseek" ? { thinking: { type: "disabled" } } : {}),
        ...compatVendorBodyPatch(resolveCustomVendor(options, baseUrl), input.model, "auxiliary"),
      };
      applyChatThinking(body, options, true);
      return body;
    }
  }
}

export function buildCustomModelAdapter(id: ProviderAdapter["id"], options: CustomModelOptions): ProviderAdapter {
  const format = options.apiFormat;
  const extractor =
    format === "anthropic_messages"
      ? extractAnthropicDeltaText
      : format === "responses"
        ? extractResponsesDeltaText
        : extractOpenAIDeltaText;
  return {
    id,
    isOpenAICompat: format === "chat_completions",
    supportsImage: true,
    imageModels: [],
    defaultModel: "",
    allowedModels: [],
    buildRequest(input: ProviderRequestInput): BuiltProviderRequest {
      const baseUrl = input.baseUrl ?? "";
      const body =
        format === "anthropic_messages"
          ? buildAnthropicMessagesBody(input.request, input.model, options)
          : format === "responses"
            ? buildResponsesBody(input.request, input.model, options)
            : buildChatCompletionsBody(input.request, input.model, baseUrl, options);
      return {
        url: resolveCustomEndpoint(baseUrl, options),
        headers: requestHeaders(format, input.apiKey, "text/event-stream"),
        body: JSON.stringify(body),
      };
    },
    extractDeltaText: extractor,
    ...(format === "chat_completions" ? { createDeltaExtractor: createOpenAIDeltaExtractor } : {}),
    buildJudgeRequest(input: JudgeRequestInput): BuiltProviderRequest {
      const baseUrl = input.baseUrl ?? "";
      return {
        url: resolveCustomEndpoint(baseUrl, options),
        headers: requestHeaders(format, input.apiKey, "application/json"),
        body: JSON.stringify(buildJudgeBody(input, baseUrl, options)),
      };
    },
    extractJudgeText:
      format === "anthropic_messages"
        ? extractAnthropicJudgeText
        : format === "responses"
          ? extractResponsesJudgeText
          : extractOpenAIJudgeText,
  };
}
