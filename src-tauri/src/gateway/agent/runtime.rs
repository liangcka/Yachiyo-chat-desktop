use crate::crypto::keys::KeyStore;
use crate::gateway::agent::checkpoint::CheckpointStore;
use crate::gateway::providers::compat_vendor::CompatVendor;
use crate::gateway::agent::loop_guard::{
    RepetitionDetector, ToolLoopDetector, ToolLoopVerdict, DONE_REASON_LOOP_DETECTED, REPETITION_LOOP_DETECTED,
    TOOL_LOOP_NUDGE,
};
use crate::gateway::agent::messages::{history_to_agent_messages, AgentMessage};
use crate::gateway::agent::permission::{approval_key, ApprovalRegistry};
use crate::gateway::agent::subagent::{run_subagent, SUBAGENT_TOOL};
use crate::gateway::agent::pruner::{
    prune_agent_messages, DEFAULT_PRUNE_HEAD_CHARS, DEFAULT_PRUNE_TAIL_CHARS,
    DEFAULT_PRUNE_THRESHOLD_CHARS,
};
use crate::gateway::prompt::{build_agent_system_prompt, build_time_note};
use crate::gateway::providers::registry::get_provider_config;
use crate::gateway::stream::{encode_client_event, encode_ping};
use crate::tools::{
    authorize_tool, execute_tool_with_context, preview_tool_output, process_tool_output, tool_risk,
    is_unbound_file_read, FsObservationTracker, ToolAuthorization, ToolRisk, WorkspaceManager,
    PROJECT_REQUIRED_FOR_WRITE,
};
use crate::types::{AgentExecutionMode, ClientChatRequest, ClientStreamEvent, ProviderId, TokenUsage, ToolInvocation};

use async_stream::stream;
use futures::Stream;
use futures_util::StreamExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub type EventSink = Arc<dyn Fn(LoopEmit) + Send + Sync>;

pub enum LoopEmit {
    Event(ClientStreamEvent),
    Ping,
}

#[derive(Debug, Clone)]
pub struct AgentLoopConfig {
    /// 轮次上限；None 表示不限，运行由模型自行结束或循环检测叫停
    pub max_turns: Option<u32>,
    pub permission_timeout_secs: u64,
    pub execution_mode: AgentExecutionMode,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self { max_turns: None, permission_timeout_secs: 300, execution_mode: AgentExecutionMode::Confirm }
    }
}

pub struct TurnOutcome {
    pub text: String,
    /// 本轮思维链原文，随 assistant 消息回传给需要 reasoning replay 的 provider
    pub reasoning: String,
    pub tool_calls: Vec<ToolInvocation>,
    pub usage: Option<TokenUsage>,
    /// 本轮厂商原生输出，随 assistant 消息原样回传（见 `AgentMessage::Assistant::native`）
    pub native: Vec<serde_json::Value>,
}

pub trait TurnExecutor: Send + Sync {
    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>>;

    /// 以独立的系统提示词与工具集派生同一模型通道的执行器，供子 Agent 使用；不支持时返回 None
    fn fork(&self, _system_prompt: String, _tools_schema: Vec<serde_json::Value>) -> Option<Box<dyn TurnExecutor>> {
        None
    }
}

pub enum LoopOutcome {
    Completed { usage: TokenUsage },
    MaxTurnsReached { usage: TokenUsage },
    /// 检测到没有进展的工具循环或输出复读，提前结束
    LoopDetected { usage: TokenUsage },
    Cancelled,
}

fn accumulate_usage(acc: &mut TokenUsage, inc: &Option<TokenUsage>) {
    if let Some(u) = inc {
        acc.prompt_tokens = u.prompt_tokens.or(acc.prompt_tokens);
        if let Some(c) = u.completion_tokens {
            acc.completion_tokens = Some(acc.completion_tokens.unwrap_or(0) + c);
        }
        if let Some(t) = u.total_tokens {
            acc.total_tokens = Some(acc.total_tokens.unwrap_or(0) + t);
        }
    }
}

/// 工具被用户拒绝时回填给模型的说明
const DENIED_TOOL_RESULT: &str = "用户拒绝了本次操作。不要立即重试同一动作；请改用其他方案，或向用户说明需要该操作的理由。";

