//! 子 Agent：主 Agent 通过 `task` 工具把独立的调查类子任务交给一个上下文隔离的子循环。
//! 子循环不带角色人设提示词，中间的大量读取与命令输出只留在子循环内，
//! 回填给主 Agent 的只有最终报告，主上下文与后续每一轮的输入 token 都因此保持精简。

use crate::gateway::agent::checkpoint::CheckpointStore;
use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::agent::permission::ApprovalRegistry;
use crate::gateway::agent::runtime::{
    run_agent_loop_ext, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnExecutor,
};
use crate::types::{ClientStreamEvent, TokenUsage};
use futures::future::BoxFuture;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub const SUBAGENT_TOOL: &str = "task";

/// 子任务轮次上限：调查类任务通常十几轮内收敛，上限兜住失控的费用
pub const SUBAGENT_MAX_TURNS: u32 = 30;

/// 子 Agent 可用的工具。文件写入留给掌握完整上下文的主 Agent；MCP 与桌面控制不下放，
/// 避免两个循环同时操作同一界面；`task` 不在其中，子 Agent 不能再派生子 Agent
const SUBAGENT_TOOL_NAMES: [&str; 9] = [
    "read_file",
    "list_directory",
    "glob",
    "grep",
    "git_status",
    "git_diff",
    "web_fetch",
    "web_search",
    "run_command",
];

/// 从主 Agent 本次实际下发的工具集中筛选：只读模式、联网开关等限制自动沿用
pub fn subagent_tools_schema(parent: &[serde_json::Value]) -> Vec<serde_json::Value> {
    parent
        .iter()
        .filter(|schema| {
            schema
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(|name| name.as_str())
                .is_some_and(|name| SUBAGENT_TOOL_NAMES.contains(&name))
        })
        .cloned()
        .collect()
}

pub fn build_subagent_system_prompt(workspace_root: Option<&Path>) -> String {
    let workspace = match workspace_root {
        Some(root) => format!("当前项目根目录：{}（相对路径以此为基准）。", root.to_string_lossy()),
        None => "当前未选择项目：read_file / list_directory 需使用绝对路径，并可能需要用户在权限卡上批准。".to_string(),
    };
    format!(
        "你是主 Agent 派出的子 Agent，在用户本机上独立完成一项子任务，结果只交给主 Agent，不直接面向用户。\n\
规则：\n\
- 只围绕任务说明工作，自主组合工具完成，不要提问；信息不足时基于已查到的事实下结论并指出缺口。\n\
- 你不能修改文件。run_command 只用于查询系统信息、构建与测试，不得执行删除、移动、安装、写入等有副作用的命令。\n\
- 彼此独立的读取与检索在同一轮并行发起；大文件先用 grep 定位再读取相关片段，不要整份通读。\n\
- 结束时输出最终报告：先给结论，再列关键证据（文件路径与行号、命令输出要点、具体数据），2000 字以内；不复述中间过程，不做角色扮演。\n\
- 报告使用与任务说明相同的语言。\n\
{workspace}"
    )
}

/// 显式标注返回类型以切断「主循环 → 子 Agent → 主循环」的递归 Future 类型，
/// 否则编译器在推导 Send 时会陷入循环
fn run_nested_loop<'a>(
    messages: Vec<AgentMessage>,
    tools_schema: Vec<serde_json::Value>,
    config: AgentLoopConfig,
    executor: &'a dyn TurnExecutor,
    gate: &'a ApprovalRegistry,
    checkpoint: &'a mut Option<CheckpointStore>,
    cancelled: &'a AtomicBool,
    sink: &'a EventSink,
    workspace_root: Option<&'a Path>,
    http_client: &'a reqwest::Client,
) -> BoxFuture<'a, Result<LoopOutcome, String>> {
    Box::pin(run_agent_loop_ext(
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
    ))
}

