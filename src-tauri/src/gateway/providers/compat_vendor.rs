//! 通过自定义 baseUrl 接入的第三方 OpenAI 兼容厂商。
//!
//! 各家沿用 Chat Completions 外形，但思考开关、思考强度与思维链回传的约定各不相同。
//! 按端点主机名识别厂商，再按模型名套用协议规则；规则须与 Web 端
//! `functions/_shared/providers/compat-vendors.ts` 保持一致。

/// 已适配的第三方厂商
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
    /// 百度千帆（文心）
    Qianfan,
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
    ("moonshot.cn", CompatVendor::Moonshot),
    ("moonshot.ai", CompatVendor::Moonshot),
    ("minimaxi.com", CompatVendor::MiniMax),
    ("minimax.io", CompatVendor::MiniMax),
    ("xiaomimimo.com", CompatVendor::Mimo),
    ("baidubce.com", CompatVendor::Qianfan),
    ("siliconflow.cn", CompatVendor::SiliconFlow),
    ("siliconflow.com", CompatVendor::SiliconFlow),
    ("openrouter.ai", CompatVendor::OpenRouter),
    ("x.ai", CompatVendor::Xai),
];

/// 部署在中国大陆的端点主机：开启全局代理时出海绕行会显著增加延迟，桌面网关对其直连优先
const DOMESTIC_HOSTS: &[&str] = &[
    "volces.com",
    "aliyuncs.com",
    "minimaxi.com",
    "xiaomimimo.com",
    "baidubce.com",
    "tencentmaas.com",
    "tencent.com",
    "ppinfra.com",
    "gitee.com",
];

/// 从 baseUrl 取小写主机名；非法 URL 返回 None
fn endpoint_host(base_url: &str) -> Option<String> {
    let url = reqwest::Url::parse(base_url).ok()?;
    url.host_str().map(|host| host.to_ascii_lowercase())
}

fn host_matches(host: &str, suffix: &str) -> bool {
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

impl CompatVendor {
    pub fn detect(base_url: Option<&str>) -> Option<Self> {
        let host = endpoint_host(base_url?)?;
        VENDOR_HOSTS
            .iter()
            .find(|(suffix, _)| host_matches(&host, suffix))
            .map(|(_, vendor)| *vendor)
    }
}

/// 自定义端点是否位于中国大陆（.cn 域名或已知国内厂商主机）
pub fn is_domestic_endpoint(base_url: &str) -> bool {
    endpoint_host(base_url)
        .map(|host| host.ends_with(".cn") || DOMESTIC_HOSTS.iter().any(|suffix| host_matches(&host, suffix)))
        .unwrap_or(false)
}

/// 请求用途：聊天正文、标题摘要等小预算辅助请求，或 Agent 工具循环
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestPurpose {
    Chat,
    Auxiliary,
    Agent,
}

/// Agent 循环中 assistant 消息回传 reasoning_content 的方式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasoningPassback {
    /// 每条 assistant 消息都携带，客户端重放的历史没有思维链时补空串
    EveryAssistant,
    /// 只回传本运行内非空的原文，不为没有思维链的轮次补写
    NonEmpty,
}

/// 按厂商与模型给出需要并入请求体的字段；未识别的厂商或模型不做任何改动
pub fn body_patch(
    vendor: Option<CompatVendor>,
    model: &str,
    purpose: RequestPurpose,
) -> Vec<(&'static str, serde_json::Value)> {
    use serde_json::json;
    let auxiliary = purpose == RequestPurpose::Auxiliary;
    match vendor {
        // K3 思考常驻且不接受 thinking 字段，只能用 reasoning_effort（low/high/max，默认 max）压低档位；
        // K2.6 不支持 reasoning_effort，辅助请求用 thinking 关闭；K2.7 Code 只接受 keep:all 的 thinking，两者都不发。
        // Agent 沿用模型默认档位，与 Claude、OpenAI Agent 一致
        Some(CompatVendor::Moonshot) if model.starts_with("kimi-k3") && purpose != RequestPurpose::Agent => {
            vec![("reasoning_effort", json!("low"))]
        }
        Some(CompatVendor::Moonshot) if auxiliary && model.starts_with("kimi-k2.6") => {
            vec![("thinking", json!({ "type": "disabled" }))]
        }
        _ => Vec::new(),
    }
}

/// 第三方厂商的思维链回传规则
pub fn reasoning_passback(vendor: Option<CompatVendor>, model: &str) -> Option<ReasoningPassback> {
    match vendor {
        // Kimi 思考模型要求带 tool_calls 的 assistant 历史消息携带 reasoning_content，缺失时返回 400；
        // K3 与 K2.7 Code 常开保留式思考，非工具轮次同样回传
        Some(CompatVendor::Moonshot) if model.starts_with("kimi-k") => Some(ReasoningPassback::EveryAssistant),
        _ => None,
    }
}
