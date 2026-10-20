//! OpenAI 兼容厂商的协议差异规则。
//!
//! 各家沿用 Chat Completions 外形，但思考开关、思考强度与思维链回传的约定各不相同。
//! 按实际生效端点（自定义 baseUrl，否则为厂商默认端点）的主机名识别厂商，再按模型名套用规则；
//! 规则须与 Web 端 `functions/_shared/providers/compat-vendors.ts` 保持一致。

use serde_json::{json, Value};

/// 已适配的厂商
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatVendor {
    /// 火山方舟（豆包）与海外 BytePlus ModelArk
    Ark,
    /// 阿里云百炼（通义千问）
    Dashscope,
    /// 月之暗面 Kimi
    Moonshot,
    MiniMax,
    /// 小米 MiMo
    Mimo,
    /// 腾讯 TokenHub（混元）
    Hunyuan,
    /// 百度千帆（文心）
    Qianfan,
    /// 智谱 BigModel 与国际站 Z.ai
    Zhipu,
    SiliconFlow,
    OpenRouter,
    /// xAI Grok
    Xai,
}

/// 主机名后缀到厂商的映射；按后缀匹配以覆盖区域子域名（如 dashscope-intl、ark.cn-beijing）
const VENDOR_HOSTS: &[(&str, CompatVendor)] = &[
    ("volces.com", CompatVendor::Ark),
    ("bytepluses.com", CompatVendor::Ark),
    ("aliyuncs.com", CompatVendor::Dashscope),
    ("qwencloudapi.com", CompatVendor::Dashscope),
    ("moonshot.cn", CompatVendor::Moonshot),
    ("moonshot.ai", CompatVendor::Moonshot),
    ("minimax.cn", CompatVendor::MiniMax),
    ("minimaxi.com", CompatVendor::MiniMax),
    ("minimax.io", CompatVendor::MiniMax),
    ("xiaomimimo.com", CompatVendor::Mimo),
    ("tencentmaas.com", CompatVendor::Hunyuan),
    ("tencentcloudmaas.com", CompatVendor::Hunyuan),
    ("baidubce.com", CompatVendor::Qianfan),
    ("bigmodel.cn", CompatVendor::Zhipu),
    ("z.ai", CompatVendor::Zhipu),
    ("siliconflow.cn", CompatVendor::SiliconFlow),
    ("siliconflow.com", CompatVendor::SiliconFlow),
    ("openrouter.ai", CompatVendor::OpenRouter),
    ("x.ai", CompatVendor::Xai),
];

/// 部署在中国大陆的端点主机（.cn 域名之外）：开启全局代理时出海绕行会显著增加延迟，桌面网关对其直连优先
const DOMESTIC_HOSTS: &[&str] = &[
    "volces.com",
    "aliyuncs.com",
    "minimaxi.com",
    "xiaomimimo.com",
    "tencentmaas.com",
    "baidubce.com",
    "ppinfra.com",
    "gitee.com",
];

/// 取小写主机名；非法 URL 返回 None
fn endpoint_host(url: &str) -> Option<String> {
    let url = reqwest::Url::parse(url).ok()?;
    url.host_str().map(|host| host.to_ascii_lowercase())
}

fn host_matches(host: &str, suffix: &str) -> bool {
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

impl CompatVendor {
    pub fn detect(endpoint: &str) -> Option<Self> {
        let host = endpoint_host(endpoint)?;
        VENDOR_HOSTS
            .iter()
            .find(|(suffix, _)| host_matches(&host, suffix))
            .map(|(_, vendor)| *vendor)
    }

    /// 按实际生效端点识别：自定义 baseUrl 优先，否则用厂商默认端点（原生智谱也走同一套规则）
    pub fn resolve(base_url: Option<&str>, default_endpoint: &str) -> Option<Self> {
        Self::detect(base_url.unwrap_or(default_endpoint))
    }
}

/// 自定义端点是否位于中国大陆（.cn 域名或已知国内厂商主机）
pub fn is_domestic_endpoint(base_url: &str) -> bool {
    endpoint_host(base_url)
        .map(|host| host.ends_with(".cn") || DOMESTIC_HOSTS.iter().any(|suffix| host_matches(&host, suffix)))
        .unwrap_or(false)
}

/// 请求用途：聊天正文、标题摘要与联网判定等小预算辅助请求，或 Agent 工具循环
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestPurpose {
    Chat,
    Auxiliary,
    Agent,
}

/// Agent 循环中 assistant 消息回传思维链的方式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasoningPassback {
    /// 每条 assistant 消息都携带 reasoning_content，客户端重放的历史没有思维链时补空串
    EveryAssistant,
    /// 只回传本运行内非空的原文，不为没有思维链的轮次补写
    NonEmpty,
    /// MiniMax reasoning_split 格式：非空的原文重建为单元素 reasoning_details 数组回传
    MiniMaxDetails,
}

