use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::prompt::build_system_prompt;
use crate::gateway::providers::registry::ProviderConfig;
use crate::types::{ClientChatRequest, ProviderId, RequestMode};
use serde_json::json;

/// DeepSeek Agent 单次请求输出预算（对齐 DSH llm-deepseek 默认 maxTokens）：
/// 思考 token 计入 max_tokens，不能依赖服务端默认上限，否则长文件写入或深度推理会被截断
pub const DEEPSEEK_AGENT_MAX_TOKENS: u32 = 256_000;

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

    if let Some(RequestMode::Summary) = request.mode {
        body["max_tokens"] = json!(1024);
    } else if let Some(RequestMode::Title) = request.mode {
        body["max_tokens"] = json!(512);
    }

    // 标题与摘要的输出预算很小，DeepSeek 默认开启的思考会先耗尽预算导致正文为空，
    // 辅助请求一律关闭思考（对齐 DSH 辅助调用的 thinking.disabled）
    if config.id == ProviderId::Deepseek
        && matches!(request.mode, Some(RequestMode::Summary | RequestMode::Title))
    {
        body["thinking"] = json!({ "type": "disabled" });
    }

    body
}

/// Agent 模式请求体：messages 含 assistant tool_calls 与 role:"tool" 结果回填
pub fn build_openai_agent_body(
    provider: ProviderId,
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    // DeepSeek 思考模式要求 assistant 消息回传 reasoning_content，工具轮次缺失会被上游 400 拒绝；
    // 客户端重放的历史不含思维链时回传空串（对齐 DSH reasoning passback 与 pi-ai 的 DeepSeek 兼容规则）
    let deepseek = provider == ProviderId::Deepseek;
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
            AgentMessage::Assistant { text, reasoning, tool_calls } => {
                if tool_calls.is_empty() {
                    if !text.is_empty() {
                        let mut message = json!({ "role": "assistant", "content": text });
                        if deepseek {
                            message["reasoning_content"] = json!(reasoning);
                        }
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
                if deepseek {
                    message["reasoning_content"] = json!(reasoning);
                }
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
    body
}
