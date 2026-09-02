pub mod prompt;
pub mod providers;
pub mod stream;

use crate::crypto::keys::KeyStore;
use crate::gateway::providers::registry::get_provider_config;
use crate::gateway::stream::{encode_client_event, extract_openai_delta};
use crate::tools::{self, WorkspaceManager};
use crate::types::{ClientChatRequest, ClientHistoryMessage, ClientStreamEvent, ProviderId, TokenUsage};
use async_stream::stream;
use futures::Stream;
use futures_util::StreamExt;
use std::sync::Arc;
use tracing::{error, info};

pub struct BuiltRequest {
    pub url: String,
    pub headers: reqwest::header::HeaderMap,
    pub body: String,
    pub provider_id: ProviderId,
}

pub fn parse_tool_call(text: &str) -> Option<(String, serde_json::Value)> {
    let trimmed = text.trim();

    // 1. Check code block: ```tool_call ... ``` or ```tool ... ```
    if let Some(start) = trimmed.find("```tool_call") {
        let content = &trimmed[start + 12..];
        if let Some(end) = content.find("```") {
            let json_str = content[..end].trim();
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(name) = val.get("name").or_else(|| val.get("tool")).and_then(|v| v.as_str()) {
                    let args = val.get("arguments").or_else(|| val.get("args")).cloned().unwrap_or(serde_json::json!({}));
                    return Some((name.to_string(), args));
                }
            }
        }
    }

    if let Some(start) = trimmed.find("```tool") {
        let content = &trimmed[start + 7..];
        if let Some(end) = content.find("```") {
            let json_str = content[..end].trim();
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(name) = val.get("name").or_else(|| val.get("tool")).and_then(|v| v.as_str()) {
                    let args = val.get("arguments").or_else(|| val.get("args")).cloned().unwrap_or(serde_json::json!({}));
                    return Some((name.to_string(), args));
                }
            }
        }
    }

    // 2. Check XML tag format: <tool_call> or <ollama:name> or <function_calls>
    if trimmed.contains("<ollama:name>") || trimmed.contains("<tool_call>") || trimmed.contains("<function_calls>") {
        let mut tool_name = None;
        if let Some(start) = trimmed.find("<ollama:name>") {
            let rest = &trimmed[start + 13..];
            if let Some(end) = rest.find("</ollama:name>") {
                tool_name = Some(rest[..end].trim().to_string());
            }
        } else if let Some(start) = trimmed.find("<name>") {
            let rest = &trimmed[start + 6..];
            if let Some(end) = rest.find("</name>") {
                tool_name = Some(rest[..end].trim().to_string());
            }
        }

        if let Some(name) = tool_name {
            let mut args = serde_json::json!({});
            if let Some(start) = trimmed.find("<path>") {
                let rest = &trimmed[start + 6..];
                if let Some(end) = rest.find("</path>") {
                    args["path"] = serde_json::json!(rest[..end].trim());
                }
            }
            if let Some(start) = trimmed.find("<command>") {
                let rest = &trimmed[start + 9..];
                if let Some(end) = rest.find("</command>") {
                    args["command"] = serde_json::json!(rest[..end].trim());
                }
            }
            if let Some(start) = trimmed.find("<content>") {
                let rest = &trimmed[start + 9..];
                if let Some(end) = rest.find("</content>") {
                    args["content"] = serde_json::json!(rest[..end].trim());
                }
            }
            if let Some(start) = trimmed.find("<url>") {
                let rest = &trimmed[start + 5..];
                if let Some(end) = rest.find("</url>") {
                    args["url"] = serde_json::json!(rest[..end].trim());
                }
            }
            return Some((name, args));
        }
    }

    // 3. Raw JSON object
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(name) = val.get("name").or_else(|| val.get("tool")).and_then(|v| v.as_str()) {
                let args = val.get("arguments").or_else(|| val.get("args")).cloned().unwrap_or(serde_json::json!({}));
                return Some((name.to_string(), args));
            }
        }
    }

    None
}

pub fn build_upstream_request(
    request: &ClientChatRequest,
    api_key: &str,
    model: &str,
) -> Result<BuiltRequest, String> {
    let provider_id = request.provider.unwrap_or(ProviderId::Stepfun);
    let config = get_provider_config(provider_id);

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("text/event-stream"),
    );

    let (url, body_json) = match provider_id {
        ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => {
            let auth_val = format!("Bearer {}", api_key);
            headers.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&auth_val)
                    .map_err(|e| e.to_string())?,
            );
            let body = providers::openai_compat::build_openai_compat_body(request, model, config);
            (config.endpoint.to_string(), body)
        }
        ProviderId::Claude => {
            headers.insert(
                reqwest::header::HeaderName::from_static("x-api-key"),
                reqwest::header::HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
            );
            headers.insert(
                reqwest::header::HeaderName::from_static("anthropic-version"),
                reqwest::header::HeaderValue::from_static("2023-06-01"),
            );
            let body = providers::anthropic::build_anthropic_body(request, model);
            (config.endpoint.to_string(), body)
        }
        ProviderId::Gemini => {
            headers.insert(
                reqwest::header::HeaderName::from_static("x-goog-api-key"),
                reqwest::header::HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
            );
            let url = format!(
                "{}/models/{}:streamGenerateContent?alt=sse",
                config.endpoint, model
            );
            let body = providers::gemini::build_gemini_body(request);
            (url, body)
        }
    };

    Ok(BuiltRequest {
        url,
        headers,
        body: body_json.to_string(),
        provider_id,
    })
}

