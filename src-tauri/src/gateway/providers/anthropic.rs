use crate::gateway::prompt::build_system_prompt;
use crate::types::{ChatLocale, ClientChatRequest, ClientHistoryMessage, ExtractedDelta, TokenUsage};
use serde_json::json;

fn parse_image_data_url(data_url: &str) -> Option<(&str, &str)> {
    if !data_url.starts_with("data:image/") {
        return None;
    }
    let parts: Vec<&str> = data_url.splitn(2, ";base64,").collect();
    if parts.len() != 2 {
        return None;
    }
    let mime_type = &parts[0]["data:".len()..];
    let base64_data = parts[1];
    Some((mime_type, base64_data))
}

pub fn build_anthropic_messages(
    messages: &[ClientHistoryMessage],
    locale: ChatLocale,
) -> Vec<serde_json::Value> {
    let mut mapped = Vec::new();

    for msg in messages {
        let role = if msg.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        if let Some(image_url) = &msg.image_data_url {
            if let Some((mime_type, base64_data)) = parse_image_data_url(image_url) {
                let default_text = match locale {
                    ChatLocale::JaJp => "この画像を見てください。",
                    ChatLocale::ZhCn => "请看看这张图片。",
                };
                let text = if msg.text.is_empty() {
                    default_text
                } else {
                    &msg.text
                };
                mapped.push(json!({
                    "role": role,
                    "content": [
                        { "type": "text", "text": text },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": base64_data
                            }
                        }
                    ]
                }));
                continue;
            }
        }

        mapped.push(json!({
            "role": role,
            "content": msg.text
        }));
    }

    // Merge consecutive same-role messages
    let mut merged = Vec::new();
    for msg in mapped {
        if merged.is_empty() {
            if msg["role"] != "user" {
                continue;
            }
            merged.push(msg);
            continue;
        }

        let last_idx = merged.len() - 1;
        let last_role = merged[last_idx]["role"].as_str().unwrap_or_default();
        let curr_role = msg["role"].as_str().unwrap_or_default();

        if last_role == curr_role {
            let last_content = &merged[last_idx]["content"];
            let curr_content = &msg["content"];

            if last_content.is_string() && curr_content.is_string() {
                let combined = format!(
                    "{}\n\n{}",
                    last_content.as_str().unwrap_or_default(),
                    curr_content.as_str().unwrap_or_default()
                );
                merged[last_idx]["content"] = json!(combined);
            } else {
                let mut last_blocks = if last_content.is_array() {
                    last_content.as_array().cloned().unwrap_or_default()
                } else {
                    vec![json!({ "type": "text", "text": last_content.as_str().unwrap_or_default() })]
                };
                let curr_blocks = if curr_content.is_array() {
                    curr_content.as_array().cloned().unwrap_or_default()
                } else {
                    vec![json!({ "type": "text", "text": curr_content.as_str().unwrap_or_default() })]
                };
                last_blocks.extend(curr_blocks);
                merged[last_idx]["content"] = json!(last_blocks);
            }
        } else {
            merged.push(msg);
        }
    }

    merged
}

pub fn build_anthropic_body(
    request: &ClientChatRequest,
    model: &str,
) -> serde_json::Value {
    let system_prompt = build_system_prompt(
        request.locale,
        request.mode,
        request.web_search.unwrap_or(false),
        request.current_time.as_deref(),
    );

    let max_tokens = if let Some(crate::types::RequestMode::Summary) = request.mode {
        1024
    } else {
        2048
    };

    json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": build_anthropic_messages(&request.messages, request.locale),
        "stream": true
    })
}

pub fn extract_anthropic_delta(data: &str) -> Option<ExtractedDelta> {
    if data == "[DONE]" {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    let event_type = parsed.get("type").and_then(|v| v.as_str())?;

    let mut delta = ExtractedDelta::default();

    match event_type {
        "message_start" => {
            if let Some(msg) = parsed.get("message") {
                if let Some(usage) = msg.get("usage") {
                    let input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                    if input_tokens.is_some() {
                        delta.usage = Some(TokenUsage {
                            prompt_tokens: input_tokens,
                            completion_tokens: None,
                            total_tokens: None,
                        });
                        return Some(delta);
                    }
                }
            }
            None
        }
        "message_delta" => {
            if let Some(usage) = parsed.get("usage") {
                let output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                if output_tokens.is_some() {
                    delta.usage = Some(TokenUsage {
                        prompt_tokens: None,
                        completion_tokens: output_tokens,
                        total_tokens: None,
                    });
                    return Some(delta);
                }
            }
            None
        }
        "content_block_delta" => {
            if let Some(delta_obj) = parsed.get("delta") {
                let delta_type = delta_obj.get("type").and_then(|v| v.as_str()).unwrap_or("text_delta");
                if delta_type == "thinking_delta" {
                    if let Some(thinking) = delta_obj.get("thinking").and_then(|v| v.as_str()) {
                        if !thinking.is_empty() {
                            delta.thought = Some(thinking.to_string());
                            return Some(delta);
                        }
                    }
                } else if delta_type == "text_delta" {
                    if let Some(text) = delta_obj.get("text").and_then(|v| v.as_str()) {
                        if !text.is_empty() {
                            delta.content = Some(text.to_string());
                            return Some(delta);
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}
