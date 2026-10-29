use crate::crypto::keys::KeyStore;
use crate::gateway::agent::changes::{changed_paths, fingerprint, read_before_write, tool_target, ChangeLedger, Fingerprint};
use crate::gateway::agent::checkpoint::CheckpointStore;
use crate::gateway::providers::compat_vendor::CompatVendor;
use crate::gateway::agent::loop_guard::{
    RepetitionDetector, ToolLoopDetector, ToolLoopVerdict, DONE_REASON_LOOP_DETECTED, REPETITION_LOOP_DETECTED,
    TOOL_LOOP_NUDGE,
};
use crate::gateway::agent::messages::{history_to_agent_messages, AgentMessage};
use crate::gateway::agent::permission::{approval_key, ApprovalRegistry};
use crate::gateway::agent::context_budget::{compact_to_budget, estimate_messages, estimate_tokens, ContextBudget, RunProgress};
use crate::gateway::agent::delivery_check::{DeliveryCheck, DeliveryReminder};
use crate::gateway::agent::run_records::RunEndStatus;
use crate::gateway::agent::run_registry::{
    approval_request_id, generate_run_id, RunInfo, RunRegistry, RunStatus, Supplement, SupplementQueue,
};
use crate::tools::process::{clamp_timeout, execute_command, format_for_model, CommandControl, CommandOutcome, OutputStream, ProcessTable};
use crate::gateway::agent::subagent::{run_subagent, SUBAGENT_TOOL};
use crate::gateway::agent::pruner::{
    compact_agent_messages, DEFAULT_PRUNE_HEAD_CHARS, DEFAULT_PRUNE_TAIL_CHARS,
    DEFAULT_PRUNE_THRESHOLD_CHARS,
};
use crate::gateway::prompt::{build_agent_system_prompt, build_time_note};
use crate::gateway::providers::registry::get_provider_config;
use crate::gateway::stream::encode_client_event;
use crate::tools::{
    authorize_tool, execute_tool_with_context, preview_command_output, preview_tool_output, process_tool_output, tool_risk,
    is_unbound_file_read, FsObservationTracker, ToolAuthorization, ToolRisk, WorkspaceManager,
    PROJECT_REQUIRED_FOR_WRITE,
};
use crate::types::{
    ChatLocale,
    AgentExecutionMode, ClientChatRequest, ClientStreamEvent, PendingOperation, PermissionOutcome, ProviderId, TokenUsage,
    ToolInvocation, UnknownOperation,
};

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
    /// 运行编号：审批编号以它为前缀，只对所属运行有效；缺省时取检查点的运行编号
    pub run_id: Option<String>,
    /// 运行内的受管命令表，供查询与单独停止；缺省时命令不登记
    pub processes: Option<Arc<ProcessTable>>,
    /// 工作区写入锁：同一项目中的运行轮流执行有副作用的工具
    pub workspace_lock: Option<Arc<tokio::sync::Mutex<()>>>,
    /// 运行改动账本：记录本次运行改动的文件与改动前后的版本
    pub ledger: Option<Arc<std::sync::Mutex<ChangeLedger>>>,
    /// 用户在运行中追加的要求；每次调用模型前送达，缺省时不接受补充
    pub supplements: Option<Arc<SupplementQueue>>,
    /// 本次运行消息的上下文预算；超出时折叠较早的轮次，缺省时不做预算
    pub context_budget: Option<ContextBudget>,
    /// 交付前执行反馈的语言
    pub locale: ChatLocale,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_turns: None,
            permission_timeout_secs: 300,
            execution_mode: AgentExecutionMode::Confirm,
            run_id: None,
            processes: None,
            workspace_lock: None,
            ledger: None,
            supplements: None,
            context_budget: None,
            locale: ChatLocale::ZhCn,
        }
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
    /// 某一轮输出因输出 token 预算耗尽被截断，提前结束并如实告知，而不是当作正常完成
    Truncated { usage: TokenUsage },
    /// 已取消；unknown 为收尾期间未能确认结果的外部操作
    Cancelled { unknown: Vec<UnknownOperation> },
    /// 折叠到不能再折叠，消息仍超出模型窗口：如实停止，不让上游报错或静默截断
    ContextOverflow { usage: TokenUsage },
}

fn accumulate_usage(acc: &mut TokenUsage, inc: &Option<TokenUsage>) {
    if let Some(u) = inc {
        // 提示词与缓存都反映最近一轮请求的上下文，三者一起取自同一轮，命中率才可比
        if u.prompt_tokens.is_some() {
            acc.prompt_tokens = u.prompt_tokens;
            acc.cache_read_tokens = u.cache_read_tokens;
            acc.cache_write_tokens = u.cache_write_tokens;
        }
        if let Some(c) = u.completion_tokens {
            acc.completion_tokens = Some(acc.completion_tokens.unwrap_or(0) + c);
        }
        if let Some(t) = u.total_tokens {
            acc.total_tokens = Some(acc.total_tokens.unwrap_or(0) + t);
        }
    }
}

/// 执行器在本轮输出被输出预算截断时返回的错误标记，循环据此以“已截断”结束
pub const OUTPUT_TRUNCATED: &str = "agent-output-truncated";

/// 所选思考档位被上游拒绝、已去掉强度字段重发时下发的提示码（与前端 chat-client 的契约）
pub const NOTICE_REASONING_EFFORT_REJECTED: &str = "REASONING_EFFORT_REJECTED";

/// 取消标志的轮询周期：足够及时地断开上游，又不至于空转占用 CPU
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(200);