pub fn handle_chat_stream(
    client: reqwest::Client,
    request: ClientChatRequest,
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
) -> impl Stream<Item = Result<String, axum::Error>> {
    stream! {
        let provider_id = request.provider.unwrap_or(ProviderId::Stepfun);
        let config = get_provider_config(provider_id);
        let model = request
            .model
            .clone()
            .unwrap_or_else(|| config.default_model.to_string());

        let api_key = request.api_key.clone().or_else(|| {
            let provider_name = match provider_id {
                ProviderId::Stepfun => "stepfun",
                ProviderId::Deepseek => "deepseek",
                ProviderId::Glm => "glm",
                ProviderId::Openai => "openai",
                ProviderId::Claude => "claude",
                ProviderId::Gemini => "gemini",
            };
            key_store.get_key(provider_name)
        });

        let api_key = match api_key {
            Some(k) if !k.is_empty() => k,
            _ => {
                yield Ok(encode_client_event(&ClientStreamEvent::Error {
                    code: "SESSION_REQUIRED".to_string(),
                }));
                return;
            }
        };

        let built_req = match build_upstream_request(&request, &api_key, &model) {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to build upstream request: {}", e);
                yield Ok(encode_client_event(&ClientStreamEvent::Error {
                    code: "INVALID_REQUEST".to_string(),
                }));
                return;
            }
        };

        let upstream_res = match client
            .post(&built_req.url)
            .headers(built_req.headers)
            .body(built_req.body)
            .send()
            .await
        {
            Ok(res) => res,
            Err(err) => {
                error!("Upstream network error: {}", err);
                yield Ok(encode_client_event(&ClientStreamEvent::Error {
                    code: "PROVIDER_STREAM_ERROR".to_string(),
                }));
                return;
            }
        };

        if !upstream_res.status().is_success() {
            let status = upstream_res.status();
            let err_text = upstream_res.text().await.unwrap_or_default();
            error!("Upstream returned error status {}: {}", status, err_text);
            yield Ok(encode_client_event(&ClientStreamEvent::Error {
                code: "PROVIDER_STREAM_ERROR".to_string(),
            }));
            return;
        }

        let max_characters: usize = if request.web_search.unwrap_or(false) {
            1000
        } else {
            2000
        };

        let mut byte_stream = upstream_res.bytes_stream();
        let mut buffer = String::new();
        let mut emitted_chars = 0;
        let mut accumulated_usage: Option<TokenUsage> = None;
        let mut full_accumulated_text = String::new();

        while let Some(chunk_res) = byte_stream.next().await {
            let chunk = match chunk_res {
                Ok(bytes) => bytes,
                Err(err) => {
                    error!("Error reading upstream chunk: {}", err);
                    yield Ok(encode_client_event(&ClientStreamEvent::Error {
                        code: "PROVIDER_STREAM_ERROR".to_string(),
                    }));
                    return;
                }
            };

            if let Ok(text) = std::str::from_utf8(&chunk) {
                buffer.push_str(text);
            }

            while let Some(pos) = buffer.find("\n\n") {
                let record = buffer[..pos].to_string();
                buffer = buffer[pos + 2..].to_string();

                let mut data_str = String::new();
                for line in record.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("data:") {
                        let content = trimmed[5..].trim_start();
                        if !data_str.is_empty() {
                            data_str.push('\n');
                        }
                        data_str.push_str(content);
                    }
                }

                if data_str.is_empty() {
                    continue;
                }

                if data_str == "[DONE]" {
                    break;
                }

                let delta = match provider_id {
                    ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => {
                        extract_openai_delta(&data_str)
                    }
                    ProviderId::Claude => {
                        providers::anthropic::extract_anthropic_delta(&data_str)
                    }
                    ProviderId::Gemini => {
                        providers::gemini::extract_gemini_delta(&data_str)
                    }
                };

                if let Some(delta) = delta {
                    if let Some(sources) = delta.sources {
                        if !sources.is_empty() {
                            yield Ok(encode_client_event(&ClientStreamEvent::Sources { sources }));
                        }
                    }

                    if let Some(usage) = delta.usage {
                        let mut acc = accumulated_usage.unwrap_or_default();
                        if let Some(p) = usage.prompt_tokens {
                            acc.prompt_tokens = Some(p);
                        }
                        if let Some(c) = usage.completion_tokens {
                            acc.completion_tokens = Some(c);
                        }
                        if let Some(t) = usage.total_tokens {
                            acc.total_tokens = Some(t);
                        }
                        accumulated_usage = Some(acc);
                    }

                    if let Some(thought) = delta.thought {
                        if !thought.is_empty() {
                            yield Ok(encode_client_event(&ClientStreamEvent::Thought { text: thought }));
                        }
                    }

                    if let Some(content) = delta.content {
                        if !content.is_empty() {
                            full_accumulated_text.push_str(&content);
                            let content_chars: Vec<char> = content.chars().collect();
                            let remaining = max_characters.saturating_sub(emitted_chars);

                            if remaining > 0 {
                                if content_chars.len() <= remaining {
                                    emitted_chars += content_chars.len();
                                    yield Ok(encode_client_event(&ClientStreamEvent::Delta { text: content }));
                                } else {
                                    let prefix: String = content_chars[..remaining].iter().collect();
                                    yield Ok(encode_client_event(&ClientStreamEvent::Delta { text: prefix }));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check if the model generated a tool call
        if let Some((tool_name, args)) = parse_tool_call(&full_accumulated_text) {
            info!("Agent Tool Call detected: {} with args: {:?}", tool_name, args);
            let root = workspace_manager.get_workspace_root();
            let (output, is_error) = match tools::execute_tool(&tool_name, &args, &root, &client).await {
                Ok(out) => (out, false),
                Err(err) => (err, true),
            };

            // Stream ToolCard block to client
            let tool_card_md = format!(
                "\n```tool\n{}\n```\n\n",
                serde_json::json!({
                    "name": tool_name,
                    "arguments": args,
                    "output": output,
                    "isError": is_error
                })
            );
            yield Ok(encode_client_event(&ClientStreamEvent::Delta { text: tool_card_md }));

            // Trigger 2nd turn to synthesize final friendly answer with tool results
            let mut second_turn_req = request.clone();
            second_turn_req.messages.push(ClientHistoryMessage {
                role: "assistant".to_string(),
                text: full_accumulated_text.clone(),
                image_data_url: None,
                tool_calls: None,
                tool_call_id: None,
                tool_name: None,
            });
            second_turn_req.messages.push(ClientHistoryMessage {
                role: "user".to_string(),
                text: format!("【系统执行工具 {} 结果如下】：\n{}\n\n请结合以上执行结果，用八千代生动可爱的语气向彩叶汇报并给出详细解答。", tool_name, output),
                image_data_url: None,
                tool_calls: None,
                tool_call_id: None,
                tool_name: None,
            });

            if let Ok(second_built_req) = build_upstream_request(&second_turn_req, &api_key, &model) {
                if let Ok(second_res) = client
                    .post(&second_built_req.url)
                    .headers(second_built_req.headers)
                    .body(second_built_req.body)
                    .send()
                    .await
                {
                    if second_res.status().is_success() {
                        let mut second_byte_stream = second_res.bytes_stream();
                        let mut second_buf = String::new();

                        while let Some(chunk_res) = second_byte_stream.next().await {
                            if let Ok(bytes) = chunk_res {
                                if let Ok(text) = std::str::from_utf8(&bytes) {
                                    second_buf.push_str(text);
                                }
                                while let Some(pos) = second_buf.find("\n\n") {
                                    let record = second_buf[..pos].to_string();
                                    second_buf = second_buf[pos + 2..].to_string();

                                    let mut data_str = String::new();
                                    for line in record.lines() {
                                        let trimmed = line.trim();
                                        if trimmed.starts_with("data:") {
                                            let content = trimmed[5..].trim_start();
                                            if !data_str.is_empty() {
                                                data_str.push('\n');
                                            }
                                            data_str.push_str(content);
                                        }
                                    }

                                    if data_str == "[DONE]" {
                                        break;
                                    }

                                    let delta = match provider_id {
                                        ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => {
                                            extract_openai_delta(&data_str)
                                        }
                                        ProviderId::Claude => {
                                            providers::anthropic::extract_anthropic_delta(&data_str)
                                        }
                                        ProviderId::Gemini => {
                                            providers::gemini::extract_gemini_delta(&data_str)
                                        }
                                    };

                                    if let Some(delta) = delta {
                                        if let Some(content) = delta.content {
                                            if !content.is_empty() {
                                                yield Ok(encode_client_event(&ClientStreamEvent::Delta { text: content }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        yield Ok(encode_client_event(&ClientStreamEvent::Done {
            truncated: false,
            usage: accumulated_usage,
        }));
    }
}
