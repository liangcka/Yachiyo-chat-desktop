//! 运行中的补充要求：排队、在下一次调用模型前送达、最终回复时到达的补充让循环继续、运行结束后拒绝。
//! 模型由脚本替身驱动，命令走真实执行路径。
#![cfg(unix)]

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::run_registry::{RunInfo, RunRegistry, Supplement, SupplementQueue, SupplementRejected};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::types::{AgentExecutionMode, ClientStreamEvent, ProviderId, ToolInvocation};

type Hook = Box<dyn Fn(usize) + Send + Sync>;

/// 按脚本返回每一轮的输出；hook 在第 n 次调用模型时执行，模拟用户在模型生成期间追加补充
struct Script {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Mutex<Vec<Vec<AgentMessage>>>,
    hook: Hook,
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

fn command_turn(command: &str) -> TurnOutcome {
    TurnOutcome {
        text: String::new(),
        reasoning: String::new(),
        native: Vec::new(),
        tool_calls: vec![ToolInvocation { id: "c1".to_string(), name: "run_command".to_string(), arguments: serde_json::json!({ "command": command }) }],
        usage: None,
    }
}

fn final_turn(text: &str) -> TurnOutcome {
    TurnOutcome { text: text.to_string(), reasoning: String::new(), native: Vec::new(), tool_calls: Vec::new(), usage: None }
}

fn supplement(id: &str, text: &str) -> Supplement {
    Supplement { id: id.to_string(), text: text.to_string() }
}

async fn run(script: &Script, queue: &Arc<SupplementQueue>) -> (LoopOutcome, Vec<ClientStreamEvent>) {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::default();
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(event) = emit {
            sink_events.lock().unwrap().push(event);
        }
    });
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "修复测试".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig {
            execution_mode: AgentExecutionMode::FullAuto,
            run_id: Some("run-s".to_string()),
            supplements: Some(Arc::clone(queue)),
            ..AgentLoopConfig::default()
        },
        script,
        &ApprovalRegistry::new(),
        &mut None,
        &AtomicBool::new(false),
        &sink,
        None,
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    let events = events.lock().unwrap().clone();
    (outcome, events)
}

fn delivered(events: &[ClientStreamEvent]) -> Vec<Vec<String>> {
    events
        .iter()
        .filter_map(|event| match event {
            ClientStreamEvent::SupplementDelivered { ids, .. } => Some(ids.clone()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn supplement_queued_during_a_command_reaches_the_next_model_call_with_the_tool_result() {
    let queue = Arc::new(SupplementQueue::default());
    let hook_queue = Arc::clone(&queue);
    let script = Script {
        turns: Mutex::new(vec![command_turn("sleep 0.3 && echo ok"), final_turn("完成")]),
        seen: Mutex::new(Vec::new()),
        // 第一次调用模型后（命令即将执行）用户追加要求
        hook: Box::new(move |call| {
            if call == 1 {
                hook_queue.push(supplement("s1", "顺便把日志级别改成 debug")).unwrap();
            }
        }),
    };
    let (outcome, events) = run(&script, &queue).await;
    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert_eq!(delivered(&events), vec![vec!["s1".to_string()]]);

    let seen = script.seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    let Some(AgentMessage::ToolResult { content, .. }) = seen[1].last() else { panic!("补充应接在工具结果之后：{:?}", seen[1].last()) };
    assert!(content.contains("[用户在任务进行中补充的要求]\n顺便把日志级别改成 debug"), "{content}");
    assert!(!matches!(seen[1].iter().rev().nth(1), Some(AgentMessage::User { .. })), "不另起连续的用户消息");
}

#[tokio::test]
async fn supplement_arriving_while_the_final_answer_is_generated_continues_the_run() {
    let queue = Arc::new(SupplementQueue::default());
    let hook_queue = Arc::clone(&queue);
    let script = Script {
        turns: Mutex::new(vec![final_turn("已修复"), final_turn("也补上了 README")]),
        seen: Mutex::new(Vec::new()),
        hook: Box::new(move |call| {
            if call == 1 {
                hook_queue.push(supplement("s2", "再更新一下 README")).unwrap();
            }
        }),
    };
    let (outcome, events) = run(&script, &queue).await;
    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert_eq!(delivered(&events), vec![vec!["s2".to_string()]]);

    let seen = script.seen.lock().unwrap();
    assert_eq!(seen.len(), 2, "最终回复期间到达的补充让循环多走一轮");
    let tail: Vec<&AgentMessage> = seen[1].iter().rev().take(2).collect();
    assert!(matches!(tail[1], AgentMessage::Assistant { text, tool_calls, .. } if text == "已修复" && tool_calls.is_empty()));
    assert!(matches!(tail[0], AgentMessage::User { text, .. } if text.ends_with("再更新一下 README")));
    drop(seen);

    // 运行结束时队列已关闭，之后的补充被拒绝而不是被静默接受
    assert_eq!(queue.push(supplement("s3", "晚到的要求")), Err(SupplementRejected::Closed));
}

#[test]
fn registry_rejects_supplements_for_finished_cancelled_or_invalid_requests() {
    let registry = Arc::new(RunRegistry::new());
    let handle = registry
        .begin(RunInfo {
            run_id: "run-q".to_string(),
            conversation_id: None,
            workspace: None,
            provider: ProviderId::Openai,
            model: "m".to_string(),
            execution_mode: AgentExecutionMode::Confirm,
            started_at: 0,
        })
        .unwrap();
    assert_eq!(registry.supplement("run-q", supplement("a1", "  ")), Err(SupplementRejected::Invalid));
    assert_eq!(registry.supplement("run-q", supplement("bad id", "x")), Err(SupplementRejected::Invalid));
    assert_eq!(registry.supplement("run-q", supplement("a1", "加上测试")), Ok(()));
    assert_eq!(registry.supplement("run-q", supplement("a1", "加上测试")), Ok(()), "同一补充重复提交只排队一次");
    assert_eq!(handle.control().supplements.drain(), vec![supplement("a1", "加上测试")]);
    assert_eq!(registry.supplement("run-x", supplement("a2", "x")), Err(SupplementRejected::NotActive));

    registry.cancel("run-q");
    assert_eq!(registry.supplement("run-q", supplement("a3", "x")), Err(SupplementRejected::Cancelling));
    drop(handle);
    assert_eq!(registry.supplement("run-q", supplement("a4", "x")), Err(SupplementRejected::NotActive));
}