pub async fn run_agent_loop(
    messages: Vec<AgentMessage>,
    tools_schema: Vec<serde_json::Value>,
    config: AgentLoopConfig,
    executor: &dyn TurnExecutor,
    gate: &ApprovalRegistry,
    checkpoint: &mut Option<CheckpointStore>,
    cancelled: &AtomicBool,
    sink: &EventSink,
    workspace_root: Option<&Path>,
    http_client: &reqwest::Client,
) -> Result<LoopOutcome, String> {
    run_agent_loop_ext(
        messages,
        tools_schema,
        config,
        executor,
        gate,
        checkpoint,
        cancelled,
        sink,
        workspace_root,
        http_client,
        None,
    )
    .await
}

pub async fn run_agent_loop_ext(
    mut messages: Vec<AgentMessage>,
    // 发给模型的 schema 由执行器自带；循环内核只用它为子 Agent 筛选可下放的工具
    tools_schema: Vec<serde_json::Value>,
    config: AgentLoopConfig,
    executor: &dyn TurnExecutor,
    gate: &ApprovalRegistry,
    checkpoint: &mut Option<CheckpointStore>,
    cancelled: &AtomicBool,
    sink: &EventSink,
    workspace_root: Option<&Path>,
    http_client: &reqwest::Client,
    mcp_manager: Option<&Arc<crate::mcp::McpManager>>,
) -> Result<LoopOutcome, String> {
    let mut usage = TokenUsage::default();
    let fs_tracker = FsObservationTracker::new();
    let run_id = checkpoint
        .as_ref()
        .map(|c| c.run_id().to_string())
        .unwrap_or_else(|| format!("no-workspace-{:016x}", rand::random::<u64>()));

    let mut loop_detector = ToolLoopDetector::default();
    let mut turn: u32 = 0;
    loop {
        turn += 1;
        if config.max_turns.is_some_and(|max| turn > max) {
            return Ok(LoopOutcome::MaxTurnsReached { usage });
        }
        let mut turn_checkpoint_created = false;
        if cancelled.load(Ordering::Relaxed) {
            return Ok(LoopOutcome::Cancelled);
        }
        sink(LoopEmit::Event(ClientStreamEvent::Turn { index: turn, usage: None }));

        let pruned_messages = prune_agent_messages(
            &messages,
            DEFAULT_PRUNE_THRESHOLD_CHARS,
            DEFAULT_PRUNE_HEAD_CHARS,
            DEFAULT_PRUNE_TAIL_CHARS,
        );
        let outcome = match executor.execute(&pruned_messages, sink).await {
            Err(error) if error == REPETITION_LOOP_DETECTED => return Ok(LoopOutcome::LoopDetected { usage }),
            other => other?,
        };
        accumulate_usage(&mut usage, &outcome.usage);

        if outcome.tool_calls.is_empty() {
            return Ok(LoopOutcome::Completed { usage });
        }

        messages.push(AgentMessage::Assistant {
            text: outcome.text.clone(),
            reasoning: outcome.reasoning.clone(),
            tool_calls: outcome.tool_calls.clone(),
            native: outcome.native.clone(),
        });

        let mut turn_outputs: Vec<String> = Vec::with_capacity(outcome.tool_calls.len());
        // look 截图：工具结果只回填文字，图片在本轮工具结果之后作为一条带图消息交给模型
        let mut turn_image: Option<String> = None;
        for call in &outcome.tool_calls {
            if cancelled.load(Ordering::Relaxed) { return Ok(LoopOutcome::Cancelled); }
            sink(LoopEmit::Event(ClientStreamEvent::ToolCall {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            }));

            // 无效路径不进入批准等待；执行边界仍会重新校验实际读取的路径。
            let read_path_error = if is_unbound_file_read(&call.name, workspace_root) {
                crate::tools::fs::resolve_unbound_read_path(
                    call.arguments.get("path").and_then(|value| value.as_str()).unwrap_or(".")
                ).err()
            } else {
                None
            };
            let approved = match tool_risk(&call.name) {
                _ if read_path_error.is_some() => false,
                Some(ToolRisk::Read) if !is_unbound_file_read(&call.name, workspace_root) => true,
                None => true,
                Some(ToolRisk::Write) if config.execution_mode == AgentExecutionMode::Readonly => false,
                Some(ToolRisk::Write) if workspace_root.is_none() && matches!(call.name.as_str(), "write_file" | "edit_file") => false,
                _ if config.execution_mode == AgentExecutionMode::FullAuto => true,
                _ => {
                    let key = approval_key(&call.name, &call.arguments, workspace_root)?;
                    if gate.is_allowed(&key) {
                        true
                    } else {
                        let request_id = format!("{}-{}", run_id, call.id);
                        let mut rx = gate.register(&request_id);
                        sink(LoopEmit::Event(ClientStreamEvent::PermissionRequest {
                            request_id: request_id.clone(),
                            tool_name: call.name.clone(),
                            arguments: call.arguments.clone(),
                        }));
                        let deadline = Instant::now() + Duration::from_secs(config.permission_timeout_secs);
                        let mut last_ping = Instant::now();
                        let decision = loop {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                break None;
                            }
                            tokio::select! {
                                decided = &mut rx => break decided.ok(),
                                _ = tokio::time::sleep(remaining) => break None,
                                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                                    if cancelled.load(Ordering::Relaxed) {
                                        gate.cancel(&request_id);
                                        return Ok(LoopOutcome::Cancelled);
                                    }
                                    if last_ping.elapsed() >= Duration::from_secs(5) {
                                        sink(LoopEmit::Ping);
                                        last_ping = Instant::now();
                                    }
                                }
                            }
                        };
                        let approved = decision.as_ref().map(|d| d.approved).unwrap_or(false);
                        gate.cancel(&request_id);
                        sink(LoopEmit::Event(ClientStreamEvent::PermissionResolved {
                            request_id,
                            approved,
                        }));
                        if approved {
                            if let Some(d) = decision {
                                if d.session_scope {
                                    if let Err(error) = gate.remember(key) {
                                        tracing::warn!("长期授权保存失败，本次调用仍按单次批准执行: {}", error);
                                    }
                                }
                            }
                        }
                        approved
                    }
                }
            };

            if cancelled.load(Ordering::Relaxed) { return Ok(LoopOutcome::Cancelled); }

            let started = Instant::now();
            let (output, is_error) = if approved {
                let auth = ToolAuthorization::Agent { mode: config.execution_mode, approved };
                let preparation = authorize_tool(&call.name, auth).and_then(|_| {
                    if tool_risk(&call.name) == Some(ToolRisk::Write) && !turn_checkpoint_created {
                        if let Some(cp) = checkpoint.as_mut() {
                            cp.capture_turn(turn)?;
                        }
                        turn_checkpoint_created = true;
                    }
                    Ok(())
                });
                if let Err(error) = preparation {
                    (error, true)
                } else if call.name == SUBAGENT_TOOL {
                    match run_subagent(
                        &call.arguments, &tools_schema, executor, &config, gate, checkpoint, cancelled, sink,
                        workspace_root, http_client,
                    )
                    .await
                    {
                        Ok((report, sub_usage)) => {
                            accumulate_usage(&mut usage, &Some(sub_usage));
                            (report, false)
                        }
                        Err(error) => (error, true),
                    }
                } else if call.name.starts_with("mcp__") {
                    if let Some(mcp) = mcp_manager {
                        match mcp.execute_tool(&call.name, &call.arguments).await {
                            Ok(out) => {
                                let (text, image) = crate::computer::vision::split_image_output(out);
                                if image.is_some() {
                                    turn_image = image;
                                }
                                (text, false)
                            }
                            Err(err) => (err, true),
                        }
                    } else {
                        ("未配置或不可用的 MCP 管理器".to_string(), true)
                    }
                } else {
                    match execute_tool_with_context(
                        &call.name,
                        &call.arguments,
                        workspace_root,
                        http_client,
                        Some(&fs_tracker),
                        // 授权凭据显式随调用下发：执行边界按 `approved` 独立判定，
                        // 循环内的门禁只用于给出面向模型的拒绝话术
                        auth,
                    )
                    .await
                    {
                        Ok(out) => (out, false),
                        Err(err) => (err, true),
                    }
                }
            } else {
                (if let Some(error) = read_path_error.as_deref() {
                    error
                } else if matches!(call.name.as_str(), "write_file" | "edit_file") && workspace_root.is_none() {
                    PROJECT_REQUIRED_FOR_WRITE
                } else if config.execution_mode == AgentExecutionMode::Readonly && tool_risk(&call.name) == Some(ToolRisk::Write) {
                    "当前为只读模式，该操作不会执行。请用户显式切换执行模式后再操作。"
                } else {
                    DENIED_TOOL_RESULT
                }.to_string(), true)
            };
            let duration_ms = started.elapsed().as_millis() as u64;

            let model_output = if is_error {
                output.clone()
            } else {
                process_tool_output(&call.name, &output, if config.execution_mode == AgentExecutionMode::Readonly { None } else { workspace_root })
            };
            sink(LoopEmit::Event(ClientStreamEvent::ToolResult {
                id: call.id.clone(),
                name: call.name.clone(),
                output: preview_tool_output(&model_output),
                is_error,
                duration_ms,
            }));
            turn_outputs.push(model_output.clone());
            messages.push(AgentMessage::ToolResult {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                content: model_output,
            });
        }

        if let Some(image) = turn_image {
            attach_screenshot(&mut messages, image);
        }

        match loop_detector.record(&outcome.tool_calls, &turn_outputs) {
            ToolLoopVerdict::Progressing => {}
            ToolLoopVerdict::Nudge => {
                // 提醒附在工具结果末尾而不是另起一条用户消息，各家协议的消息交替约束都不受影响
                if let Some(AgentMessage::ToolResult { content, .. }) = messages.last_mut() {
                    content.push_str(TOOL_LOOP_NUDGE);
                }
            }
            ToolLoopVerdict::Stop => return Ok(LoopOutcome::LoopDetected { usage }),
        }
    }
}

