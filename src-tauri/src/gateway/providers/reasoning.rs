//! 思考档位：界面统一的五档（轻度 / 中 / 高 / 极高 / Ultra）到各厂商原生取值的映射。
//!
//! 只为已核实取值的模型给出档位表；其余模型返回 None，界面据此禁用档位选择，请求也不携带强度字段，
//! 避免把不认识的取值发给上游导致 400。各家的取值依据见各分支注释。

use crate::gateway::agent::runtime::WireProtocol;
use crate::gateway::providers::compat_vendor::CompatVendor;
use crate::gateway::providers::registry::get_provider_config;
use crate::types::{ProviderId, ReasoningLevel};

/// 某个模型可选的档位（由浅到深）及其原生取值，default 为不指定档位时上游实际生效的档位（仅供界面展示）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReasoningSupport {
    pub levels: &'static [(ReasoningLevel, &'static str)],
    pub default: ReasoningLevel,
}

use ReasoningLevel::{High, Low, Max, Medium, Xhigh};

const FIVE_LEVELS: &[(ReasoningLevel, &str)] =
    &[(Low, "low"), (Medium, "medium"), (High, "high"), (Xhigh, "xhigh"), (Max, "max")];
const THREE_LEVELS: &[(ReasoningLevel, &str)] = &[(Low, "low"), (Medium, "medium"), (High, "high")];
const LOW_HIGH_MAX: &[(ReasoningLevel, &str)] = &[(Low, "low"), (High, "high"), (Max, "max")];

const fn support(levels: &'static [(ReasoningLevel, &'static str)], default: ReasoningLevel) -> Option<ReasoningSupport> {
    Some(ReasoningSupport { levels, default })
}

/// Claude：adaptive thinking 的 output_config.effort。Claude 5 系列与 Opus 4.7/4.8 支持 low～max 全部五档，
/// Opus 4.6 / Sonnet 4.6 没有 xhigh；Haiku 4.5 仍是 budget_tokens 协议，effort 会报错。
/// 默认档：Opus 5.5 与 Haiku 5.5 为 medium，其余为 high
fn claude_support(model: &str) -> Option<ReasoningSupport> {
    if model.starts_with("claude-opus-5-5") || model.starts_with("claude-haiku-5") {
        return support(FIVE_LEVELS, Medium);
    }
    let five = ["claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7"];
    if five.iter().any(|prefix| model.starts_with(prefix)) {
        return support(FIVE_LEVELS, High);
    }
    if model.starts_with("claude-opus-4-6") || model.starts_with("claude-sonnet-4-6") {
        return support(&[(Low, "low"), (Medium, "medium"), (High, "high"), (Max, "max")], High);
    }
    None
}

/// OpenAI 官方端点（Agent 走 Responses 的 reasoning.effort）：GPT-6 与 GPT-5.6 支持 low～max（none 即关闭思考，不作为档位），
/// GPT-5.5 最高到 xhigh，更早的 GPT-5 只确认 low / medium / high；默认档均为 medium
fn openai_support(model: &str) -> Option<ReasoningSupport> {
    if model.starts_with("gpt-6") || model.starts_with("gpt-5.6") {
        return support(FIVE_LEVELS, Medium);
    }
    if model.starts_with("gpt-5.5") {
        return support(&[(Low, "low"), (Medium, "medium"), (High, "high"), (Xhigh, "xhigh")], Medium);
    }
    if model.starts_with("gpt-5") {
        return support(THREE_LEVELS, Medium);
    }
    None
}

