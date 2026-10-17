use crate::crypto::keys::KeyStore;
use crate::gateway::agent::checkpoint::CheckpointStore;
use crate::gateway::agent::messages::{history_to_agent_messages, AgentMessage};
use crate::gateway::agent::permission::{approval_key, ApprovalRegistry};
use crate::gateway::agent::pruner::{
    prune_agent_messages, DEFAULT_PRUNE_HEAD_CHARS, DEFAULT_PRUNE_TAIL_CHARS,
    DEFAULT_PRUNE_THRESHOLD_CHARS,
};
use crate::gateway::prompt::build_agent_system_prompt;
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
    pub max_turns: u32,
    pub permission_timeout_secs: u64,
    pub execution_mode: AgentExecutionMode,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self { max_turns: 12, permission_timeout_secs: 300, execution_mode: AgentExecutionMode::Confirm }
    }
}

pub struct TurnOutcome {
    pub text: String,
    pub tool_calls: Vec<ToolInvocation>,
    pub usage: Option<TokenUsage>,
}

pub trait TurnExecutor: Send + Sync {
    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>>;
}

pub enum LoopOutcome {
    Completed { usage: TokenUsage },
    MaxTurnsReached { usage: TokenUsage },
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
    // 契约要求的保留参数：schema 由执行器自带，循环内核不消费
    _tools_schema: Vec<serde_json::Value>,
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

    for turn in 1..=config.max_turns {
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
        let outcome = executor.execute(&pruned_messages, sink).await?;
        accumulate_usage(&mut usage, &outcome.usage);

        if outcome.tool_calls.is_empty() {
            return Ok(LoopOutcome::Completed { usage });
        }

        messages.push(AgentMessage::Assistant {
            text: outcome.text.clone(),
            tool_calls: outcome.tool_calls.clone(),
        });

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
                Some(ToolRisk::Write) if workspace_root.is_none() && call.name == "write_file" => false,
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
                } else if call.name.starts_with("mcp__") {
                    if let Some(mcp) = mcp_manager {
                        match mcp.execute_tool(&call.name, &call.arguments).await {
                            Ok(out) => (out, false),
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
                } else if call.name == "write_file" && workspace_root.is_none() {
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
            messages.push(AgentMessage::ToolResult {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                content: model_output,
            });
        }
    }
    Ok(LoopOutcome::MaxTurnsReached { usage })
}

/// 真实执行器：走上游 HTTP 流式接口，透传 thought/delta/sources 事件
pub struct HttpTurnExecutor {
    pub client: reqwest::Client,
    pub provider_id: ProviderId,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub tools_schema: Vec<serde_json::Value>,
}

impl TurnExecutor for HttpTurnExecutor {
    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let client = self.client.clone();
        let provider_id = self.provider_id;
        let api_key = self.api_key.clone();
        let model = self.model.clone();
        let system_prompt = self.system_prompt.clone();
        let tools_schema = self.tools_schema.clone();
        let messages = messages.to_vec();
        let sink = Arc::clone(sink);
        Box::pin(async move {
            let config = get_provider_config(provider_id);

            let (url, body) = match provider_id {
                ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => {
                    (
                        config.endpoint.to_string(),
                        crate::gateway::providers::openai_compat::build_openai_agent_body(
                            &model, &messages, &system_prompt, &tools_schema,
                        ),
                    )
                }
                ProviderId::Claude => (
                    config.endpoint.to_string(),
                    crate::gateway::providers::anthropic::build_anthropic_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
                ProviderId::Gemini => (
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
                }
                ProviderId::Gemini => {
                    headers.insert(reqwest::header::HeaderName::from_static("x-goog-api-key"), reqwest::header::HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);
                }
                _ => {
                    let auth_val = format!("Bearer {}", api_key);
                    headers.insert(reqwest::header::AUTHORIZATION, reqwest::header::HeaderValue::from_str(&auth_val).map_err(|e| e.to_string())?);
                }
            }

            let res = client
                .post(&url)
                .headers(headers)
                .body(body.to_string())
                .send()
                .await
                .map_err(|e| format!("上游网络错误: {}", e))?;
            if !res.status().is_success() {
                let status = res.status();
                let text = res.text().await.unwrap_or_default();
                return Err(format!("上游返回错误 {}: {}", status, text));
            }

            let mut agg = crate::gateway::agent::stream_agg::ToolCallAggregator::new();
            let mut full_text = String::new();
            let mut usage: Option<TokenUsage> = None;
            let mut buffer = String::new();
            let mut byte_stream = res.bytes_stream();

            while let Some(chunk_res) = byte_stream.next().await {
                let bytes = chunk_res.map_err(|e| format!("上游流读取失败: {}", e))?;
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
                    let delta = match provider_id {
                        ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => crate::gateway::stream::extract_openai_delta(&data_str),
                        ProviderId::Claude => crate::gateway::providers::anthropic::extract_anthropic_delta(&data_str),
                        ProviderId::Gemini => crate::gateway::providers::gemini::extract_gemini_delta(&data_str),
                    };
                    let Some(delta) = delta else { continue };
                    if let Some(sources) = delta.sources {
                        if !sources.is_empty() {
                            sink(LoopEmit::Event(ClientStreamEvent::Sources { sources }));
                        }
                    }
                    if let Some(u) = delta.usage {
                        usage = Some(u);
                    }
                    if let Some(thought) = delta.thought {
                        if !thought.is_empty() {
                            sink(LoopEmit::Event(ClientStreamEvent::Thought { text: thought }));
                        }
                    }
                    if let Some(content) = delta.content {
                        if !content.is_empty() {
                            full_text.push_str(&content);
                            sink(LoopEmit::Event(ClientStreamEvent::Delta { text: content }));
                        }
                    }
                    for tc in &delta.tool_calls {
                        agg.push(tc);
                    }
                }
            }

            Ok(TurnOutcome { text: full_text, tool_calls: agg.finish(), usage })
        })
    }
}

