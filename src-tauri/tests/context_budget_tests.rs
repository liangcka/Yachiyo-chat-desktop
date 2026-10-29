//! 长任务的上下文预算与执行反馈：较早轮次折叠为运行进展摘要（目标、补充要求、操作、改动文件、失败都保留），
//! 工具调用与结果成对折叠、近期轮次的原生输出原样保留；放不下时如实停止；交付前提醒未验证或验证失败。
//! 模型由脚本替身驱动，文件写入与命令执行走真实路径。
#![cfg(unix)]

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::context_budget::{compact_to_budget, estimate_messages, ContextBudget, RunProgress};
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::run_registry::{Supplement, SupplementQueue};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::types::{AgentExecutionMode, ChatLocale, ClientStreamEvent, ToolInvocation};

struct Script {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Mutex<Vec<Vec<AgentMessage>>>,
    hook: Box<dyn Fn(usize) + Send + Sync>,
}

impl Script {
    fn new(turns: Vec<TurnOutcome>) -> Self {
        Self { turns: Mutex::new(turns), seen: Mutex::new(Vec::new()), hook: Box::new(|_| {}) }
    }
}

impl TurnExecutor for Script {
    fn execute(&self, messages: &[AgentMessage], _sink: &EventSink) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let call = {
            let mut seen = self.seen.lock().unwrap();
            seen.push(messages.to_vec());
            seen.len()
        };
        (self.hook)(call);
        let next = self.turns.lock().unwrap().remove(0);
        Box::pin(async move { Ok(next) })
    }
}

fn call(id: &str, name: &str, arguments: serde_json::Value) -> TurnOutcome {
    TurnOutcome {
        text: format!("第 {id} 步"),
        reasoning: String::new(),
        native: vec![serde_json::json!({ "type": "thinking", "signature": format!("sig-{id}") })],
        tool_calls: vec![ToolInvocation { id: id.to_string(), name: name.to_string(), arguments }],
        usage: None,
    }
}

fn final_turn(text: &str) -> TurnOutcome {
    TurnOutcome { text: text.to_string(), reasoning: String::new(), native: Vec::new(), tool_calls: Vec::new(), usage: None }
}

async fn run(
    workspace: &std::path::Path,
    script: &Script,
    budget: Option<ContextBudget>,
    supplements: Option<Arc<SupplementQueue>>,
) -> (LoopOutcome, Vec<ClientStreamEvent>) {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::default();
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(event) = emit {
            sink_events.lock().unwrap().push(event);
        }
    });
    let outcome = run_agent_loop(
        vec![
            AgentMessage::User { text: "更早的对话".to_string(), image_data_url: None },
            AgentMessage::Assistant { text: "好的".to_string(), reasoning: String::new(), tool_calls: Vec::new(), native: Vec::new() },
            AgentMessage::User { text: "把日志模块重构成结构化日志".to_string(), image_data_url: None },
        ],
        get_agent_tools_schema(),
        AgentLoopConfig {
            execution_mode: AgentExecutionMode::FullAuto,
            run_id: Some("run-ctx".to_string()),
            context_budget: budget,
            supplements,
            locale: ChatLocale::ZhCn,
            ..AgentLoopConfig::default()
        },
        script,
        &ApprovalRegistry::new(),
        &mut None,
        &AtomicBool::new(false),
        &sink,
        Some(workspace),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    let events = events.lock().unwrap().clone();
    (outcome, events)
}

fn notes(events: &[ClientStreamEvent], kind: &str) -> Vec<serde_json::Value> {
    events
        .iter()
        .filter_map(|event| match event {
            ClientStreamEvent::RunNote { kind: note, detail } if note == kind => Some(detail.clone()),
            _ => None,
        })
        .collect()
}