type Patch = Vec<(&'static str, Value)>;

/// 千问混合思考模型（默认开启思考）。仅思考的 preview 与早期快照传 enable_thinking:false 会 400，
/// 非思考 instruct 模型传该字段也会 400，因此只匹配确认为混合思考的型号
fn is_qwen_hybrid(model: &str) -> bool {
    let Some(rest) = model.strip_prefix("qwen3.") else {
        return false;
    };
    if matches!(rest, "8-max" | "8-max-0902" | "7-max") {
        return true;
    }
    let Some((generation, tier)) = rest.split_once('-') else {
        return false;
    };
    let (tier, snapshot) = tier.split_once('-').map_or((tier, None), |(tier, date)| (tier, Some(date)));
    let is_date = |date: &str| {
        date.len() == 10
            && date.char_indices().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
    };
    matches!(generation, "5" | "6" | "7" | "8")
        && matches!(tier, "plus" | "flash")
        && snapshot.map_or(true, is_date)
}

/// 方舟上确认为混合思考（默认开启、可用 thinking.type 关闭）的豆包 Seed 型号，含海外 BytePlus 的 dola-/seed- 命名。
/// 方舟同时托管强制思考的第三方模型（传 disabled 会 400），代码预览版的思考开关未确认，因此只匹配已确认的型号
fn is_ark_hybrid(model: &str) -> bool {
    let known = ["doubao-seed-1-8", "doubao-seed-2-0", "doubao-seed-2-1", "doubao-seed-evolving", "dola-seed-2", "seed-2-"];
    known.iter().any(|prefix| model.starts_with(prefix)) && !model.contains("code-preview")
}

/// 已确认接受 reasoning_effort（minimal / low / medium / high）的型号；其余型号的支持情况未核实，传了可能 400
fn is_ark_effort_model(model: &str) -> bool {
    ["doubao-seed-2-1-pro", "doubao-seed-2-1-turbo", "doubao-seed-evolving", "dola-seed-2-1-turbo"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

/// GLM-5.2 起才有 reasoning_effort 字段（GLM-5.3 取值 low / high / max，默认 max）
fn is_glm_effort_model(model: &str) -> bool {
    model.starts_with("glm-5.3") || model.starts_with("glm-5.2")
}

/// 智谱 GLM-4.7 起的强制思考模型支持保留式思考；更早的混合或非思考模型（glm-4.6、glm-4v-flash）不发送该开关
fn glm_preserves_thinking(model: &str) -> bool {
    model.starts_with("glm-5") || model.starts_with("glm-4.7")
}

/// 按厂商与模型给出需要并入请求体的字段；未识别的厂商或模型不做任何改动
pub fn body_patch(vendor: Option<CompatVendor>, model: &str, purpose: RequestPurpose) -> Patch {
    let auxiliary = purpose == RequestPurpose::Auxiliary;
    let agent = purpose == RequestPurpose::Agent;
    match vendor {
        // K3 思考常驻且不接受 thinking 字段，只能用 reasoning_effort（low/high/max，默认 max）压低档位；
        // K2.6 不支持 reasoning_effort，辅助请求用 thinking 关闭；K2.7 Code 只接受 keep:all 的 thinking，两者都不发。
        // Agent 沿用模型默认档位，与 Claude、OpenAI Agent 一致
        Some(CompatVendor::Moonshot) if model.starts_with("kimi-k3") && !agent => {
            vec![("reasoning_effort", json!("low"))]
        }
        Some(CompatVendor::Moonshot) if auxiliary && model.starts_with("kimi-k2.6") => {
            vec![("thinking", json!({ "type": "disabled" }))]
        }
        // Qwen3.8 默认 reasoning_effort 为 xhigh（合法值 low / medium / xhigh）；
        // 关闭思考时不能再带非 none 的 reasoning_effort，两者互斥
        Some(CompatVendor::Dashscope) if auxiliary && is_qwen_hybrid(model) => {
            vec![("enable_thinking", json!(false))]
        }
        Some(CompatVendor::Dashscope)
            if purpose == RequestPurpose::Chat && matches!(model, "qwen3.8-max" | "qwen3.8-max-0902" | "qwen3.8-flash") =>
        {
            vec![("reasoning_effort", json!("low"))]
        }
        // thinking.type 为 disabled 时 reasoning_effort 只能取 minimal，关闭思考时不再带强度字段
        Some(CompatVendor::Ark) if auxiliary && is_ark_hybrid(model) => {
            vec![("thinking", json!({ "type": "disabled" }))]
        }
        Some(CompatVendor::Ark) if purpose == RequestPurpose::Chat && is_ark_effort_model(model) => {
            vec![("reasoning_effort", json!("low"))]
        }
        Some(CompatVendor::MiniMax) => minimax_patch(&model.to_ascii_lowercase(), auxiliary),
        // MiMo V2.5 起默认开启思考，只能用 thinking.type 开关，没有思考强度字段
        Some(CompatVendor::Mimo) if auxiliary && model.starts_with("mimo-v2") => {
            vec![("thinking", json!({ "type": "disabled" }))]
        }
        // TokenHub 也托管 GLM-5.3 等强制思考模型（传 disabled 会失败），只对混元自家模型生效；
        // hy3 支持 low / high / none，hy4-preview 只支持 high / none
        Some(CompatVendor::Hunyuan) if auxiliary && (model.starts_with("hy3") || model.starts_with("hy4")) => {
            vec![("thinking", json!({ "type": "disabled" }))]
        }
        Some(CompatVendor::Hunyuan) if purpose == RequestPurpose::Chat && model.starts_with("hy3") => {
            vec![("reasoning_effort", json!("low"))]
        }
        // 文心只有 ernie-5.0-thinking-preview 默认开启思考且可用 enable_thinking 关闭，其余模型的开关未公开
        Some(CompatVendor::Qianfan) if auxiliary && model == "ernie-5.0-thinking-preview" => {
            vec![("enable_thinking", json!(false))]
        }
        // 保留式思考：clear_thinking:false 时服务端保留回传的 reasoning_content，跨工具轮次延续同一任务的推理
        Some(CompatVendor::Zhipu) if agent && glm_preserves_thinking(model) => {
            vec![("thinking", json!({ "type": "enabled", "clear_thinking": false }))]
        }
        // GLM-5.3 强制思考，传 thinking.disabled 会 400，默认档位 max 会耗尽小预算；官方建议改用 low 档
        Some(CompatVendor::Zhipu) if !agent && is_glm_effort_model(model) => {
            vec![("reasoning_effort", json!("low"))]
        }
        _ => Vec::new(),
    }
}

fn minimax_patch(model: &str, auxiliary: bool) -> Patch {
    // M3.1 Flash 思考常开且默认 max，用 reasoning_effort 压低（none 与 thinking.disabled 都会 400）；
    // 它默认已把思考放进 reasoning_content，不支持把 reasoning_split 设为 false，因此不发该字段
    if model.starts_with("minimax-m3.1-flash") {
        return vec![("reasoning_effort", json!("low"))];
    }
    // M3 与 M2.x 默认把思考以 <think> 标签混在 content 里，reasoning_split 把它拆到 reasoning_details；
    // M3 的 thinking.type 只接受 adaptive / disabled（enabled 会 400），M2.x 思考关不掉
    if model.starts_with("minimax-m3") {
        let mut patch = vec![("reasoning_split", json!(true))];
        if auxiliary {
            patch.push(("thinking", json!({ "type": "disabled" })));
        }
        return patch;
    }
    if model.starts_with("minimax-m2") {
        return vec![("reasoning_split", json!(true))];
    }
    Vec::new()
}

/// Agent 循环的思维链回传规则；DeepSeek 由 provider 自身规则处理
pub fn reasoning_passback(vendor: Option<CompatVendor>, model: &str) -> Option<ReasoningPassback> {
    match vendor {
        // Kimi 思考模型要求带 tool_calls 的 assistant 历史消息携带 reasoning_content，缺失时返回 400；
        // K3 与 K2.7 Code 常开保留式思考，非工具轮次同样回传
        Some(CompatVendor::Moonshot) if model.starts_with("kimi-k") => Some(ReasoningPassback::EveryAssistant),
        // MiMo 思考模式下，历史中带 tool_calls 的 assistant 消息缺少 reasoning_content 会返回 400
        Some(CompatVendor::Mimo) if model.starts_with("mimo-") => Some(ReasoningPassback::EveryAssistant),
        // Qwen3.x 工具轮次省略 reasoning_content 会降低准确率但不报错；Qwen3.8 默认保留式思考会读取回传的原文
        Some(CompatVendor::Dashscope) if model.starts_with("qwen3.") => Some(ReasoningPassback::NonEmpty),
        // 方舟、混元、千帆：多轮工具调用回填同一轮的 reasoning_content 以延续推理，缺失不报错，只影响效果
        Some(CompatVendor::Ark) if is_ark_hybrid(model) => Some(ReasoningPassback::NonEmpty),
        Some(CompatVendor::Hunyuan) if model.starts_with("hy") => Some(ReasoningPassback::NonEmpty),
        Some(CompatVendor::Qianfan) => Some(ReasoningPassback::NonEmpty),
        // GLM 保留式思考要求按原顺序回传未修改的 reasoning_content，但不得为没有思维链的历史轮次补写空串
        Some(CompatVendor::Zhipu) if glm_preserves_thinking(model) => Some(ReasoningPassback::NonEmpty),
        // MiniMax 要求工具多轮原样带回思考字段以延续交错思考；缺失不报错，但推理链会中断
        Some(CompatVendor::MiniMax) => {
            let model = model.to_ascii_lowercase();
            if model.starts_with("minimax-m3.1-flash") {
                Some(ReasoningPassback::NonEmpty)
            } else if model.starts_with("minimax-m3") || model.starts_with("minimax-m2") {
                Some(ReasoningPassback::MiniMaxDetails)
            } else {
                None
            }
        }
        _ => None,
    }
}