pub const SCREENSHOT_MESSAGE: &str = "【系统附图】这是 look 工具刚截取的画面，请据此判断界面状态；需要点击时用图上的像素坐标作为 click 的 image_x / image_y。";
const SCREENSHOT_EXPIRED: &str = "（较早的截图已省略，以最新截图为准）";

/// 追加最新截图；较早截图的图片随后每一轮都会重复计费，只保留最新一张，旧的换成说明文字。
/// 截图消息紧跟工具结果，各家协议都接受（Anthropic 构造请求时会并入同一条用户消息）
pub fn attach_screenshot(messages: &mut Vec<AgentMessage>, image_data_url: String) {
    for message in messages.iter_mut() {
        if let AgentMessage::User { text, image_data_url: image } = message {
            if image.is_some() && text.starts_with(SCREENSHOT_MESSAGE) {
                *image = None;
                text.push_str(SCREENSHOT_EXPIRED);
            }
        }
    }
    messages.push(AgentMessage::User { text: SCREENSHOT_MESSAGE.to_string(), image_data_url: Some(image_data_url) });
}

/// 真实执行器：走上游 HTTP 流式接口，透传 thought/delta/sources 事件
#[derive(Clone)]
pub struct HttpTurnExecutor {
    pub client: reqwest::Client,
    pub fallback_client: Option<reqwest::Client>,
    pub provider_id: ProviderId,
    /// 已校验的自定义 OpenAI 兼容端点；存在时 OpenAI 也改走 Chat Completions
    pub base_url: Option<String>,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub tools_schema: Vec<serde_json::Value>,
}

