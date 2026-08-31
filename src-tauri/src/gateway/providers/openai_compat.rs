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