/// 运行一个子任务，返回（回填给主 Agent 的报告，子任务消耗的用量）
#[allow(clippy::too_many_arguments)]
pub async fn run_subagent(
    arguments: &serde_json::Value,
    parent_tools: &[serde_json::Value],
    executor: &dyn TurnExecutor,
    config: &AgentLoopConfig,
    gate: &ApprovalRegistry,
    checkpoint: &mut Option<CheckpointStore>,
    cancelled: &AtomicBool,
    sink: &EventSink,
    workspace_root: Option<&Path>,
    http_client: &reqwest::Client,
) -> Result<(String, TokenUsage), String> {
    let prompt = arguments
        .get("prompt")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or("缺少 prompt 参数：请写清子任务的目标、范围与期望的报告内容")?;
    let tools_schema = subagent_tools_schema(parent_tools);
    let child = executor
        .fork(build_subagent_system_prompt(workspace_root), tools_schema.clone())
        .ok_or("当前模型通道不支持子 Agent，请直接使用工具完成该任务")?;

    // 子循环的正文与工具步骤不进入前端消息，否则会被当作主 Agent 的工具调用写进历史、
    // 抵消上下文隔离的意义；只转发权限审批（用户必须能看到并批准）与心跳
    let report = Arc::new(Mutex::new(String::new()));
    let tool_names: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let parent_sink = Arc::clone(sink);
    let report_sink = Arc::clone(&report);
    let names_sink = Arc::clone(&tool_names);
    let child_sink: EventSink = Arc::new(move |emit| match emit {
        // 每轮开始清空，最终保留的是最后一轮（不再调用工具的那一轮）的正文
        LoopEmit::Event(ClientStreamEvent::Turn { .. }) => report_sink.lock().unwrap().clear(),
        LoopEmit::Event(ClientStreamEvent::Delta { text }) => report_sink.lock().unwrap().push_str(&text),
        LoopEmit::Event(ClientStreamEvent::ToolCall { name, .. }) => names_sink.lock().unwrap().push(name),
        LoopEmit::Event(event @ (ClientStreamEvent::PermissionRequest { .. } | ClientStreamEvent::PermissionResolved { .. })) => {
            parent_sink(LoopEmit::Event(event));
        }
        LoopEmit::Ping => parent_sink(LoopEmit::Ping),
        LoopEmit::Event(_) => {}
    });

    // 子循环沿用运行编号与进程表：子任务的审批属于同一运行，命令同样可查询与停止
    let child_config = AgentLoopConfig { max_turns: Some(SUBAGENT_MAX_TURNS), ..config.clone() };
    let outcome = run_nested_loop(
        vec![AgentMessage::User { text: prompt.to_string(), image_data_url: None }],
        tools_schema,
        child_config,
        child.as_ref(),
        gate,
        checkpoint,
        cancelled,
        &child_sink,
        workspace_root,
        http_client,
    )
    .await?;

    let (usage, stop_note) = match outcome {
        LoopOutcome::Completed { usage } => (usage, None),
        LoopOutcome::MaxTurnsReached { usage } => (usage, Some("子任务达到轮次上限，以下为截至目前的结果")),
        LoopOutcome::LoopDetected { usage } => (usage, Some("子任务陷入重复操作被提前结束，以下为截至目前的结果")),
        LoopOutcome::Truncated { usage } => (usage, Some("子任务输出被截断，以下为截至目前的结果")),
        LoopOutcome::ContextOverflow { usage } => (usage, Some("子任务上下文超出模型窗口被停止，以下为截至目前的结果")),
        LoopOutcome::Cancelled { .. } => return Err("子任务已取消".to_string()),
    };
    let report = report.lock().unwrap().trim().to_string();
    let tool_names = tool_names.lock().unwrap();
    let mut output = String::new();
    if let Some(note) = stop_note {
        output.push_str(&format!("[{note}]\n"));
    }
    output.push_str(if report.is_empty() { "（子 Agent 没有给出文字报告）" } else { &report });
    output.push_str(&format!("\n\n[子 Agent 共调用 {} 次工具{}]", tool_names.len(), summarize_tools(&tool_names)));
    Ok((output, usage))
}

/// 「read_file×3、grep×2」形式的工具使用摘要，让主 Agent 与用户知道报告的证据来源
fn summarize_tools(names: &[String]) -> String {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for name in names {
        match counts.iter_mut().find(|(existing, _)| *existing == name.as_str()) {
            Some((_, count)) => *count += 1,
            None => counts.push((name.as_str(), 1)),
        }
    }
    if counts.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = counts.iter().map(|(name, count)| format!("{name}×{count}")).collect();
    format!("：{}", parts.join("、"))
}