/// OpenAI 兼容厂商的 reasoning_effort，取值沿用 compat_vendor 中已核实的规则
fn compat_vendor_support(vendor: Option<CompatVendor>, model: &str) -> Option<ReasoningSupport> {
    match vendor {
        // K3 取值 low / high / max，默认 max；K2.x 没有强度字段
        Some(CompatVendor::Moonshot) if model.starts_with("kimi-k3") => support(LOW_HIGH_MAX, Max),
        // Qwen3.8 取值 low / medium / xhigh，默认 xhigh
        Some(CompatVendor::Dashscope) if matches!(model, "qwen3.8-max" | "qwen3.8-max-0902" | "qwen3.8-flash") => {
            support(&[(Low, "low"), (Medium, "medium"), (Xhigh, "xhigh")], Xhigh)
        }
        // 已确认的豆包 Seed 型号接受 minimal / low / medium / high（minimal 近似关闭思考，不作为档位）
        Some(CompatVendor::Ark)
            if ["doubao-seed-2-1-pro", "doubao-seed-2-1-turbo", "doubao-seed-evolving", "dola-seed-2-1-turbo"]
                .iter()
                .any(|prefix| model.starts_with(prefix)) =>
        {
            support(THREE_LEVELS, Medium)
        }
        // GLM-5.3 取值 low / high / max，默认 max
        Some(CompatVendor::Zhipu) if model.starts_with("glm-5.3") => support(LOW_HIGH_MAX, Max),
        // 混元 hy3 支持 low / high（none 为关闭）；hy4-preview 只有 high，无可调档位
        Some(CompatVendor::Hunyuan) if model.starts_with("hy3") => support(&[(Low, "low"), (High, "high")], High),
        // M3.1 Flash 思考常开、默认 max，只确认 low 与 max 两档
        Some(CompatVendor::MiniMax) if model.to_ascii_lowercase().starts_with("minimax-m3.1-flash") => {
            support(&[(Low, "low"), (Max, "max")], Max)
        }
        _ => None,
    }
}

/// 模型可选的思考档位；None 表示该模型不支持调节思考强度
pub fn reasoning_support(provider: ProviderId, base_url: Option<&str>, model: &str) -> Option<ReasoningSupport> {
    match provider {
        ProviderId::Claude => claude_support(model),
        ProviderId::Gemini if model.starts_with("gemini-3") || model.starts_with("gemini-4") => {
            // thinkingLevel：Gemini 3 / 4 均接受 low / medium / high（minimal 只有部分 Flash 支持，不作为档位）；
            // 本应用默认发送 low
            support(THREE_LEVELS, Low)
        }
        ProviderId::Gemini => None,
        ProviderId::Openai if base_url.is_none() => openai_support(model),
        // DeepSeek V4 的 reasoning_effort 实际只有 low / high / max 三档（其余取值被归并），默认 high
        ProviderId::Deepseek if base_url.is_none() && model.starts_with("deepseek-") => support(LOW_HIGH_MAX, High),
        // StepFun 推理模型只确认 low / medium
        ProviderId::Stepfun if base_url.is_none() && (model.starts_with("step-3") || model.starts_with("step-5")) => {
            support(&[(Low, "low"), (Medium, "medium")], Low)
        }
        _ => compat_vendor_support(CompatVendor::resolve(base_url, get_provider_config(provider).endpoint), model),
    }
}

/// 所选档位对应的原生取值；模型不支持调节或不提供该档位时返回 None，请求保持原样
pub fn native_effort(provider: ProviderId, base_url: Option<&str>, model: &str, level: ReasoningLevel) -> Option<&'static str> {
    reasoning_support(provider, base_url, model)?
        .levels
        .iter()
        .find(|(candidate, _)| *candidate == level)
        .map(|(_, native)| *native)
}

/// 把原生强度写入 Agent 请求体中各协议对应的位置，覆盖厂商规则给出的默认档
pub fn apply_agent_effort(body: &mut serde_json::Value, protocol: WireProtocol, effort: &str) {
    let value = serde_json::Value::from(effort);
    match protocol {
        WireProtocol::ChatCompletions => body["reasoning_effort"] = value,
        WireProtocol::Responses => body["reasoning"]["effort"] = value,
        WireProtocol::Anthropic => body["output_config"]["effort"] = value,
        WireProtocol::Gemini => body["generationConfig"]["thinkingConfig"]["thinkingLevel"] = value,
    }
}