impl TurnExecutor for HttpTurnExecutor {
    fn fork(&self, system_prompt: String, tools_schema: Vec<serde_json::Value>) -> Option<Box<dyn TurnExecutor>> {
        Some(Box::new(HttpTurnExecutor { system_prompt, tools_schema, ..self.clone() }))
    }

    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let client = self.client.clone();
        let fallback_client = self.fallback_client.clone();
        let provider_id = self.provider_id;
        let base_url = self.base_url.clone();
        let api_key = self.api_key.clone();
        let model = self.model.clone();
        let system_prompt = self.system_prompt.clone();
        let tools_schema = self.tools_schema.clone();
        let messages = messages.to_vec();
        let sink = Arc::clone(sink);
        Box::pin(async move {
            let config = get_provider_config(provider_id);
            let protocol = WireProtocol::resolve(provider_id, base_url.as_deref());

            let (url, body) = match protocol {
                WireProtocol::ChatCompletions => (
                    crate::gateway::providers::openai_compat::resolve_chat_endpoint(base_url.as_deref(), config.endpoint),
                    crate::gateway::providers::openai_compat::build_openai_agent_body(
                        provider_id, base_url.as_deref(), &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
                WireProtocol::Responses => (
                    crate::gateway::providers::openai_responses::OPENAI_RESPONSES_ENDPOINT.to_string(),
                    crate::gateway::providers::openai_responses::build_openai_responses_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
                WireProtocol::Anthropic => (
                    config.endpoint.to_string(),
                    crate::gateway::providers::anthropic::build_anthropic_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
                WireProtocol::Gemini => (
                    format!("{}/models/{}:streamGenerateContent?alt=sse", config.endpoint, model),
                    crate::gateway::providers::gemini::build_gemini_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
            };

            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static("application/json"));
            headers.insert(reqwest::header::ACCEPT, reqwest::header::HeaderValue::from_static("text/event-stream"));
            match provider_id {
                ProviderId::Claude => {
                    headers.insert(reqwest::header::HeaderName::from_static("x-api-key"), reqwest::header::HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);
                    headers.insert(reqwest::header::HeaderName::from_static("anthropic-version"), reqwest::header::HeaderValue::from_static("2023-06-01"));
                    if let Some(beta) = crate::gateway::providers::anthropic::anthropic_beta_header(&model) {
                        headers.insert(reqwest::header::HeaderName::from_static("anthropic-beta"), reqwest::header::HeaderValue::from_static(beta));
                    }
                }
                ProviderId::Gemini => {
                    headers.insert(reqwest::header::HeaderName::from_static("x-goog-api-key"), reqwest::header::HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);
                }
                _ => {
                    let auth_val = format!("Bearer {}", api_key);
                    headers.insert(reqwest::header::AUTHORIZATION, reqwest::header::HeaderValue::from_str(&auth_val).map_err(|e| e.to_string())?);
                }
            }

            let mut attempt: u32 = 0;
            'attempts: loop {
                attempt += 1;
                let can_retry = attempt < UPSTREAM_MAX_ATTEMPTS;
                let first_attempt = client
                    .post(&url)
                    .headers(headers.clone())
                    .body(body.to_string())
                    .send()
                    .await;

                let res = match first_attempt {
                    Ok(res) if res.status().is_success() => Ok(res),
                    Err(err) if fallback_client.is_some() => {
                        tracing::warn!("Agent 主 HTTP 客户端网络错误 ({})，尝试备用客户端重试...", err);
                        let fallback = fallback_client.as_ref().unwrap();
                        fallback.post(&url).headers(headers.clone()).body(body.to_string()).send().await
                    }
                    Ok(res)
                        if fallback_client.is_some()
                            && (res.status().is_server_error()
                                || res.status() == reqwest::StatusCode::FORBIDDEN) =>
                    {
                        tracing::warn!(
                            "Agent 主 HTTP 客户端状态异常 ({})，尝试备用客户端重试...",
                            res.status()
                        );
                        let fallback = fallback_client.as_ref().unwrap();
                        match fallback.post(&url).headers(headers.clone()).body(body.to_string()).send().await {
                            Ok(fb_res) if fb_res.status().is_success() => Ok(fb_res),
                            _ => Ok(res),
                        }
                    }
                    other => other,
                };
                let res = match res {
                    Ok(res) => res,
                    Err(error) if can_retry => {
                        tracing::warn!("Agent 上游网络错误，第 {} 次重试: {}", attempt, error);
                        tokio::time::sleep(upstream_retry_delay(attempt)).await;
                        continue 'attempts;
                    }
                    Err(error) => return Err(format!("上游网络错误: {}", error)),
                };
                if !res.status().is_success() {
                    let status = res.status();
                    if can_retry && is_transient_status(status) {
                        tracing::warn!("Agent 上游暂时不可用 ({})，第 {} 次重试", status, attempt);
                        tokio::time::sleep(upstream_retry_delay(attempt)).await;
                        continue 'attempts;
                    }
                    let text = res.text().await.unwrap_or_default();
                    return Err(format!("上游返回错误 {}: {}", status, text));
                }

                let mut agg = crate::gateway::agent::stream_agg::ToolCallAggregator::new();
                let mut native = NativeTurnCollector::for_protocol(protocol, CompatVendor::resolve(base_url.as_deref(), config.endpoint));
                let mut openai_parser = crate::gateway::stream::OpenAiDeltaParser::default();
                let mut full_text = String::new();
                let mut reasoning = String::new();
                let mut thought_repetition = RepetitionDetector::default();
                let mut text_repetition = RepetitionDetector::default();
                let mut usage: Option<TokenUsage> = None;
                let mut buffer = String::new();
                let mut byte_stream = res.bytes_stream();
                // 已向前端下发过内容就不能再整轮重放，否则界面会出现重复的思考与正文
                let mut emitted = false;

                while let Some(chunk_res) = byte_stream.next().await {
                    let bytes = match chunk_res {
                        Ok(bytes) => bytes,
                        Err(error) if can_retry && !emitted => {
                            tracing::warn!("Agent 上游流在输出前中断，第 {} 次重试: {}", attempt, error);
                            tokio::time::sleep(upstream_retry_delay(attempt)).await;
                            continue 'attempts;
                        }
                        Err(error) => return Err(format!("上游流读取失败: {}", error)),
                    };
                    if let Ok(text) = std::str::from_utf8(&bytes) {
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
                        if data_str.is_empty() || data_str == "[DONE]" {
                            continue;
                        }
                        native.push(&data_str);
                        let delta = match protocol {
                            WireProtocol::ChatCompletions => openai_parser.parse(&data_str),
                            WireProtocol::Responses => crate::gateway::providers::openai_responses::extract_openai_responses_delta(&data_str),
                            WireProtocol::Anthropic => crate::gateway::providers::anthropic::extract_anthropic_delta(&data_str),
                            WireProtocol::Gemini => crate::gateway::providers::gemini::extract_gemini_delta(&data_str),
                        };
                        let Some(delta) = delta else { continue };
                        if let Some(sources) = delta.sources {
                            if !sources.is_empty() {
                                emitted = true;
                                sink(LoopEmit::Event(ClientStreamEvent::Sources { sources }));
                            }
                        }
                        if let Some(u) = delta.usage {
                            usage = Some(u);
                        }
                        if let Some(thought) = delta.thought {
                            if !thought.is_empty() {
                                reasoning.push_str(&thought);
                                let repeating = thought_repetition.push(&thought);
                                emitted = true;
                                sink(LoopEmit::Event(ClientStreamEvent::Thought { text: thought }));
                                // 丢弃响应流即断开上游连接，不再为退化输出继续计费
                                if repeating {
                                    return Err(REPETITION_LOOP_DETECTED.to_string());
                                }
                            }
                        }
                        if let Some(content) = delta.content {
                            if !content.is_empty() {
                                full_text.push_str(&content);
                                let repeating = text_repetition.push(&content);
                                emitted = true;
                                sink(LoopEmit::Event(ClientStreamEvent::Delta { text: content }));
                                if repeating {
                                    return Err(REPETITION_LOOP_DETECTED.to_string());
                                }
                            }
                        }
                        for tc in &delta.tool_calls {
                            agg.push(tc);
                        }
                    }
                }

                let (native, tool_calls) = native.finish(agg)?;
                return Ok(TurnOutcome { text: full_text, reasoning, tool_calls, usage, native });
            }
        })
    }
}

/// Agent 请求的线路协议：OpenAI 官方端点走 Responses，自定义端点与国内厂商走 Chat Completions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireProtocol {
    ChatCompletions,
    Responses,
    Anthropic,
    Gemini,
}

impl WireProtocol {
    pub fn resolve(provider: ProviderId, base_url: Option<&str>) -> Self {
        match provider {
            ProviderId::Claude => Self::Anthropic,
            ProviderId::Gemini => Self::Gemini,
            ProviderId::Openai if base_url.is_none() => Self::Responses,
            ProviderId::Openai | ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm => Self::ChatCompletions,
        }
    }
}

/// 按线路协议收集需要原样回传的原生输出；Chat Completions 无需收集
enum NativeTurnCollector {
    None,
    Anthropic(crate::gateway::providers::anthropic::AnthropicTurnCollector),
    Gemini(crate::gateway::providers::gemini::GeminiTurnCollector),
    Responses(crate::gateway::providers::openai_responses::ResponsesTurnCollector),
    /// 方舟 Seed 2.1 起思考以加密块下发，流里单独一个 chunk 携带整串 encrypted_content
    ArkEncrypted(Option<String>),
}

impl NativeTurnCollector {
    fn for_protocol(protocol: WireProtocol, vendor: Option<CompatVendor>) -> Self {
        if protocol == WireProtocol::ChatCompletions && vendor == Some(CompatVendor::Ark) {
            return Self::ArkEncrypted(None);
        }
        match protocol {
            WireProtocol::Anthropic => Self::Anthropic(Default::default()),
            WireProtocol::Gemini => Self::Gemini(Default::default()),
            WireProtocol::Responses => Self::Responses(Default::default()),
            WireProtocol::ChatCompletions => Self::None,
        }
    }

