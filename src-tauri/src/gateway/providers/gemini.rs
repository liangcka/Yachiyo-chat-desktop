use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::prompt::build_system_prompt;
use crate::types::{ChatLocale, ChatSource, ClientChatRequest, ClientHistoryMessage, ExtractedDelta, TokenUsage};
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

pub fn build_gemini_contents(
    messages: &[ClientHistoryMessage],
    locale: ChatLocale,
) -> Vec<serde_json::Value> {
    let mut mapped = Vec::new();

    for msg in messages {
        let role = if msg.role == "assistant" {
            "model"
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
                    "parts": [
                        { "text": text },
                        {
                            "inlineData": {
                                "mimeType": mime_type,
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
            "parts": [{ "text": msg.text }]
        }));
    }

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
            let mut last_parts = merged[last_idx]["parts"].as_array().cloned().unwrap_or_default();
            let curr_parts = msg["parts"].as_array().cloned().unwrap_or_default();
            last_parts.extend(curr_parts);
            merged[last_idx]["parts"] = json!(last_parts);
        } else {
            merged.push(msg);
        }
    }

    merged
}

pub fn build_gemini_body(
    request: &ClientChatRequest,
) -> serde_json::Value {
    let use_google_search = request.web_search.unwrap_or(false) && request.mode != Some(crate::types::RequestMode::Summary);
    let system_prompt = build_system_prompt(
        request.locale,
        request.mode,
        request.web_search.unwrap_or(false),
        request.current_time.as_deref(),
    );

    let max_output_tokens = if let Some(crate::types::RequestMode::Summary) = request.mode {
        4096
    } else {
        8192
    };

    let mut body = json!({
        "contents": build_gemini_contents(&request.messages, request.locale),
        "systemInstruction": {
            "parts": [{ "text": system_prompt }]
        },
        "generationConfig": {
            "maxOutputTokens": max_output_tokens,
            "thinkingConfig": { "thinkingLevel": "low" }
        }
    });

    if use_google_search {
        body["tools"] = json!([{ "googleSearch": {} }]);
    }

    body
}

/// Agent 模式请求体：functionDeclarations + functionCall/functionResponse parts
pub fn build_gemini_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let declarations: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            let function = &t["function"];
            json!({
                "name": function["name"],
                "description": function["description"],
                "parameters": function["parameters"],
            })
        })
        .collect();

    let mut contents: Vec<serde_json::Value> = Vec::new();
    for msg in messages {
        match msg {
            AgentMessage::User { text, image_data_url } => {
                let mut parts = vec![json!({ "text": text })];
                if let Some(url) = image_data_url {
                    if let Some((mime_type, base64_data)) = parse_image_data_url(url) {
                        parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": base64_data } }));
                    }
                }
                contents.push(json!({ "role": "user", "parts": parts }));
            }
            AgentMessage::Assistant { text, tool_calls } => {
                let mut parts: Vec<serde_json::Value> = Vec::new();
                if !text.is_empty() {
                    parts.push(json!({ "text": text }));
                }
                for call in tool_calls {
                    parts.push(json!({ "functionCall": { "name": call.name, "args": call.arguments } }));
                }
                if !parts.is_empty() {
                    contents.push(json!({ "role": "model", "parts": parts }));
                }
            }
            AgentMessage::ToolResult { name, content, .. } => {
                contents.push(json!({
                    "role": "user",
                    "parts": [{ "functionResponse": { "name": name, "response": { "result": content } } }]
                }));
            }
        }
    }

    json!({
        "contents": contents,
        "systemInstruction": { "parts": [{ "text": system_prompt }] },
        "tools": [{ "functionDeclarations": declarations }],
        "generationConfig": { "thinkingConfig": { "thinkingLevel": "low" } },
        "model": model
    })
}

pub fn extract_gemini_delta(data: &str) -> Option<ExtractedDelta> {
    if data == "[DONE]" {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;

    let mut delta = ExtractedDelta::default();

    if let Some(usage_meta) = parsed.get("usageMetadata") {
        let p = usage_meta.get("promptTokenCount").and_then(|v| v.as_u64()).map(|v| v as u32);
        let c = usage_meta.get("candidatesTokenCount").and_then(|v| v.as_u64()).map(|v| v as u32);
        let t = usage_meta.get("totalTokenCount").and_then(|v| v.as_u64()).map(|v| v as u32);
        if p.is_some() || c.is_some() || t.is_some() {
            delta.usage = Some(TokenUsage {
                prompt_tokens: p,
                completion_tokens: c,
                total_tokens: t,
            });
        }
    }

    if let Some(candidates) = parsed.get("candidates").and_then(|v| v.as_array()) {
        if let Some(first) = candidates.first() {
            if let Some(parts) = first.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
                let mut content_text = String::new();
                let mut thought_text = String::new();

                for part in parts {
                    let is_thought = part.get("thought").and_then(|v| v.as_bool()).unwrap_or(false);
                    if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                        if !text.is_empty() {
                            if is_thought {
                                thought_text.push_str(text);
                            } else {
                                content_text.push_str(text);
                            }
                        }
                    }
                    if let Some(function_call) = part.get("functionCall") {
                        let name = function_call.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                        if !name.is_empty() {
                            let args = function_call.get("args").cloned().unwrap_or(serde_json::json!({}));
                            delta.tool_calls.push(crate::types::ToolCallStreamDelta::Gemini {
                                call: crate::types::ToolInvocation {
                                    // Gemini 不返回调用 id，由聚合器分配
                                    id: String::new(),
                                    name: name.to_string(),
                                    arguments: args,
                                },
                            });
                        }
                    }
                }

                if !content_text.is_empty() {
                    delta.content = Some(content_text);
                }
                if !thought_text.is_empty() {
                    delta.thought = Some(thought_text);
                }
            }

            // Sources from GroundingMetadata
            let grounding = first.get("groundingMetadata").or_else(|| parsed.get("groundingMetadata"));
            if let Some(grounding_meta) = grounding {
                if let Some(chunks) = grounding_meta.get("groundingChunks").and_then(|v| v.as_array()) {
                    let mut sources = Vec::new();
                    for chunk in chunks {
                        if let Some(web) = chunk.get("web") {
                            if let Some(uri) = web.get("uri").and_then(|v| v.as_str()) {
                                let title = web.get("title").and_then(|v| v.as_str()).unwrap_or(uri);
                                sources.push(ChatSource {
                                    title: title.to_string(),
                                    url: uri.to_string(),
                                });
                            }
                        }
                    }
                    if !sources.is_empty() {
                        delta.sources = Some(sources);
                    }
                }
            }
        }
    }

    if delta.content.is_none() && delta.thought.is_none() && delta.usage.is_none() && delta.sources.is_none() && delta.tool_calls.is_empty() {
        None
    } else {
        Some(delta)
    }
}
