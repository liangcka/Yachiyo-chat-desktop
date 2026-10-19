use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::prompt::build_system_prompt;
use crate::gateway::providers::compat_vendor::{self, CompatVendor, ReasoningPassback, RequestPurpose};
use crate::gateway::providers::registry::{get_provider_config, ProviderConfig};
use crate::types::{ClientChatRequest, ProviderId, RequestMode};
use serde_json::json;

/// DeepSeek Agent 单次请求输出预算（对齐 DSH llm-deepseek 默认 maxTokens）：
/// 思考 token 计入 max_tokens，不能依赖服务端默认上限，否则长文件写入或深度推理会被截断
pub const DEEPSEEK_AGENT_MAX_TOKENS: u32 = 256_000;

/// GPT-5/GPT-6 系列为推理模型（接受 reasoning_effort）；gpt-4.1 等非推理模型传该字段会被拒绝
pub fn is_openai_reasoning_model(model: &str) -> bool {
    model.starts_with("gpt-5") || model.starts_with("gpt-6")
}

/// 自定义端点校验，与 Web 端 validation 一致：https 起始、无空白、不超过 2048 字符
pub fn is_valid_base_url(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 2048
        && value.starts_with("https://")
        && !value.chars().any(char::is_whitespace)
}

/// 端点解析，与 Web 端 resolveEndpoint 一致：自定义 baseUrl 剥掉尾部斜杠后拼 /chat/completions
pub fn resolve_chat_endpoint(base_url: Option<&str>, default_endpoint: &str) -> String {
    match base_url {
        Some(base) => format!("{}/chat/completions", base.trim_end_matches('/')),
        None => default_endpoint.to_string(),
    }
}

pub fn build_openai_messages(
    request: &ClientChatRequest,
) -> Vec<serde_json::Value> {
    let system_prompt = build_system_prompt(
        request.locale,
        request.mode,
        request.web_search.unwrap_or(false),
        request.current_time.as_deref(),
    );

    let mut messages = Vec::new();
    messages.push(json!({
        "role": "system",
        "content": system_prompt
    }));

    for msg in &request.messages {
        if let Some(image_url) = &msg.image_data_url {
            let default_text = match request.locale {
                crate::types::ChatLocale::JaJp => "この画像を見てください。",
                crate::types::ChatLocale::ZhCn => "请看看这张图片。",
            };
            let text = if msg.text.is_empty() {
                default_text
            } else {
                &msg.text
            };
            messages.push(json!({
                "role": msg.role,
                "content": [
                    { "type": "text", "text": text },
                    { "type": "image_url", "image_url": { "url": image_url } }
                ]
            }));
        } else {
            messages.push(json!({
                "role": msg.role,
                "content": msg.text
            }));
        }
    }

    messages
}

pub fn build_openai_compat_body(
    request: &ClientChatRequest,
    model: &str,
    config: &ProviderConfig,
) -> serde_json::Value {
    let messages = build_openai_messages(request);
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true }
    });

    // OpenAI 推理模型拒绝 max_tokens，官方端点统一改用 max_completion_tokens；第三方兼容网关不一定认该字段与
    // reasoning_effort，官方规则只在未自定义 baseUrl 时生效。思考 token 计入输出预算，摘要预算与 Web 端对齐
    let openai_official = config.id == ProviderId::Openai && request.base_url.is_none();
    let max_tokens_field = if openai_official { "max_completion_tokens" } else { "max_tokens" };
    if let Some(RequestMode::Summary) = request.mode {
        body[max_tokens_field] = json!(4096);
    } else if let Some(RequestMode::Title) = request.mode {
        body[max_tokens_field] = json!(512);
    }

    let reasoning_effort = match config.id {
        ProviderId::Stepfun => true,
        ProviderId::Openai => openai_official && is_openai_reasoning_model(model),
        _ => false,
    };
    if reasoning_effort {
        let contains_image = request.messages.iter().any(|msg| msg.image_data_url.is_some());
        body["reasoning_effort"] = json!(if contains_image { "medium" } else { "low" });
    }

    // 标题与摘要的输出预算很小，DeepSeek 默认开启的思考会先耗尽预算导致正文为空，
    // 辅助请求一律关闭思考（对齐 DSH 辅助调用的 thinking.disabled）
    let auxiliary = matches!(request.mode, Some(RequestMode::Summary | RequestMode::Title));
    if config.id == ProviderId::Deepseek && auxiliary {
        body["thinking"] = json!({ "type": "disabled" });
    }

    let purpose = if auxiliary { RequestPurpose::Auxiliary } else { RequestPurpose::Chat };
    let vendor = CompatVendor::resolve(request.base_url.as_deref(), config.endpoint);
    for (field, value) in compat_vendor::body_patch(vendor, model, purpose) {
        body[field] = value;
    }

    body
}