    fn push(&mut self, data: &str) {
        match self {
            Self::None => {}
            Self::Anthropic(collector) => collector.push(data),
            Self::Gemini(collector) => collector.push(data),
            Self::Responses(collector) => collector.push(data),
            Self::ArkEncrypted(encrypted) => {
                let found = serde_json::from_str::<serde_json::Value>(data).ok().and_then(|chunk| {
                    chunk
                        .pointer("/choices/0/delta/encrypted_content")
                        .and_then(|value| value.as_str())
                        .filter(|text| !text.is_empty())
                        .map(str::to_string)
                });
                if found.is_some() {
                    *encrypted = found;
                }
            }
        }
    }

    /// Anthropic 的工具调用取自已剔除拒答回退边界之前内容的内容块，其余 provider 取流式聚合结果
    fn finish(
        self,
        agg: crate::gateway::agent::stream_agg::ToolCallAggregator,
    ) -> Result<(Vec<serde_json::Value>, Vec<ToolInvocation>), String> {
        match self {
            Self::None => Ok((Vec::new(), agg.finish())),
            Self::Anthropic(collector) => Ok(collector.finish()),
            Self::Gemini(collector) => Ok((collector.finish(), agg.finish())),
            Self::Responses(collector) => Ok((collector.finish()?, agg.finish())),
            Self::ArkEncrypted(encrypted) => Ok((
                encrypted.map(|text| vec![serde_json::json!({ "encrypted_content": text })]).unwrap_or_default(),
                agg.finish(),
            )),
        }
    }
}

/// 单轮上游请求的最多尝试次数；只在尚未向前端输出任何内容时重试，避免界面重复
pub const UPSTREAM_MAX_ATTEMPTS: u32 = 3;

/// 限流、过载与网关类错误通常几秒内恢复，值得原样重发
pub fn is_transient_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 429 | 500 | 502 | 503 | 504 | 529)
}