async fn wait_cancelled(cancelled: &AtomicBool) {
    while !cancelled.load(Ordering::Relaxed) {
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
    }
}

/// 工具被用户拒绝时回填给模型的说明
const DENIED_TOOL_RESULT: &str = "用户拒绝了本次操作。不要立即重试同一动作；请改用其他方案，或向用户说明需要该操作的理由。";

/// 取消后等待 MCP 调用返回的时长：外部副作用无法撤回，超时后只能如实标记结果未知
const MCP_CANCEL_GRACE: Duration = Duration::from_secs(10);

fn cancelled_outcome() -> Result<LoopOutcome, String> {
    Ok(LoopOutcome::Cancelled { unknown: Vec::new() })
}

/// 获取工作区写入锁；需要等待时告知界面在等哪个工具，等待期间被取消则返回 None
async fn acquire_write_lock(
    lock: &Arc<tokio::sync::Mutex<()>>,
    cancelled: &AtomicBool,
    sink: &EventSink,
    run_id: &str,
    call: &ToolInvocation,
) -> Option<tokio::sync::OwnedMutexGuard<()>> {
    if let Ok(guard) = Arc::clone(lock).try_lock_owned() {
        return Some(guard);
    }
    sink(LoopEmit::Event(ClientStreamEvent::RunStatus {
        run_id: run_id.to_string(),
        status: RunStatus::WaitingForWorkspace,
        pending: vec![PendingOperation {
            call_id: call.id.clone(),
            name: call.name.clone(),
            detail: "等待同一项目中的其他任务完成写入".to_string(),
        }],
    }));
    let guard = tokio::select! {
        guard = Arc::clone(lock).lock_owned() => Some(guard),
        _ = wait_cancelled(cancelled) => None,
    };
    if guard.is_some() {
        sink(LoopEmit::Event(ClientStreamEvent::RunStatus { run_id: run_id.to_string(), status: RunStatus::Running, pending: Vec::new() }));
    }
    guard
}

/// 执行前为改动账本准备的信息：文件工具记录写前内容，其余工具记录文件指纹
enum ChangeProbe {
    FileTool { target: String, baseline: Result<Option<Vec<u8>>, String> },
    Observed(Result<Fingerprint, String>),
}

fn probe_changes(root: &Path, call: &ToolInvocation) -> ChangeProbe {
    if matches!(call.name.as_str(), "write_file" | "edit_file") {
        if let Some(target) = tool_target(root, &call.arguments) {
            let baseline = read_before_write(root, &target);
            return ChangeProbe::FileTool { target, baseline };
        }
    }
    ChangeProbe::Observed(fingerprint(root))
}