/// 每个工具调用都有对应结果，且结果紧跟在发起它的助手消息之后
fn assert_tool_pairs(messages: &[AgentMessage]) {
    let mut pending: Vec<String> = Vec::new();
    for message in messages {
        match message {
            AgentMessage::Assistant { tool_calls, .. } => {
                assert!(pending.is_empty(), "上一轮的工具调用缺少结果：{pending:?}");
                pending = tool_calls.iter().map(|call| call.id.clone()).collect();
            }
            AgentMessage::ToolResult { tool_call_id, .. } => {
                let position = pending.iter().position(|id| id == tool_call_id).unwrap_or_else(|| panic!("工具结果 {tool_call_id} 没有对应的调用"));
                pending.remove(position);
            }
            AgentMessage::User { .. } => {}
        }
    }
}

#[tokio::test]
async fn long_runs_fold_older_turns_into_a_progress_summary_that_keeps_goal_constraints_files_and_failures() {
    let workspace = tempfile::tempdir().unwrap();
    std::fs::write(workspace.path().join("big.txt"), "x".repeat(6_000)).unwrap();
    let queue = Arc::new(SupplementQueue::default());
    let hook_queue = Arc::clone(&queue);
    let mut script = Script::new(vec![
        call("1", "read_file", serde_json::json!({ "path": "big.txt" })),
        call("2", "write_file", serde_json::json!({ "path": "src/log.rs", "content": "pub fn log() {}\n" })),
        call("3", "run_command", serde_json::json!({ "command": "echo 'error: 缺少依赖' >&2; exit 3" })),
        call("4", "read_file", serde_json::json!({ "path": "big.txt" })),
        call("5", "read_file", serde_json::json!({ "path": "big.txt" })),
        // 按命令文本识别为验证（与界面判定一致），退出码 0：修改之后已验证，交付前不再提醒
        call("6", "run_command", serde_json::json!({ "command": "echo tsc --noEmit" })),
        final_turn("完成"),
    ]);
    script.hook = Box::new(move |call| {
        if call == 2 {
            hook_queue.push(Supplement { id: "s1".to_string(), text: "保留旧的日志格式开关".to_string() }).unwrap();
        }
    });
    // 预算很小：后面的轮次一定需要折叠
    let budget = ContextBudget { input_tokens: 3_400 };
    let (outcome, events) = run(workspace.path(), &script, Some(budget), Some(queue)).await;
    assert!(matches!(outcome, LoopOutcome::Completed { .. }), "{events:?}");

    let compactions = notes(&events, "context_compacted");
    assert!(!compactions.is_empty(), "超出预算时应折叠并告知界面");
    for detail in &compactions {
        assert!(detail["afterTokens"].as_u64().unwrap() <= budget.input_tokens as u64);
    }

    let seen = script.seen.lock().unwrap();
    let last = seen.last().unwrap();
    assert_tool_pairs(last);
    // 更早的对话历史原样保留，本次请求原文后附上运行进展摘要
    assert!(matches!(&last[0], AgentMessage::User { text, .. } if text == "更早的对话"));
    let AgentMessage::User { text: summary, .. } = &last[2] else { panic!("本次请求消息应在原位") };
    assert!(summary.starts_with("把日志模块重构成结构化日志\n\n[运行进展摘要"), "{summary}");
    assert!(summary.contains("用户在任务进行中补充的要求：\n- 保留旧的日志格式开关"), "{summary}");
    assert!(summary.contains("已修改的文件：\n- src/log.rs"), "{summary}");
    assert!(summary.contains("出现过的失败：\n- run_command echo 'error: 缺少依赖'"), "{summary}");
    assert!(summary.contains("write_file src/log.rs：完成"), "{summary}");
    // 最近两轮原样保留，包括原生输出（思考签名）
    let kept: Vec<&AgentMessage> = last.iter().filter(|message| matches!(message, AgentMessage::Assistant { .. })).collect();
    assert!(kept.len() >= 2 && kept.len() < 7, "较早的轮次被折叠，近期轮次保留");
    for message in kept.iter().skip(1) {
        let AgentMessage::Assistant { native, .. } = message else { unreachable!() };
        assert_eq!(native.len(), 1, "保留轮次的原生输出原样回传");
    }
    assert!(estimate_messages(last) <= budget.input_tokens + 200);
}