/// Agent 模式请求体：messages 含 assistant tool_calls 与 role:"tool" 结果回填
pub fn build_openai_agent_body(
    provider: ProviderId,
    base_url: Option<&str>,
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let deepseek = provider == ProviderId::Deepseek;
    let vendor = CompatVendor::resolve(base_url, get_provider_config(provider).endpoint);
    let passback = if deepseek {
        // DeepSeek 思考模式要求 assistant 消息回传 reasoning_content，工具轮次缺失会被上游 400 拒绝；
        // 客户端重放的历史不含思维链时回传空串（对齐 DSH reasoning passback 与 pi-ai 的 DeepSeek 兼容规则）
        Some(ReasoningPassback::EveryAssistant)
    } else {
        compat_vendor::reasoning_passback(vendor, model)
    };
    let reasoning_field = |message: &mut serde_json::Value, reasoning: &str| match passback {
        Some(ReasoningPassback::EveryAssistant) => message["reasoning_content"] = json!(reasoning),
        Some(ReasoningPassback::NonEmpty) if !reasoning.is_empty() => message["reasoning_content"] = json!(reasoning),
        Some(ReasoningPassback::MiniMaxDetails) if !reasoning.is_empty() => {
            message["reasoning_details"] = json!([{
                "type": "reasoning.text",
                "id": "reasoning-text-1",
                "format": "MiniMax-response-v1",
                "index": 0,
                "text": reasoning
            }]);
        }
        _ => {}
    };
    let mut out = vec![json!({ "role": "system", "content": system_prompt })];
    for msg in messages {
        match msg {
            AgentMessage::User { text, image_data_url } => {
                if let Some(url) = image_data_url {
                    out.push(json!({
                        "role": "user",
                        "content": [
                            { "type": "text", "text": text },
                            { "type": "image_url", "image_url": { "url": url } }
                        ]
                    }));
                } else {
                    out.push(json!({ "role": "user", "content": text }));
                }
            }
            AgentMessage::Assistant { text, reasoning, tool_calls, .. } => {
                if tool_calls.is_empty() {
                    if !text.is_empty() {
                        let mut message = json!({ "role": "assistant", "content": text });
                        reasoning_field(&mut message, reasoning);
                        out.push(message);
                    }
                    continue;
                }
                let calls: Vec<serde_json::Value> = tool_calls
                    .iter()
                    .map(|c| {
                        json!({
                            "id": c.id,
                            "type": "function",
                            "function": { "name": c.name, "arguments": c.arguments.to_string() }
                        })
                    })
                    .collect();
                let mut message = json!({
                    "role": "assistant",
                    "content": if text.is_empty() { serde_json::Value::Null } else { json!(text) },
                    "tool_calls": calls
                });
                reasoning_field(&mut message, reasoning);
                out.push(message);
            }
            AgentMessage::ToolResult { tool_call_id, content, .. } => {
                out.push(json!({ "role": "tool", "tool_call_id": tool_call_id, "content": content }));
            }
        }
    }

    // 防御性契约：OpenAI 兼容接口要求请求体最后一条不能是 assistant 角色，避免上游 400 拒绝
    if let Some(last) = out.last() {
        if last.get("role").and_then(|r| r.as_str()) == Some("assistant") {
            out.push(json!({ "role": "user", "content": "请接续上文继续完成任务。" }));
        }
    }

    let mut body = json!({
        "model": model,
        "messages": out,
        "tools": tools,
        "tool_choice": "auto",
        "stream": true,
        "stream_options": { "include_usage": true }
    });
    if deepseek {
        body["max_tokens"] = json!(DEEPSEEK_AGENT_MAX_TOKENS);
    }
    for (field, value) in compat_vendor::body_patch(vendor, model, RequestPurpose::Agent) {
        body[field] = value;
    }
    body
}
