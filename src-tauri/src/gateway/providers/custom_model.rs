//! 「自定义模型」：按用户选择的 API 格式（Chat Completions / Responses / Anthropic Messages）解析端点与线路协议，
//! 并在各协议请求体上套用输出预算、思考开关与采样参数。
//!
//! 只服务带 baseUrl 的自定义端点；规则须与 Web 端 `functions/_shared/providers/custom-model.ts` 保持一致。

use crate::gateway::agent::runtime::WireProtocol;
use crate::gateway::providers::compat_vendor::CompatVendor;
use crate::types::{ApiFormat, ClientChatRequest, CustomModelOptions, ModelFamily, RequestMode, ThinkingMode};
use serde_json::{json, Value};

/// Anthropic 协议必须携带 max_tokens；Agent 单轮未设置上限时的缺省预算
pub const CUSTOM_ANTHROPIC_AGENT_MAX_TOKENS: u32 = 32_000;

pub fn protocol(format: ApiFormat) -> WireProtocol {
    match format {
        ApiFormat::ChatCompletions => WireProtocol::ChatCompletions,
        ApiFormat::Responses => WireProtocol::Responses,
        ApiFormat::AnthropicMessages => WireProtocol::Anthropic,
    }
}

/// 完整 URL 原样使用，否则剥掉尾部斜杠后补全协议路径
pub fn resolve_endpoint(base_url: &str, options: &CustomModelOptions) -> String {
    if options.full_url {
        return base_url.to_string();
    }
    let path = match options.api_format {
        ApiFormat::ChatCompletions => "/chat/completions",
        ApiFormat::Responses => "/responses",
        ApiFormat::AnthropicMessages => "/messages",
    };
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

/// 显式选择的模型系列优先于端点主机名识别：聚合平台或自建网关的主机名无法反映实际模型。
/// DeepSeek / GPT / Claude 不属于主机名识别的兼容厂商
pub fn vendor(options: &CustomModelOptions, base_url: &str) -> Option<CompatVendor> {
    match options.family {
        Some(ModelFamily::Qwen) => Some(CompatVendor::Dashscope),
        Some(ModelFamily::Glm) => Some(CompatVendor::Zhipu),
        Some(ModelFamily::Kimi) => Some(CompatVendor::Moonshot),
        Some(ModelFamily::Doubao) => Some(CompatVendor::Ark),
        Some(ModelFamily::Minimax) => Some(CompatVendor::MiniMax),
        Some(ModelFamily::Deepseek | ModelFamily::Gpt | ModelFamily::Claude) => None,
        None => CompatVendor::detect(base_url),
    }
}

/// 范围与前端 CUSTOM_MODEL_LIMITS 一致
fn validate(options: &CustomModelOptions) -> Result<(), String> {
    let in_range = |value: Option<f64>, min: f64, max: f64| value.map_or(true, |v| v.is_finite() && (min..=max).contains(&v));
    let valid = options.max_output_tokens.map_or(true, |v| (1..=1_000_000).contains(&v))
        && options.top_k.map_or(true, |v| (1..=100).contains(&v))
        && in_range(options.temperature, 0.0, 2.0)
        && in_range(options.top_p, 0.0, 1.0);
    if valid { Ok(()) } else { Err("自定义模型参数超出范围".to_string()) }
}

/// 自定义模型参数只对自定义端点有意义，单独出现视为非法请求（与 Web 端校验一致）
pub fn validated_custom_model(request: &ClientChatRequest) -> Result<Option<&CustomModelOptions>, String> {
    let Some(options) = request.custom_model.as_ref() else {
        return Ok(None);
    };
    if request.base_url.is_none() {
        return Err("自定义模型参数需要自定义端点".to_string());
    }
    validate(options)?;
    Ok(Some(options))
}

/// 输出预算：缺省沿用各协议原生路径的默认值（Anthropic 必填）；用户上限对聊天与 Agent 直接生效，
/// 标题与摘要取两者较小值，避免小预算请求被放大
pub fn max_tokens(format: ApiFormat, mode: Option<RequestMode>, agent: bool, options: &CustomModelOptions) -> Option<u32> {
    let anthropic = format == ApiFormat::AnthropicMessages;
    let auxiliary = !agent && matches!(mode, Some(RequestMode::Title | RequestMode::Summary));
    let fallback = if agent {
        anthropic.then_some(CUSTOM_ANTHROPIC_AGENT_MAX_TOKENS)
    } else {
        match mode {
            Some(RequestMode::Title) => Some(if anthropic { 1024 } else { 512 }),
            Some(RequestMode::Summary) => Some(4096),
            _ => anthropic.then_some(16_000),
        }
    };
    match (options.max_output_tokens, fallback) {
        (Some(user), Some(fallback)) if auxiliary => Some(user.min(fallback)),
        (Some(user), _) => Some(user),
        (None, fallback) => fallback,
    }
}

/// Chat Completions 的思考开关写法因模型系列而异：GPT 用 reasoning_effort（none 即关闭），
/// 千问用 enable_thinking，MiniMax 思考默认开启且只能用 thinking.disabled 关闭，
/// 其余（DeepSeek、GLM、Kimi、豆包等）沿用最通行的 thinking.type
pub fn chat_thinking_patch(family: Option<ModelFamily>, thinking: ThinkingMode) -> Vec<(&'static str, Value)> {
    let on = thinking == ThinkingMode::On;
    match family {
        Some(ModelFamily::Gpt) => vec![("reasoning_effort", json!(if on { "medium" } else { "none" }))],
        Some(ModelFamily::Qwen) => vec![("enable_thinking", json!(on))],
        Some(ModelFamily::Minimax) if on => Vec::new(),
        _ => vec![("thinking", json!({ "type": if on { "enabled" } else { "disabled" } }))],
    }
}

fn remove_field(body: &mut Value, field: &str) {
    if let Some(object) = body.as_object_mut() {
        object.remove(field);
    }
}

/// 在已构造好的请求体上套用自定义模型设置。显式思考开关覆盖厂商规则：关闭时去掉与之互斥的强度字段，
/// 开启只作用于聊天与 Agent，标题与摘要保持厂商规则以免耗尽小预算
pub fn apply_options(body: &mut Value, protocol: WireProtocol, options: &CustomModelOptions, mode: Option<RequestMode>, agent: bool) {
    let auxiliary = !agent && matches!(mode, Some(RequestMode::Title | RequestMode::Summary));
    let budget = max_tokens(options.api_format, mode, agent, options);
    let force_on = options.thinking == Some(ThinkingMode::On) && !auxiliary;
    let force_off = options.thinking == Some(ThinkingMode::Off);
    match protocol {
        WireProtocol::ChatCompletions => {
            if let Some(budget) = budget {
                remove_field(body, "max_tokens");
                remove_field(body, "max_completion_tokens");
                // OpenAI 推理模型拒绝 max_tokens，GPT 系列改用 max_completion_tokens
                let field = if options.family == Some(ModelFamily::Gpt) { "max_completion_tokens" } else { "max_tokens" };
                body[field] = json!(budget);
            }
            if force_off {
                remove_field(body, "reasoning_effort");
            }
            if force_on || force_off {
                let mode = if force_on { ThinkingMode::On } else { ThinkingMode::Off };
                for (field, value) in chat_thinking_patch(options.family, mode) {
                    body[field] = value;
                }
            }
            apply_sampling(body, options, true, true);
        }
        WireProtocol::Responses => {
            if let Some(budget) = budget {
                body["max_output_tokens"] = json!(budget);
            }
            // 开启时要求返回推理摘要供思考流展示
            if force_off {
                body["reasoning"] = json!({ "effort": "none" });
            } else if force_on {
                body["reasoning"] = json!({ "effort": "medium", "summary": "auto" });
            }
            apply_sampling(body, options, true, false);
        }
        WireProtocol::Anthropic => {
            // 原生构造器按 Claude 5 规则写入的 adaptive 思考、effort 与服务端回退，对第三方端点不一定成立
            for field in ["thinking", "output_config", "fallbacks"] {
                remove_field(body, field);
            }
            let budget = budget.unwrap_or(CUSTOM_ANTHROPIC_AGENT_MAX_TOKENS);
            body["max_tokens"] = json!(budget);
            // 显式思考用第三方端点普遍支持的 budget_tokens 协议：预算须 ≥1024 且小于 max_tokens；
            // 开启思考时上游不接受修改 temperature 与 top_k
            let thinking_enabled = force_on && budget > 1024;
            if force_off {
                body["thinking"] = json!({ "type": "disabled" });
            } else if thinking_enabled {
                body["thinking"] = json!({ "type": "enabled", "budget_tokens": (budget / 2).max(1024) });
            }
            apply_sampling(body, options, !thinking_enabled, !thinking_enabled);
        }
        WireProtocol::Gemini => {}
    }
}

/// 留空的采样参数不发送；Responses 不支持 top_k
fn apply_sampling(body: &mut Value, options: &CustomModelOptions, temperature: bool, top_k: bool) {
    if let (Some(value), true) = (options.temperature, temperature) {
        body["temperature"] = json!(value);
    }
    if let Some(value) = options.top_p {
        body["top_p"] = json!(value);
    }
    if let (Some(value), true) = (options.top_k, top_k) {
        body["top_k"] = json!(value);
    }
}
