use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::gateway::agent::subagent::subagent_tools_schema;
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::types::{ClientStreamEvent, TokenUsage, ToolInvocation};

/// 按序返回预编排轮次，并像真实执行器一样把正文经 sink 下发
struct NarratingExecutor {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Arc<Mutex<Vec<Vec<AgentMessage>>>>,
    /// fork 时交出的子执行器轮次；None 表示不支持子 Agent
    child_turns: Mutex<Option<Vec<TurnOutcome>>>,
    child_seen: Arc<Mutex<Vec<Vec<AgentMessage>>>>,
    child_prompt: Arc<Mutex<Option<(String, Vec<serde_json::Value>)>>>,
}

impl NarratingExecutor {
    fn new(turns: Vec<TurnOutcome>, child_turns: Option<Vec<TurnOutcome>>) -> Self {
        Self {
            turns: Mutex::new(turns),
            seen: Arc::new(Mutex::new(Vec::new())),
            child_turns: Mutex::new(child_turns),
            child_seen: Arc::new(Mutex::new(Vec::new())),
            child_prompt: Arc::new(Mutex::new(None)),
        }
    }
}

impl TurnExecutor for NarratingExecutor {
    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        self.seen.lock().unwrap().push(messages.to_vec());
        let next = self.turns.lock().unwrap().remove(0);
        if !next.text.is_empty() {
            sink(LoopEmit::Event(ClientStreamEvent::Delta { text: next.text.clone() }));
        }
        Box::pin(async move { Ok(next) })
    }

    fn fork(&self, system_prompt: String, tools_schema: Vec<serde_json::Value>) -> Option<Box<dyn TurnExecutor>> {
        let turns = self.child_turns.lock().unwrap().take()?;
        *self.child_prompt.lock().unwrap() = Some((system_prompt, tools_schema));
        let child = NarratingExecutor::new(turns, None);
        let child = NarratingExecutor { seen: Arc::clone(&self.child_seen), ..child };
        Some(Box::new(child))
    }
}

fn turn(text: &str, calls: Vec<ToolInvocation>, completion_tokens: Option<u32>) -> TurnOutcome {
    TurnOutcome {
        reasoning: String::new(),
        native: Vec::new(),
        text: text.to_string(),
        tool_calls: calls,
        usage: completion_tokens.map(|tokens| TokenUsage {
            prompt_tokens: Some(100),
            completion_tokens: Some(tokens),
            total_tokens: Some(100 + tokens),
            ..Default::default()
        }),
    }
}

fn call(id: &str, name: &str, arguments: serde_json::Value) -> ToolInvocation {
    ToolInvocation { id: id.to_string(), name: name.to_string(), arguments }
}

fn collector() -> (EventSink, Arc<Mutex<Vec<ClientStreamEvent>>>) {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(ev) = emit {
            sink_events.lock().unwrap().push(ev);
        }
    });
    (sink, events)
}

async fn run(executor: &NarratingExecutor, root: &std::path::Path) -> (LoopOutcome, Arc<Mutex<Vec<ClientStreamEvent>>>) {
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = None;
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "调查一下项目".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(root),
        &http,
    )
    .await
    .unwrap();
    (outcome, events)
}

#[tokio::test]
async fn subagent_returns_only_its_final_report_to_parent() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("notes.txt"), "秘密配置在 config.toml").unwrap();
    let executor = NarratingExecutor::new(
        vec![
            turn("", vec![call("t1", "task", serde_json::json!({ "description": "查配置", "prompt": "找出配置文件位置" }))], Some(10)),
            turn("配置在 config.toml", vec![], Some(5)),
        ],
        Some(vec![
            turn("我先读一下", vec![call("c1", "read_file", serde_json::json!({ "path": "notes.txt" }))], Some(20)),
            turn("结论：配置位于 config.toml", vec![], Some(30)),
        ]),
    );

    let (outcome, events) = run(&executor, dir.path()).await;

    let LoopOutcome::Completed { usage } = outcome else { panic!("应正常完成") };
    assert_eq!(usage.completion_tokens, Some(10 + 20 + 30 + 5), "子任务用量计入本次运行");

    // 子 Agent 只拿到任务说明，看不到父对话
    let child_seen = executor.child_seen.lock().unwrap();
    assert!(matches!(&child_seen[0][..], [AgentMessage::User { text, .. }] if text == "找出配置文件位置"));
    assert!(matches!(&child_seen[1][2], AgentMessage::ToolResult { content, .. } if content.contains("config.toml")));

    // 主 Agent 的工具结果只有最终报告，不含子 Agent 中间轮次的正文
    let parent_second = &executor.seen.lock().unwrap()[1];
    let AgentMessage::ToolResult { content, name, .. } = &parent_second[2] else { panic!("应回填 task 结果") };
    assert_eq!(name, "task");
    assert!(content.starts_with("结论：配置位于 config.toml"));
    assert!(!content.contains("我先读一下"));
    assert!(content.contains("read_file×1"));

    // 前端只看到主 Agent 的 task 调用，子 Agent 的工具步骤与正文不外泄
    let events = events.lock().unwrap();
    let tool_calls: Vec<&str> = events
        .iter()
        .filter_map(|ev| match ev { ClientStreamEvent::ToolCall { name, .. } => Some(name.as_str()), _ => None })
        .collect();
    assert_eq!(tool_calls, vec!["task"]);
    assert!(!events.iter().any(|ev| matches!(ev, ClientStreamEvent::Delta { text } if text.contains("我先读一下"))));
}

#[tokio::test]
async fn subagent_tools_exclude_writes_nesting_and_desktop_control() {
    let mut parent = get_agent_tools_schema();
    parent.push(serde_json::json!({ "type": "function", "function": { "name": "mcp__windows_mcp__click" } }));
    let names: Vec<String> = subagent_tools_schema(&parent)
        .iter()
        .map(|schema| schema["function"]["name"].as_str().unwrap().to_string())
        .collect();
    for forbidden in ["write_file", "edit_file", "task", "todo_write", "mcp__windows_mcp__click"] {
        assert!(!names.iter().any(|name| name == forbidden), "{forbidden} 不应下放给子 Agent");
    }
    for allowed in ["read_file", "grep", "glob", "run_command"] {
        assert!(names.iter().any(|name| name == allowed), "{allowed} 应下放给子 Agent");
    }
}

#[tokio::test]
async fn subagent_requires_prompt_and_fork_support() {
    let dir = tempfile::tempdir().unwrap();
    let missing_prompt = NarratingExecutor::new(
        vec![
            turn("", vec![call("t1", "task", serde_json::json!({ "description": "空任务" }))], None),
            turn("好的", vec![], None),
        ],
        Some(vec![turn("不应运行", vec![], None)]),
    );
    run(&missing_prompt, dir.path()).await;
    let seen = missing_prompt.seen.lock().unwrap();
    assert!(matches!(&seen[1][2], AgentMessage::ToolResult { content, .. } if content.contains("缺少 prompt")));
    assert!(missing_prompt.child_seen.lock().unwrap().is_empty());

    let no_fork = NarratingExecutor::new(
        vec![
            turn("", vec![call("t1", "task", serde_json::json!({ "description": "x", "prompt": "查一下" }))], None),
            turn("好的", vec![], None),
        ],
        None,
    );
    run(&no_fork, dir.path()).await;
    let seen = no_fork.seen.lock().unwrap();
    assert!(matches!(&seen[1][2], AgentMessage::ToolResult { content, .. } if content.contains("不支持子 Agent")));
}
