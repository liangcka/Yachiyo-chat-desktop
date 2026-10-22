pub mod agent;
pub mod prompt;
pub mod providers;
pub mod stream;

use crate::crypto::keys::KeyStore;
use crate::gateway::providers::registry::get_provider_config;
use crate::gateway::stream::{encode_client_event, OpenAiDeltaParser, SseDecoder};
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

/// 请求自带的 Key 优先；否则取系统加密存储里的 Key，并要求请求的端点与保存时绑定的端点一致
pub fn resolve_api_key(request: &ClientChatRequest, provider_id: ProviderId, key_store: &KeyStore) -> Option<String> {
    request
        .api_key
        .clone()
        .or_else(|| key_store.get_key_for_endpoint(provider_id.slug(), request.base_url.as_deref()))
}

/// 自定义端点只对 OpenAI 兼容厂商开放（Claude/Gemini 为原生协议），与 Web 端 /api/chat 的校验一致
pub fn validated_base_url(request: &ClientChatRequest) -> Result<Option<&str>, String> {
    let Some(base_url) = request.base_url.as_deref() else {
        return Ok(None);
    };
    if !providers::openai_compat::is_valid_base_url(base_url) {
        return Err("自定义端点需为 https:// 开头且不含空白".to_string());
    }
    if matches!(request.provider, Some(ProviderId::Claude | ProviderId::Gemini)) {
        return Err("自定义端点仅支持 OpenAI 兼容协议".to_string());
    }
    Ok(Some(base_url))
}

pub fn build_upstream_request(
    request: &ClientChatRequest,
    api_key: &str,
    model: &str,
) -> Result<BuiltRequest, String> {
    let provider_id = request.provider.unwrap_or(ProviderId::Stepfun);
    let config = get_provider_config(provider_id);
    let base_url = validated_base_url(request)?;

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
            (providers::openai_compat::resolve_chat_endpoint(base_url, config.endpoint), body)
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
            if let Some(beta) = providers::anthropic::anthropic_beta_header(model) {
                headers.insert(
                    reqwest::header::HeaderName::from_static("anthropic-beta"),
                    reqwest::header::HeaderValue::from_static(beta),
                );
            }
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
    fallback_client: Option<reqwest::Client>,
    request: ClientChatRequest,
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
    approvals: Arc<crate::gateway::agent::permission::ApprovalRegistry>,
    mcp_manager: Arc<crate::mcp::McpManager>,
) -> impl Stream<Item = Result<String, axum::Error>> {
    stream! {
        // Agent 模式分流：多步循环由专用运行时承载，本函数只保留纯聊天路径
        if request.agent.as_ref().map(|a| a.enabled).unwrap_or(false) {
            let mut inner = Box::pin(agent::runtime::run_agent_chat_stream(
                client, fallback_client, request, key_store, workspace_manager, approvals, mcp_manager,
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

        let api_key = resolve_api_key(&request, provider_id, &key_store);

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

        let first_attempt = client
            .post(&built_req.url)
            .headers(built_req.headers.clone())
            .body(built_req.body.clone())
            .send()
            .await;

        let upstream_res = match first_attempt {
            Ok(res) if res.status().is_success() => res,
            Err(err) if fallback_client.is_some() => {
                tracing::warn!("主 HTTP 客户端上游请求网络错误 ({})，尝试备用客户端重试...", err);
                let fallback = fallback_client.as_ref().unwrap();
                match fallback
                    .post(&built_req.url)
                    .headers(built_req.headers)
                    .body(built_req.body)
                    .send()
                    .await
                {
                    Ok(res) => res,
                    Err(fallback_err) => {
                        error!("备用 HTTP 客户端上游网络错误: {}", fallback_err);
                        yield Ok(encode_client_event(&ClientStreamEvent::Error {
                            code: "PROVIDER_STREAM_ERROR".to_string(),
                        }));
                        return;
                    }
                }
            }
            Ok(res)
                if fallback_client.is_some()
                    && (res.status().is_server_error()
                        || res.status() == reqwest::StatusCode::FORBIDDEN) =>
            {
                tracing::warn!(
                    "主 HTTP 客户端返回异常状态码 ({})，尝试备用客户端重试...",
                    res.status()
                );
                let fallback = fallback_client.as_ref().unwrap();
                match fallback
                    .post(&built_req.url)
                    .headers(built_req.headers)
                    .body(built_req.body)
                    .send()
                    .await
                {
                    Ok(fb_res) if fb_res.status().is_success() => fb_res,
                    _ => res,
                }
            }
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

        let is_title_mode = request.mode == Some(crate::types::RequestMode::Title);
        let mut accumulated_chars: usize = 0;
        let mut byte_stream = upstream_res.bytes_stream();
        let mut sse = SseDecoder::default();
        let mut accumulated_usage: Option<TokenUsage> = None;
        let mut openai_parser = OpenAiDeltaParser::default();

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

            for data_str in sse.push(&chunk) {
                if data_str == "[DONE]" {
                    break;
                }

                let delta = match provider_id {
                    ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => {
                        openai_parser.parse(&data_str)
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
                            accumulated_chars += content.chars().count();
                            yield Ok(encode_client_event(&ClientStreamEvent::Delta { text: content }));
                            if is_title_mode && accumulated_chars >= 50 {
                                yield Ok(encode_client_event(&ClientStreamEvent::Done {
                                    truncated: true,
                                    usage: accumulated_usage,
                                    reason: None,
                                }));
                                return;
                            }
                        }
                    }
                }
            }
        }

        yield Ok(encode_client_event(&ClientStreamEvent::Done {
            truncated: false,
            usage: accumulated_usage,
            reason: None,
        }));
    }
}