/// Agent 模式的 /api/chat 入口：SSE 流承载完整多轮运行
pub fn run_agent_chat_stream(
    client: reqwest::Client,
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
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "SESSION_REQUIRED".to_string() }));
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

        let workspace_lease = match root.as_deref().map(|root| workspace_manager.acquire_workspace(root)).transpose() {
            Ok(lease) => lease,
            Err(error) => {
                tracing::warn!("Agent 工作区忙: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "WORKSPACE_BUSY".to_string() }));
                return;
            }
        };

        let execution_mode = request.agent.as_ref().map(|config| config.execution_mode).unwrap_or_default();
        let mut tools_schema = crate::tools::get_agent_tools_schema();
        if execution_mode == AgentExecutionMode::Readonly {
            tools_schema.retain(|schema| schema.get("function").and_then(|function| function.get("name")).and_then(|name| name.as_str())
                .map(|name| tool_risk(name) == Some(ToolRisk::Read)).unwrap_or(false));
        } else {
            let mcp_schema = mcp_manager.get_agent_tools_schema().await;
            tools_schema.extend(mcp_schema);
        }

        let system_prompt = build_agent_system_prompt(request.locale, request.current_time.as_deref(), root.as_deref());
        let executor = HttpTurnExecutor {
            client: client.clone(),
            provider_id,
            api_key,
            model,
            system_prompt,
            tools_schema,
        };

        let agent_config = request.agent.as_ref()
            .map(|a| AgentLoopConfig { max_turns: a.max_turns.unwrap_or(12), permission_timeout_secs: 300, execution_mode: a.execution_mode })
            .unwrap_or_default();
        let run_id = format!(
            "{}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
            rand::random::<u32>()
        );
        let mut checkpoint = root.as_deref().map(|r| CheckpointStore::new(r, &run_id));

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<LoopEmit>();
        let sink: EventSink = Arc::new(move |emit| { let _ = tx.send(emit); });

        let loop_messages = history_to_agent_messages(&request.messages);
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

        while let Some(emit) = rx.recv().await {
            match emit {
                LoopEmit::Event(ev) => yield Ok(encode_client_event(&ev)),
                LoopEmit::Ping => yield Ok(encode_ping().to_string()),
            }
        }

        match handle.await {
            Ok(Ok(outcome)) => match outcome {
                LoopOutcome::Completed { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: false, usage: Some(usage) }));
                }
                LoopOutcome::MaxTurnsReached { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: true, usage: Some(usage) }));
                }
                LoopOutcome::Cancelled => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: true, usage: None }));
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