/// 工具执行后把改动写入账本；失败时返回原因，由调用方附在工具结果里而不是静默丢弃
fn record_changes(
    ledger: &std::sync::Mutex<ChangeLedger>,
    root: &Path,
    call: &ToolInvocation,
    probe: ChangeProbe,
    failed: bool,
    checkpoint: Option<&CheckpointStore>,
) -> Result<(), String> {
    let mut ledger = ledger.lock().map_err(|_| "改动账本不可用".to_string())?;
    match probe {
        ChangeProbe::FileTool { target, baseline } => {
            if failed {
                return Ok(());
            }
            ledger.record_file_tool(&target, baseline?.as_deref(), &call.id)
        }
        ChangeProbe::Observed(before) => {
            let changed = changed_paths(&before?, &fingerprint(root)?);
            if changed.is_empty() {
                return Ok(());
            }
            let turn_checkpoint = checkpoint.and_then(|store| store.entries().last().map(|entry| (store, entry.id.as_str())));
            ledger.record_observed(&changed, turn_checkpoint, &call.id)
        }
    }
}

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
    let run_id = config
        .run_id
        .clone()
        .or_else(|| checkpoint.as_ref().map(|c| c.run_id().to_string()))
        .unwrap_or_else(generate_run_id);

    let mut loop_detector = ToolLoopDetector::default();
    // 本次运行从最后一条用户消息开始；之前的对话历史由客户端按自己的预算裁剪
    let run_start = messages.iter().rposition(|message| matches!(message, AgentMessage::User { .. })).unwrap_or(0);
    let goal = match messages.get(run_start) {
        Some(AgentMessage::User { text, .. }) => text.clone(),
        _ => String::new(),
    };
    let mut progress = RunProgress::default();
    let mut delivery = DeliveryCheck::default();
    let mut turn: u32 = 0;
    loop {
        turn += 1;
        if config.max_turns.is_some_and(|max| turn > max) {
            return Ok(LoopOutcome::MaxTurnsReached { usage });
        }
        let mut turn_checkpoint_created = false;
        if cancelled.load(Ordering::Relaxed) {
            return cancelled_outcome();
        }
        if let Some(queue) = config.supplements.as_deref() {
            deliver_supplements(&mut messages, queue.drain(), &run_id, sink, &mut progress);
        }
        if let Some(budget) = config.context_budget {
            let measure = |candidate: &[AgentMessage]| {
                let mut sent = candidate.to_vec();
                compact_agent_messages(&mut sent, DEFAULT_PRUNE_THRESHOLD_CHARS, DEFAULT_PRUNE_HEAD_CHARS, DEFAULT_PRUNE_TAIL_CHARS);
                estimate_messages(&sent)
            };
            match compact_to_budget(&mut messages, run_start, &goal, &mut progress, budget, measure) {
                Ok(Some(compaction)) => sink(LoopEmit::Event(ClientStreamEvent::RunNote {
                    kind: RUN_NOTE_CONTEXT_COMPACTED.to_string(),
                    detail: serde_json::json!({
                        "foldedTurns": compaction.folded_turns,
                        "totalFoldedTurns": progress.folded_turns(),
                        "beforeTokens": compaction.before_tokens,
                        "afterTokens": compaction.after_tokens,
                        "budgetTokens": budget.input_tokens,
                    }),
                })),
                Ok(None) => {}
                Err(overflow) => {
                    sink(LoopEmit::Event(ClientStreamEvent::RunNote {
                        kind: RUN_NOTE_CONTEXT_OVERFLOW.to_string(),
                        detail: serde_json::json!({ "tokens": overflow.tokens, "budgetTokens": overflow.budget }),
                    }));
                    return Ok(LoopOutcome::ContextOverflow { usage });
                }
            }
        }
        sink(LoopEmit::Event(ClientStreamEvent::Turn { index: turn, usage: None }));

        let folded = compact_agent_messages(
            &mut messages,
            DEFAULT_PRUNE_THRESHOLD_CHARS,
            DEFAULT_PRUNE_HEAD_CHARS,
            DEFAULT_PRUNE_TAIL_CHARS,
        );
        if folded > 0 {
            tracing::info!(turn, folded, "上下文越过高水位，已折叠早期只读工具结果");
        }
        // 用户停止时丢弃进行中的上游请求 Future 即断开 HTTP 连接，厂商随之停止生成与计费，
        // 而不是等这一轮（可能是长时间思考或数万 token 的输出）完整跑完
        let outcome = tokio::select! {
            outcome = executor.execute(&messages, sink) => outcome,
            _ = wait_cancelled(cancelled) => return cancelled_outcome(),
        };
        let outcome = match outcome {
            Err(error) if error == REPETITION_LOOP_DETECTED => return Ok(LoopOutcome::LoopDetected { usage }),
            Err(error) if error == OUTPUT_TRUNCATED => return Ok(LoopOutcome::Truncated { usage }),
            other => other?,
        };
        accumulate_usage(&mut usage, &outcome.usage);
        if let Some(turn_usage) = &outcome.usage {
            tracing::info!(
                turn,
                prompt_tokens = ?turn_usage.prompt_tokens,
                cache_read_tokens = ?turn_usage.cache_read_tokens,
                cache_write_tokens = ?turn_usage.cache_write_tokens,
                "Agent 轮次用量"
            );
        }

        if outcome.tool_calls.is_empty() {
            // 交付前检查执行记录：修改了代码却没验证，或最近一次验证失败，提醒一次后继续
            if let Some(reminder) = delivery.before_finish() {
                sink(LoopEmit::Event(ClientStreamEvent::RunNote {
                    kind: RUN_NOTE_VERIFICATION_REMINDER.to_string(),
                    detail: match &reminder {
                        DeliveryReminder::NotVerified { files } => serde_json::json!({ "reason": reminder.kind(), "files": files }),
                        DeliveryReminder::VerificationFailed { command } => serde_json::json!({ "reason": reminder.kind(), "command": command }),
                    },
                }));
                messages.push(AgentMessage::Assistant {
                    text: outcome.text.clone(),
                    reasoning: outcome.reasoning.clone(),
                    tool_calls: Vec::new(),
                    native: outcome.native.clone(),
                });
                messages.push(AgentMessage::User { text: reminder.message(config.locale == ChatLocale::JaJp), image_data_url: None });
                continue;
            }
            // 模型给出最终回复时仍有未送达的补充要求：保留这轮回复，带着补充继续下一轮
            if config.supplements.as_deref().is_none_or(SupplementQueue::close_if_empty) {
                return Ok(LoopOutcome::Completed { usage });
            }
            messages.push(AgentMessage::Assistant {
                text: outcome.text.clone(),
                reasoning: outcome.reasoning.clone(),
                tool_calls: Vec::new(),
                native: outcome.native.clone(),
            });
            continue;
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
        let spill_root = if config.execution_mode == AgentExecutionMode::Readonly { None } else { workspace_root };
        let mut record_result = |call: &ToolInvocation, output: String, is_error: bool, duration_ms: u64, command: Option<&CommandOutcome>| {
            // 失败命令的输出同样可能很长，统一按上限落盘，避免撑爆上下文
            let model_output = process_tool_output(&call.name, &output, spill_root);
            sink(LoopEmit::Event(ClientStreamEvent::ToolResult {
                id: call.id.clone(),
                name: call.name.clone(),
                output: if command.is_some() { preview_command_output(&model_output) } else { preview_tool_output(&model_output) },
                is_error,
                duration_ms,
                command: command.and_then(|outcome| serde_json::to_value(outcome).ok()),
            }));
            progress.record_result(&call.id, is_error, &model_output);
            delivery.observe(call, is_error, command);
            turn_outputs.push(model_output.clone());
            messages.push(AgentMessage::ToolResult {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                content: model_output,
            });
        };
        let calls = &outcome.tool_calls;
        let mut index = 0;
        while index < calls.len() {
            if cancelled.load(Ordering::Relaxed) { return cancelled_outcome(); }
            // 连续的免审批只读调用互不依赖，整段并发执行，结果仍按调用顺序回填
            let concurrent = calls[index..].iter().take_while(|call| runs_concurrently(&call.name, workspace_root)).count();
            if concurrent > 1 {
                let batch = &calls[index..index + concurrent];
                index += concurrent;
                for call in batch {
                    sink(LoopEmit::Event(ClientStreamEvent::ToolCall {
                        id: call.id.clone(),
                        name: call.name.clone(),
                        arguments: call.arguments.clone(),
                    }));
                }
                let auth = ToolAuthorization::Agent { mode: config.execution_mode, approved: true };
                // 只读调用没有副作用，取消时直接放弃等待
                let results = tokio::select! {
                    results = execute_concurrently(batch, workspace_root, http_client, &fs_tracker, auth) => results,
                    _ = wait_cancelled(cancelled) => return cancelled_outcome(),
                };
                for (call, (output, is_error, duration_ms)) in batch.iter().zip(results) {
                    record_result(call, output, is_error, duration_ms, None);
                }
                continue;
            }
            let call = &calls[index];
            index += 1;
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
            let mut approval_timed_out = false;
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
                        let request_id = approval_request_id(&run_id, &call.id);
                        let mut rx = gate.register(&request_id);
                        sink(LoopEmit::Event(ClientStreamEvent::PermissionRequest {
                            request_id: request_id.clone(),
                            tool_name: call.name.clone(),
                            arguments: call.arguments.clone(),
                            call_id: call.id.clone(),
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
                                        return cancelled_outcome();
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
                        // 审批期间运行被取消：即使批准与取消几乎同时到达，也不执行
                        if cancelled.load(Ordering::Relaxed) {
                            return cancelled_outcome();
                        }
                        let reason = match decision {
                            None => PermissionOutcome::Timeout,
                            Some(d) if d.approved => PermissionOutcome::Approved,
                            Some(_) => PermissionOutcome::Denied,
                        };
                        if reason == PermissionOutcome::Timeout {
                            approval_timed_out = true;
                        }
                        sink(LoopEmit::Event(ClientStreamEvent::PermissionResolved {
                            request_id,
                            approved,
                            reason,
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

            if cancelled.load(Ordering::Relaxed) { return cancelled_outcome(); }

            let started = Instant::now();
            let mut command_outcome: Option<CommandOutcome> = None;
            // 有副作用的工具在工作区写入锁内执行：检查点、写前基线、执行与改动记录在同一窗口内完成，
            // 同一项目中的其他运行不会在窗口内写入，命令观察到的改动因此只属于本次调用
            let side_effect = approved && tool_risk(&call.name) == Some(ToolRisk::Write) && workspace_root.is_some();
            let _write_guard = match (side_effect, config.workspace_lock.as_ref()) {
                (true, Some(lock)) => match acquire_write_lock(lock, cancelled, sink, &run_id, call).await {
                    Some(guard) => Some(guard),
                    None => return cancelled_outcome(),
                },
                _ => None,
            };
            let tracking = config.ledger.as_ref().zip(workspace_root).filter(|_| side_effect);
            let probe = tracking.map(|(_, root)| probe_changes(root, call));
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
                        // MCP 调用的外部副作用无法撤回：取消时不直接丢弃，给它一段收尾时间，
                        // 仍未返回才放弃等待并如实标记结果未知
                        let call_future = mcp.execute_tool(&call.name, &call.arguments);
                        tokio::pin!(call_future);
                        let finished = tokio::select! {
                            result = &mut call_future => Some(result),
                            _ = wait_cancelled(cancelled) => {
                                sink(LoopEmit::Event(ClientStreamEvent::RunStatus {
                                    run_id: run_id.clone(),
                                    status: RunStatus::Cancelling,
                                    pending: vec![PendingOperation {
                                        call_id: call.id.clone(),
                                        name: call.name.clone(),
                                        detail: format!("等待 MCP 工具返回（最多 {} 秒）", MCP_CANCEL_GRACE.as_secs()),
                                    }],
                                }));
                                tokio::time::timeout(MCP_CANCEL_GRACE, &mut call_future).await.ok()
                            }
                        };
                        match finished {
                            Some(Ok(out)) => {
                                let (text, image) = crate::computer::vision::split_image_output(out);
                                if image.is_some() {
                                    turn_image = image;
                                }
                                (text, false)
                            }
                            Some(Err(err)) => (err, true),
                            None => {
                                let detail = format!("取消后 {} 秒内未返回，外部操作是否完成未知", MCP_CANCEL_GRACE.as_secs());
                                record_result(call, format!("已取消：MCP 工具{detail}。"), true, started.elapsed().as_millis() as u64, None);
                                return Ok(LoopOutcome::Cancelled {
                                    unknown: vec![UnknownOperation { call_id: call.id.clone(), name: call.name.clone(), detail }],
                                });
                            }
                        }
                    } else {
                        ("未配置或不可用的 MCP 管理器".to_string(), true)
                    }
                } else if call.name == "run_command" {
                    match call.arguments.get("command").and_then(|v| v.as_str()) {
                        None => ("Missing 'command' argument".to_string(), true),
                        Some(command) => {
                            let timeout = clamp_timeout(call.arguments.get("timeout_secs").and_then(|v| v.as_u64()));
                            let fallback_cwd;
                            let cwd = match workspace_root {
                                Some(root) => root,
                                None => {
                                    fallback_cwd = crate::tools::get_fallback_cwd();
                                    fallback_cwd.as_path()
                                }
                            };
                            let call_id = call.id.clone();
                            let output_sink = Arc::clone(sink);
                            let observer = move |stream: OutputStream, text: &str| {
                                output_sink(LoopEmit::Event(ClientStreamEvent::ToolOutput { id: call_id.clone(), stream, text: text.to_string() }));
                            };
                            // 取消在命令内部处理：终止整棵进程树并确认退出后才返回，不丢弃仍在运行的进程
                            let outcome = execute_command(command, cwd, timeout, CommandControl {
                                cancelled: Some(cancelled),
                                processes: config.processes.as_deref(),
                                call_id: Some(&call.id),
                                observer: Some(&observer),
                                log_root: spill_root,
                            })
                            .await;
                            let text = format_for_model(&outcome, Some(timeout));
                            let failed = !outcome.succeeded();
                            command_outcome = Some(outcome);
                            (text, failed)
                        }
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
                    error.to_string()
                } else if matches!(call.name.as_str(), "write_file" | "edit_file") && workspace_root.is_none() {
                    PROJECT_REQUIRED_FOR_WRITE.to_string()
                } else if config.execution_mode == AgentExecutionMode::Readonly && tool_risk(&call.name) == Some(ToolRisk::Write) {
                    "当前为只读模式，该操作不会执行。请用户显式切换执行模式后再操作。".to_string()
                } else if approval_timed_out {
                    format!("审批等待超时（{} 秒内没有回应），本次操作未执行。需要时请向用户说明理由后重新申请。", config.permission_timeout_secs)
                } else {
                    DENIED_TOOL_RESULT.to_string()
                }, true)
            };
            let output = match (tracking, probe) {
                (Some((ledger, root)), Some(probe)) => match record_changes(ledger, root, call, probe, is_error, checkpoint.as_ref()) {
                    Ok(()) => output,
                    Err(error) => format!("{output}\n[改动跟踪失败：{error}。任务审阅中可能缺少本次改动。]"),
                },
                _ => output,
            };
            record_result(call, output, is_error, started.elapsed().as_millis() as u64, command_outcome.as_ref());
            // 命令在取消时已终止并记录结果，随后结束运行
            if cancelled.load(Ordering::Relaxed) {
                return cancelled_outcome();
            }
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

/// 把补充要求交给模型：接在最后一条工具结果或用户消息之后，不另起一条用户消息，
/// 各家协议的消息交替约束都不受影响；上一条是助手回复时才新增用户消息
fn deliver_supplements(messages: &mut Vec<AgentMessage>, supplements: Vec<Supplement>, run_id: &str, sink: &EventSink, progress: &mut RunProgress) {
    if supplements.is_empty() {
        return;
    }
    // 补充要求属于约束：上下文折叠时写进运行进展摘要，不会随较早的轮次丢失
    for item in &supplements {
        progress.record_constraint(&item.text);
    }
    let body = supplements.iter().map(|item| item.text.trim()).collect::<Vec<_>>().join("\n\n");
    let note = format!("\n\n[用户在任务进行中补充的要求]\n{body}");
    match messages.last_mut() {
        Some(AgentMessage::ToolResult { content, .. }) => content.push_str(&note),
        Some(AgentMessage::User { text, .. }) => text.push_str(&note),
        _ => messages.push(AgentMessage::User { text: note.trim_start().to_string(), image_data_url: None }),
    }
    sink(LoopEmit::Event(ClientStreamEvent::SupplementDelivered {
        run_id: run_id.to_string(),
        ids: supplements.into_iter().map(|item| item.id).collect(),
    }));
}

/// 同一轮里可以并发执行的工具：无副作用、无需审批，也不依赖本轮其他调用的结果。
/// 子 Agent 会占用检查点并可能发起审批，仍逐个执行
fn runs_concurrently(name: &str, workspace_root: Option<&Path>) -> bool {
    tool_risk(name) == Some(ToolRisk::Read) && name != SUBAGENT_TOOL && !is_unbound_file_read(name, workspace_root)
}

/// 并发执行一段只读工具调用，按调用顺序返回（输出，是否出错，耗时毫秒）。
/// 文件读取与检索是同步阻塞 IO，放进阻塞线程池才能真正并行，也不会占住异步工作线程
async fn execute_concurrently(
    calls: &[ToolInvocation],
    workspace_root: Option<&Path>,
    http_client: &reqwest::Client,
    fs_tracker: &FsObservationTracker,
    auth: ToolAuthorization,
) -> Vec<(String, bool, u64)> {
    let runtime = tokio::runtime::Handle::current();
    let tasks = calls.iter().map(|call| {
        let (runtime, name, arguments) = (runtime.clone(), call.name.clone(), call.arguments.clone());
        let (root, client, tracker) = (workspace_root.map(Path::to_path_buf), http_client.clone(), fs_tracker.clone());
        tokio::task::spawn_blocking(move || {
            let started = Instant::now();
            let result = runtime.block_on(execute_tool_with_context(
                &name, &arguments, root.as_deref(), &client, Some(&tracker), auth,
            ));
            (result, started.elapsed().as_millis() as u64)
        })
    });
    futures::future::join_all(tasks)
        .await
        .into_iter()
        .map(|joined| match joined {
            Ok((Ok(output), duration_ms)) => (output, false, duration_ms),
            Ok((Err(error), duration_ms)) => (error, true, duration_ms),
            Err(error) => (format!("工具执行异常: {}", error), true, 0),
        })
        .collect()
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
    /// 用户所选思考档位的原生取值；None 时沿用各厂商的默认规则
    pub reasoning_effort: Option<&'static str>,
    /// 上游拒绝过该档位后置位，本次运行（含子 Agent）后续轮次不再携带强度字段
    pub effort_rejected: Arc<AtomicBool>,
    /// 自定义模型的线路协议与采样参数；仅与 base_url 同时生效
    pub custom_model: Option<crate::types::CustomModelOptions>,
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
        let reasoning_effort = self.reasoning_effort.filter(|_| !self.effort_rejected.load(Ordering::Relaxed));
        let effort_rejected = Arc::clone(&self.effort_rejected);
        let custom_model = self.custom_model.clone().filter(|_| base_url.is_some());
        let messages = messages.to_vec();
        let sink = Arc::clone(sink);
        Box::pin(async move {
            use crate::gateway::providers::custom_model;
            let config = get_provider_config(provider_id);
            let protocol = custom_model
                .as_ref()
                .map(|options| custom_model::protocol(options.api_format))
                .unwrap_or_else(|| WireProtocol::resolve(provider_id, base_url.as_deref()));
            let vendor = match (custom_model.as_ref(), base_url.as_deref()) {
                (Some(options), Some(base)) => custom_model::vendor(options, base),
                _ => CompatVendor::resolve(base_url.as_deref(), config.endpoint),
            };

            let (url, mut body) = if let (Some(options), Some(base)) = (custom_model.as_ref(), base_url.as_deref()) {
                let mut body = match protocol {
                    WireProtocol::Responses => crate::gateway::providers::openai_responses::build_openai_responses_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                    WireProtocol::Anthropic => crate::gateway::providers::anthropic::build_anthropic_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                    WireProtocol::ChatCompletions | WireProtocol::Gemini => {
                        crate::gateway::providers::openai_compat::build_openai_agent_body_for(
                            vendor,
                            options.family == Some(crate::types::ModelFamily::Deepseek),
                            &model, &messages, &system_prompt, &tools_schema,
                        )
                    }
                };
                custom_model::apply_options(&mut body, protocol, options, None, true);
                (custom_model::resolve_endpoint(base, options), body)
            } else {
                match protocol {
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
                }
            };

            // 保留不带强度字段的原始请求体：档位被上游拒绝时用它重发
            let mut body_without_effort = reasoning_effort.map(|effort| {
                let original = body.clone();
                crate::gateway::providers::reasoning::apply_agent_effort(&mut body, protocol, effort);
                original
            });

            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static("application/json"));
            headers.insert(reqwest::header::ACCEPT, reqwest::header::HeaderValue::from_static("text/event-stream"));
            // 服务端回退的 beta 头只对官方 Claude 端点有效
            let anthropic_beta = (provider_id == ProviderId::Claude && custom_model.is_none())
                .then(|| crate::gateway::providers::anthropic::anthropic_beta_header(&model))
                .flatten();
            crate::gateway::insert_auth_headers(&mut headers, protocol, &api_key, anthropic_beta)?;

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
                    // 档位取值或字段不被该模型接受时去掉强度字段重发，而不是让整个运行失败
                    if matches!(status.as_u16(), 400 | 422) {
                        if let Some(original) = body_without_effort.take() {
                            tracing::warn!("上游拒绝了思考档位参数 ({}): {}，去掉后重发", status, text);
                            effort_rejected.store(true, Ordering::Relaxed);
                            body = original;
                            sink(LoopEmit::Event(ClientStreamEvent::Notice {
                                code: NOTICE_REASONING_EFFORT_REJECTED.to_string(),
                            }));
                            continue 'attempts;
                        }
                    }
                    return Err(format!("上游返回错误 {}: {}", status, text));
                }

                let mut agg = crate::gateway::agent::stream_agg::ToolCallAggregator::new();
                let mut native = NativeTurnCollector::for_protocol(protocol, vendor);
                let mut openai_parser = crate::gateway::stream::OpenAiDeltaParser::default();
                let mut full_text = String::new();
                let mut reasoning = String::new();
                let mut thought_repetition = RepetitionDetector::default();
                let mut text_repetition = RepetitionDetector::default();
                let mut usage: Option<TokenUsage> = None;
                let mut sse = crate::gateway::stream::SseDecoder::default();
                let mut byte_stream = res.bytes_stream();
                // 已向前端下发过内容就不能再整轮重放，否则界面会出现重复的思考与正文
                let mut emitted = false;
                let mut truncated = false;

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
                    for data_str in sse.push(&bytes) {
                        if data_str == "[DONE]" {
                            continue;
                        }
                        native.push(&data_str);
                        truncated = truncated || is_output_limit_stop(protocol, &data_str);
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
                            usage.get_or_insert_with(TokenUsage::default).merge_from(&u);
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

                // 截断的轮次里工具参数可能不完整，不能照常执行，整轮按截断结束
                if truncated {
                    return Err(OUTPUT_TRUNCATED.to_string());
                }
                let (native, tool_calls) = native.finish(agg)?;
                return Ok(TurnOutcome { text: full_text, reasoning, tool_calls, usage, native });
            }
        })
    }
}

/// 本轮输出是否因输出 token 预算耗尽而被截断；各协议的结束原因字段不同
pub fn is_output_limit_stop(protocol: WireProtocol, data: &str) -> bool {
    // 绝大多数事件不含结束原因，先按子串过滤，避免逐条重复解析 JSON
    let marker = match protocol {
        WireProtocol::ChatCompletions => "\"length\"",
        WireProtocol::Anthropic => "\"max_tokens\"",
        WireProtocol::Gemini => "\"MAX_TOKENS\"",
        WireProtocol::Responses => "max_output_tokens",
    };
    if !data.contains(marker) {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else { return false };
    let field = |pointer: &str| value.pointer(pointer).and_then(|v| v.as_str());
    match protocol {
        WireProtocol::ChatCompletions => field("/choices/0/finish_reason") == Some("length"),
        WireProtocol::Anthropic => field("/delta/stop_reason") == Some("max_tokens"),
        WireProtocol::Gemini => field("/candidates/0/finishReason") == Some("MAX_TOKENS"),
        WireProtocol::Responses => field("/response/incomplete_details/reason") == Some("max_output_tokens"),
    }
}

/// 把执行器错误整理成给用户看的一行说明：优先取上游 JSON 里的 error.message，限制长度
pub fn upstream_error_summary(error: &str) -> String {
    const LIMIT: usize = 300;
    let readable = error
        .find('{')
        .and_then(|start| {
            let body: serde_json::Value = serde_json::from_str(&error[start..]).ok()?;
            let message = body
                .pointer("/error/message")
                .or_else(|| body.get("message"))
                .or_else(|| body.get("error"))
                .and_then(|value| value.as_str())?;
            Some(format!("{}：{}", error[..start].trim_end_matches([':', ' ']), message))
        })
        .unwrap_or_else(|| error.trim().to_string());
    match readable.char_indices().nth(LIMIT) {
        Some((cut, _)) => format!("{}…", &readable[..cut]),
        None => readable,
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

/// Agent 模式的 /api/chat 入口：SSE 流承载完整多轮运行
pub fn run_agent_chat_stream(
    client: reqwest::Client,
    fallback_client: Option<reqwest::Client>,
    request: ClientChatRequest,
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
    approvals: Arc<ApprovalRegistry>,
    mcp_manager: Arc<crate::mcp::McpManager>,
    runs: Arc<RunRegistry>,
) -> impl Stream<Item = Result<String, axum::Error>> {
    stream! {
        let provider_id = request.provider.unwrap_or(ProviderId::Stepfun);
        let config = get_provider_config(provider_id);
        let model = request.model.clone().unwrap_or_else(|| config.default_model.to_string());

        let api_key = crate::gateway::resolve_api_key(&request, provider_id, &key_store);
        let api_key = match api_key {
            Some(k) if !k.is_empty() => k,
            _ => {
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "API_KEY_MISSING".to_string() }));
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
        let custom_model = match crate::gateway::providers::custom_model::validated_custom_model(&request) {
            Ok(options) => options.cloned(),
            Err(error) => {
                tracing::warn!("Agent 自定义模型参数无效: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "INVALID_REQUEST".to_string() }));
                return;
            }
        };

        // 运行的工作区只取自请求：界面随后切换项目不会改变它，也不回退到界面当前浏览的项目
        let root = match resolve_run_workspace(request.agent.as_ref().and_then(|a| a.workspace.as_deref())) {
            Ok(root) => root,
            Err(error) => {
                tracing::warn!("Agent 工作区无效: {}", error);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "WORKSPACE_UNAVAILABLE".to_string() }));
                return;
            }
        };

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
        // 档位映射只覆盖 Chat Completions 兼容厂商；自定义模型显式关闭思考或改用其他协议时不再携带强度字段
        let custom_allows_effort = custom_model.as_ref().map_or(true, |options| {
            options.api_format == crate::types::ApiFormat::ChatCompletions
                && options.thinking != Some(crate::types::ThinkingMode::Off)
        });
        let reasoning_effort = request.reasoning_effort.filter(|_| custom_allows_effort).and_then(|level| {
            crate::gateway::providers::reasoning::native_effort(provider_id, base_url.as_deref(), &model, level)
        });
        let executor = HttpTurnExecutor {
            client: client.clone(),
            fallback_client,
            provider_id,
            base_url,
            api_key,
            model,
            system_prompt,
            tools_schema,
            reasoning_effort,
            effort_rejected: Arc::new(AtomicBool::new(false)),
            custom_model,
        };

        let context_budget = ContextBudget::for_window(
            request.agent.as_ref().and_then(|a| a.context_window),
            estimate_tokens(&executor.system_prompt) + estimate_tokens(&serde_json::Value::from(executor.tools_schema.clone()).to_string()),
        );
        let run_id = request.agent.as_ref().and_then(|a| a.run_id.clone()).unwrap_or_else(generate_run_id);
        let started_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let run_info = RunInfo {
            run_id: run_id.clone(),
            conversation_id: request.agent.as_ref().and_then(|a| a.conversation_id.clone()),
            workspace: root.clone(),
            provider: provider_id,
            model: executor.model.clone(),
            execution_mode,
            started_at,
        };
        let run_handle = match runs.begin(run_info.clone()) {
            Ok(handle) => handle,
            Err(code) => {
                tracing::warn!("Agent 运行登记失败: {}", code);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code }));
                return;
            }
        };
        // 取消标志归运行登记所有，只由显式取消接口置位：SSE 断开只是订阅者离开，运行继续，客户端可重新连接
        let cancelled = Arc::clone(&run_handle.control().cancelled);
        let events = Arc::clone(&run_handle.control().events);
        let ledger = match root.as_deref() {
            Some(root) => match ChangeLedger::open(root, &crate::gateway::agent::checkpoint::default_storage_base(), &run_id) {
                Ok(ledger) => Some(Arc::new(std::sync::Mutex::new(ledger))),
                Err(error) => {
                    tracing::warn!("改动账本不可用: {}", error);
                    None
                }
            },
            None => None,
        };
        let agent_config = AgentLoopConfig {
            max_turns: request.agent.as_ref().and_then(|a| a.max_turns),
            permission_timeout_secs: 300,
            execution_mode,
            run_id: Some(run_id.clone()),
            processes: Some(Arc::clone(&run_handle.control().processes)),
            workspace_lock: root.as_deref().map(|root| workspace_manager.write_lock(root)),
            ledger,
            supplements: Some(Arc::clone(&run_handle.control().supplements)),
            context_budget: Some(context_budget),
            locale: request.locale,
        };
        let supplements = Arc::clone(&run_handle.control().supplements);
        events.push(encode_client_event(&ClientStreamEvent::RunStarted {
            run_id: run_id.clone(),
            conversation_id: run_info.conversation_id.clone(),
            workspace: root.as_deref().map(crate::tools::display_path),
            execution_mode,
            provider: provider_id,
            model: run_info.model.clone(),
            started_at,
        }));
        let mut checkpoint = root.as_deref().map(|r| CheckpointStore::new(r, &run_id));

        // 运行产生的事件按序写入事件日志；心跳由订阅者在空闲时补发，不进日志
        let log_for_sink = Arc::clone(&events);
        let sink: EventSink = Arc::new(move |emit| {
            if let LoopEmit::Event(event) = emit {
                log_for_sink.push(encode_client_event(&event));
            }
        });

        let mut loop_messages = history_to_agent_messages(&request.messages);
        if let Some(current_time) = request.current_time.as_deref() {
            if let Some(AgentMessage::User { text, .. }) = loop_messages.iter_mut().rev().find(|m| matches!(m, AgentMessage::User { .. })) {
                text.insert_str(0, &build_time_note(request.locale, current_time));
            }
        }
        let exec = executor;
        let root_for_task = root.clone();
        let mcp_for_loop = Arc::clone(&mcp_manager);
        let log_for_task = Arc::clone(&events);
        tokio::spawn(async move {
            // 租约与运行登记归执行任务持有，SSE 断开后也不能提前允许恢复或复用同一运行编号。
            let _workspace_lease = workspace_lease;
            let run_handle = run_handle;
            let outcome = run_agent_loop_ext(
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
            .await;
            // 运行结束后不再接受补充；未送达的补充由界面以“未送达”呈现
            supplements.close();
            let (event, status, reason) = terminal_event(outcome);
            log_for_task.push(encode_client_event(&event));
            run_handle.complete(status, reason);
            // 注销运行登记：事件日志随之结束并写入运行记录
            drop(run_handle);
        });

        // SSE 连接只是事件日志的订阅者：从头读取并实时推送，断开不影响运行
        for await frame in crate::gateway::agent::run_events::subscribe(events, 0) {
            yield frame;
        }
    }
}

/// 运行的终止事件与记录中的结局
fn terminal_event(outcome: Result<LoopOutcome, String>) -> (ClientStreamEvent, RunEndStatus, Option<String>) {
    match outcome {
        Ok(LoopOutcome::Completed { usage }) => {
            (ClientStreamEvent::Done { truncated: false, usage: Some(usage), reason: None, unknown: Vec::new() }, RunEndStatus::Completed, None)
        }
        Ok(LoopOutcome::MaxTurnsReached { usage }) => (
            ClientStreamEvent::Done { truncated: true, usage: Some(usage), reason: None, unknown: Vec::new() },
            RunEndStatus::Completed,
            Some("max_turns".to_string()),
        ),
        Ok(LoopOutcome::Truncated { usage }) => (
            ClientStreamEvent::Done { truncated: true, usage: Some(usage), reason: None, unknown: Vec::new() },
            RunEndStatus::Completed,
            Some("truncated".to_string()),
        ),
        Ok(LoopOutcome::LoopDetected { usage }) => (
            ClientStreamEvent::Done { truncated: false, usage: Some(usage), reason: Some(DONE_REASON_LOOP_DETECTED.to_string()), unknown: Vec::new() },
            RunEndStatus::Completed,
            Some(DONE_REASON_LOOP_DETECTED.to_string()),
        ),
        Ok(LoopOutcome::ContextOverflow { usage }) => (
            ClientStreamEvent::Done { truncated: false, usage: Some(usage), reason: Some(DONE_REASON_CONTEXT_OVERFLOW.to_string()), unknown: Vec::new() },
            RunEndStatus::Completed,
            Some(DONE_REASON_CONTEXT_OVERFLOW.to_string()),
        ),
        // 运行到这里时命令已终止并确认，MCP 等无法确认的操作列在 unknown 中
        Ok(LoopOutcome::Cancelled { unknown }) => (
            ClientStreamEvent::Done { truncated: false, usage: None, reason: Some(DONE_REASON_CANCELLED.to_string()), unknown },
            RunEndStatus::Cancelled,
            Some(DONE_REASON_CANCELLED.to_string()),
        ),
        Err(error) => {
            tracing::error!("Agent loop error: {}", error);
            (ClientStreamEvent::UpstreamError { message: upstream_error_summary(&error) }, RunEndStatus::Failed, Some("upstream_error".to_string()))
        }
    }
}

/// done 事件中表示运行已按请求取消并完成收尾
pub const DONE_REASON_CANCELLED: &str = "cancelled";
/// done 事件中表示消息超出模型窗口、折叠后仍放不下而停止
pub const DONE_REASON_CONTEXT_OVERFLOW: &str = "context_overflow";
/// run_note 事件的种类
pub const RUN_NOTE_CONTEXT_COMPACTED: &str = "context_compacted";
pub const RUN_NOTE_CONTEXT_OVERFLOW: &str = "context_overflow";
pub const RUN_NOTE_VERIFICATION_REMINDER: &str = "verification_reminder";

/// 解析请求携带的运行工作区；缺省表示该运行不绑定项目
pub fn resolve_run_workspace(workspace: Option<&str>) -> Result<Option<std::path::PathBuf>, String> {
    workspace.map(crate::tools::resolve_workspace_dir).transpose()
}

