pub mod agent;
pub mod prompt;
pub mod providers;
pub mod stream;

use crate::crypto::keys::KeyStore;
use crate::gateway::providers::registry::get_provider_config;
use crate::gateway::stream::{encode_client_event, extract_openai_delta};
use crate::tools::WorkspaceManager;
use crate::types::{ClientChatRequest, ClientStreamEvent, ProviderId, TokenUsage};
use async_stream::stream;
use futures::Stream;
use futures_util::StreamExt;
use std::sync::Arc;
use tracing::error;

pub struct BuiltRequest {
    pub url: String,
    pub headers: reqwest::header::HeaderMap,
    pub body: String,
    pub provider_id: ProviderId,
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
    approvals: Arc<crate::gateway::agent::permission::ApprovalRegistry>,
) -> impl Stream<Item = Result<String, axum::Error>> {
    stream! {
        // Agent 模式分流：多步循环由专用运行时承载，本函数只保留纯聊天路径
        if request.agent.as_ref().map(|a| a.enabled).unwrap_or(false) {
            let mut inner = Box::pin(agent::runtime::run_agent_chat_stream(
                client, request, key_store, workspace_manager, approvals,
            ));
            while let Some(item) = inner.next().await {
                yield item;
            }
            return;
        }

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

        let mut byte_stream = upstream_res.bytes_stream();
        let mut buffer = String::new();
        let mut accumulated_usage: Option<TokenUsage> = None;

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
                            yield Ok(encode_client_event(&ClientStreamEvent::Delta { text: content }));
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