fn upstream_retry_delay(attempt: u32) -> Duration {
    Duration::from_millis(1_500 * u64::from(attempt))
}

/// 下发心跳的周期，需明显小于客户端的流空闲超时（45 秒）
const HEARTBEAT_PERIOD: Duration = Duration::from_secs(5);

/// 取下一个待下发的事件；周期内没有事件时以 Ping 作为心跳，通道关闭时返回 None
pub async fn next_emit_or_heartbeat(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<LoopEmit>,
    heartbeat: &mut tokio::time::Interval,
) -> Option<LoopEmit> {
    tokio::select! {
        // 已排队的事件优先于心跳，保证事件顺序和及时性
        biased;
        emit = rx.recv() => emit,
        _ = heartbeat.tick() => Some(LoopEmit::Ping),
    }
}

/// Agent 模式的 /api/chat 入口：SSE 流承载完整多轮运行
pub fn run_agent_chat_stream(
    client: reqwest::Client,
    fallback_client: Option<reqwest::Client>,
    request: ClientChatRequest,
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
    approvals: Arc<ApprovalRegistry>,
    mcp_manager: Arc<crate::mcp::McpManager>,
) -> impl Stream<Item = Result<String, axum::Error>> {
    stream! {
        let provider_id = request.provider.unwrap_or(ProviderId::Stepfun);
        let config = get_provider_config(provider_id);
        let model = request.model.clone().unwrap_or_else(|| config.default_model.to_string());

        let api_key = crate::gateway::resolve_api_key(&request, provider_id, &key_store);
        let api_key = match api_key {
            Some(k) if !k.is_empty() => k,
            _ => {
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "SESSION_REQUIRED".to_string() }));
                return;
            }
        };
        let base_url = match crate::gateway::validated_base_url(&request) {
            Ok(base_url) => base_url.map(str::to_string),
            Err(error) => {
                tracing::warn!("Agent 自定义端点无效: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "INVALID_REQUEST".to_string() }));
                return;
            }
        };

        // 取消哨兵：SSE 流 Drop（客户端断开）时置位
        let cancelled = Arc::new(AtomicBool::new(false));
        let _guard = CancelOnDrop(Arc::clone(&cancelled));

        // 若客户端显式传递了当前活跃工作区路径，强行对齐 workspace_manager
        let root = if let Some(ws) = request.agent.as_ref().and_then(|a| a.workspace.as_deref()) {
            let ws_path = std::path::Path::new(ws);
            let requested = ws_path.canonicalize().and_then(|path| if path.is_dir() { Ok(path) } else { Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "工作区不是目录")) });
            let requested = match requested {
                Ok(path) => path,
                Err(error) => {
                tracing::warn!("Agent 工作区无效: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "INVALID_REQUEST".to_string() }));
                return;
                }
            };
            if let Err(error) = workspace_manager.set_workspace_root(requested.clone()) {
                tracing::warn!("Agent 工作区无效: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "INVALID_REQUEST".to_string() }));
                return;
            }
            Some(requested)
        } else { workspace_manager.get_workspace_root() };

        let workspace_lease = match root.as_deref().map(|root| workspace_manager.acquire_shared_workspace(root)).transpose() {
            Ok(lease) => lease,
            Err(error) => {
                tracing::warn!("Agent 工作区忙: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "WORKSPACE_BUSY".to_string() }));
                return;
            }
        };

        let execution_mode = request.agent.as_ref().map(|config| config.execution_mode).unwrap_or_default();
        let vision = request.agent.as_ref().is_some_and(|config| config.vision);
        let web_search = request.web_search.unwrap_or(false);
        let mut tools_schema = crate::tools::get_agent_tools_schema();
        // 联网搜索开关关闭时不下发 web_search，尊重用户的离线选择
        if !web_search {
            tools_schema.retain(|schema| schema.get("function").and_then(|function| function.get("name")).and_then(|name| name.as_str()) != Some("web_search"));
        }
        if execution_mode == AgentExecutionMode::Readonly {
            tools_schema.retain(|schema| schema.get("function").and_then(|function| function.get("name")).and_then(|name| name.as_str())
                .map(|name| tool_risk(name) == Some(ToolRisk::Read)).unwrap_or(false));
        } else {
            let mcp_schema = mcp_manager.get_agent_tools_schema().await;
            let look_tool = format!("{}look", crate::computer::TOOL_PREFIX);
            // 不能接收图片的模型拿到截图会直接报错，只给视觉模型下发 look
            tools_schema.extend(mcp_schema.into_iter().filter(|schema| {
                vision || schema.get("function").and_then(|function| function.get("name")).and_then(|name| name.as_str()) != Some(look_tool.as_str())
            }));
        }

        let desktop_control = tools_schema.iter().any(|schema| {
            schema.get("function").and_then(|function| function.get("name")).and_then(|name| name.as_str())
                .is_some_and(|name| name.starts_with(crate::computer::TOOL_PREFIX))
        });
        let system_prompt = build_agent_system_prompt(request.locale, root.as_deref(), desktop_control, web_search);
        let executor = HttpTurnExecutor {
            client: client.clone(),
            fallback_client,
            provider_id,
            base_url,
            api_key,
            model,
            system_prompt,
            tools_schema,
        };

        let agent_config = request.agent.as_ref()
            .map(|a| AgentLoopConfig { max_turns: a.max_turns, permission_timeout_secs: 300, execution_mode: a.execution_mode })
            .unwrap_or_default();
        let run_id = format!(
            "{}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
            rand::random::<u32>()
        );
        let mut checkpoint = root.as_deref().map(|r| CheckpointStore::new(r, &run_id));

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<LoopEmit>();
        let sink: EventSink = Arc::new(move |emit| { let _ = tx.send(emit); });

        let mut loop_messages = history_to_agent_messages(&request.messages);
        if let Some(current_time) = request.current_time.as_deref() {
            if let Some(AgentMessage::User { text, .. }) = loop_messages.iter_mut().rev().find(|m| matches!(m, AgentMessage::User { .. })) {
                text.insert_str(0, &build_time_note(request.locale, current_time));
            }
        }
        let exec = executor;
        let root_for_task = root.clone();
        let mcp_for_loop = Arc::clone(&mcp_manager);
        let handle = tokio::spawn(async move {
            // 租约归执行任务持有，SSE 断开后也不能提前允许恢复。
            let _workspace_lease = workspace_lease;
            run_agent_loop_ext(
                loop_messages,
                exec.tools_schema.clone(),
                agent_config,
                &exec,
                &approvals,
                &mut checkpoint,
                &cancelled,
                &sink,
                root_for_task.as_deref(),
                &exec.client,
                Some(&mcp_for_loop),
            )
            .await
        });

        // 工具执行与上游长时间思考期间没有事件，定时心跳避免客户端按空闲超时误判断流
        let mut heartbeat = tokio::time::interval_at(tokio::time::Instant::now() + HEARTBEAT_PERIOD, HEARTBEAT_PERIOD);
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        while let Some(emit) = next_emit_or_heartbeat(&mut rx, &mut heartbeat).await {
            match emit {
                LoopEmit::Event(ev) => yield Ok(encode_client_event(&ev)),
                LoopEmit::Ping => yield Ok(encode_ping().to_string()),
            }
        }

        match handle.await {
            Ok(Ok(outcome)) => match outcome {
                LoopOutcome::Completed { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: false, usage: Some(usage), reason: None }));
                }
                LoopOutcome::MaxTurnsReached { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: true, usage: Some(usage), reason: None }));
                }
                LoopOutcome::LoopDetected { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: false, usage: Some(usage), reason: Some(DONE_REASON_LOOP_DETECTED.to_string()) }));
                }
                LoopOutcome::Cancelled => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: true, usage: None, reason: None }));
                }
            },
            Ok(Err(e)) => {
                tracing::error!("Agent loop error: {}", e);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "PROVIDER_STREAM_ERROR".to_string() }));
            }
            Err(e) => {
                tracing::error!("Agent loop task join error: {}", e);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "PROVIDER_STREAM_ERROR".to_string() }));
            }
        }
    }
}

/// Drop 时置位取消标志
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}
