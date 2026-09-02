use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::prompt::build_system_prompt;
use crate::gateway::providers::registry::ProviderConfig;
use crate::types::ClientChatRequest;
use serde_json::json;

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
    _config: &ProviderConfig,
) -> serde_json::Value {
    let messages = build_openai_messages(request);
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true }
    });

    if let Some(crate::types::RequestMode::Summary) = request.mode {
        body["max_tokens"] = json!(1024);
    }

    body
}

/// Agent 模式请求体：messages 含 assistant tool_calls 与 role:"tool" 结果回填
pub fn build_openai_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
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
            AgentMessage::Assistant { text, tool_calls } => {
                if tool_calls.is_empty() {
                    if !text.is_empty() {
                        out.push(json!({ "role": "assistant", "content": text }));
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
                out.push(json!({
                    "role": "assistant",
                    "content": if text.is_empty() { serde_json::Value::Null } else { json!(text) },
                    "tool_calls": calls
                }));
            }
            AgentMessage::ToolResult { tool_call_id, content, .. } => {
                out.push(json!({ "role": "tool", "tool_call_id": tool_call_id, "content": content }));
            }
        }
    }
    json!({
        "model": model,
        "messages": out,
        "tools": tools,
        "tool_choice": "auto",
        "stream": true,
        "stream_options": { "include_usage": true }
    })
}