#[tokio::test]
async fn context_that_cannot_fit_stops_the_run_with_a_visible_reason() {
    let workspace = tempfile::tempdir().unwrap();
    let script = Script::new(vec![final_turn("不会执行到这里")]);
    // 请求本身就超出预算：无可折叠的轮次
    let (outcome, events) = run(workspace.path(), &script, Some(ContextBudget { input_tokens: 5 }), None).await;
    assert!(matches!(outcome, LoopOutcome::ContextOverflow { .. }));
    assert_eq!(notes(&events, "context_overflow").len(), 1);
    assert!(script.seen.lock().unwrap().is_empty(), "放不下时不发给上游");
}

#[tokio::test]
async fn finishing_after_unverified_code_changes_or_a_failed_verification_gets_one_reminder_each() {
    let workspace = tempfile::tempdir().unwrap();
    let script = Script::new(vec![
        call("1", "write_file", serde_json::json!({ "path": "src/lib.rs", "content": "pub fn f() {}\n" })),
        final_turn("改好了"),
        call("2", "run_command", serde_json::json!({ "command": "cargo test --offline --manifest-path missing/Cargo.toml" })),
        final_turn("测试没跑起来"),
        final_turn("已说明失败原因"),
    ]);
    let (outcome, events) = run(workspace.path(), &script, None, None).await;
    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let reminders = notes(&events, "verification_reminder");
    assert_eq!(reminders.len(), 2, "{reminders:?}");
    assert_eq!(reminders[0]["reason"], "not_verified");
    assert_eq!(reminders[0]["files"], serde_json::json!(["src/lib.rs"]));
    assert_eq!(reminders[1]["reason"], "verification_failed");

    let seen = script.seen.lock().unwrap();
    assert_eq!(seen.len(), 5, "每种提醒只让循环多走一轮");
    let reminder = seen[2].last().unwrap();
    assert!(matches!(reminder, AgentMessage::User { text, .. } if text.contains("[执行反馈]") && text.contains("src/lib.rs")));
    assert_tool_pairs(&seen[4]);
}

#[tokio::test]
async fn documentation_edits_and_verified_changes_finish_without_reminders() {
    let workspace = tempfile::tempdir().unwrap();
    let script = Script::new(vec![
        call("1", "write_file", serde_json::json!({ "path": "README.md", "content": "# 说明\n" })),
        final_turn("文档已更新"),
    ]);
    let (_, events) = run(workspace.path(), &script, None, None).await;
    assert!(notes(&events, "verification_reminder").is_empty());
    assert_eq!(script.seen.lock().unwrap().len(), 2);
}

#[test]
fn compaction_never_splits_a_tool_call_from_its_results() {
    let call = |id: &str| ToolInvocation { id: id.to_string(), name: "grep".to_string(), arguments: serde_json::json!({ "pattern": "x" }) };
    let mut messages = vec![AgentMessage::User { text: "目标".to_string(), image_data_url: None }];
    for turn in 0..6 {
        let ids = [format!("{turn}a"), format!("{turn}b")];
        messages.push(AgentMessage::Assistant { text: String::new(), reasoning: String::new(), tool_calls: ids.iter().map(|id| call(id)).collect(), native: Vec::new() });
        for id in &ids {
            messages.push(AgentMessage::ToolResult { tool_call_id: id.clone(), name: "grep".to_string(), content: "y".repeat(600) });
        }
    }
    let mut progress = RunProgress::default();
    let compaction = compact_to_budget(&mut messages, 0, "目标", &mut progress, ContextBudget { input_tokens: 1_200 }, estimate_messages)
        .unwrap()
        .unwrap();
    assert!(compaction.folded_turns >= 1);
    assert_tool_pairs(&messages);
    assert!(matches!(&messages[1], AgentMessage::Assistant { .. }), "折叠后紧接着的是完整的一轮");
}
