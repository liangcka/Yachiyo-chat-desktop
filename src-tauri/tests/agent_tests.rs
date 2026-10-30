use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;
use yachiyo_desktop_lib::gateway::agent::messages::{history_to_agent_messages, AgentMessage};
use yachiyo_desktop_lib::gateway::agent::permission::{ApprovalDecision, ApprovalRegistry};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::gateway::agent::stream_agg::ToolCallAggregator;
use yachiyo_desktop_lib::gateway::providers::openai_compat::build_openai_agent_body;
use yachiyo_desktop_lib::gateway::stream::extract_openai_delta;
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::types::{
    AgentExecutionMode, ClientHistoryMessage, ClientStreamEvent, ProviderId, TokenUsage, ToolInvocation,
};

struct TestWorkspace { _directory: tempfile::TempDir, root: std::path::PathBuf }
impl TestWorkspace { fn path(&self) -> &std::path::Path { &self.root } }
fn temp_workspace() -> TestWorkspace {
    let directory = tempfile::Builder::new().tempdir().unwrap();
    let root = directory.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    TestWorkspace { _directory: directory, root }
}
fn checkpoint_store(root: &std::path::Path, run: &str) -> CheckpointStore {
    CheckpointStore::with_storage(root, run, &root.parent().unwrap().join("checkpoint-storage"))
}

#[test]
fn test_history_to_agent_messages() {
    let history = vec![
        ClientHistoryMessage {
            role: "user".to_string(),
            text: "看下项目".to_string(),
            image_data_url: None,
            tool_calls: None,
            tool_call_id: None,
            tool_name: None,
        },
        ClientHistoryMessage {
            role: "assistant".to_string(),
            text: "我先列目录".to_string(),
            image_data_url: None,
            tool_calls: Some(vec![ToolInvocation {
                id: "call-1".to_string(),
                name: "list_directory".to_string(),
                arguments: serde_json::json!({"path": "."}),
            }]),
            tool_call_id: None,
            tool_name: None,
        },
        ClientHistoryMessage {
            role: "tool".to_string(),
            text: "src/".to_string(),
            image_data_url: None,
            tool_calls: None,
            tool_call_id: Some("call-1".to_string()),
            tool_name: Some("list_directory".to_string()),
        },
    ];
    let agent_msgs = history_to_agent_messages(&history);
    assert_eq!(agent_msgs.len(), 3);
    assert!(matches!(&agent_msgs[0], AgentMessage::User { text, .. } if text == "看下项目"));
    match &agent_msgs[1] {
        AgentMessage::Assistant { text, tool_calls, .. } => {
            assert_eq!(text, "我先列目录");
            assert_eq!(tool_calls.len(), 1);
            assert_eq!(tool_calls[0].name, "list_directory");
        }
        _ => panic!("expected Assistant"),
    }
    assert!(matches!(&agent_msgs[2], AgentMessage::ToolResult { tool_call_id, name, content }
        if tool_call_id == "call-1" && name == "list_directory" && content == "src/"));
}

#[test]
fn test_openai_agent_body_structure() {
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: "好的".to_string(),
            reasoning: String::new(), native: Vec::new(),
            tool_calls: vec![ToolInvocation {
                id: "call-1".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({"path": "a.rs"}),
            }],
        },
        AgentMessage::ToolResult {
            tool_call_id: "call-1".to_string(),
            name: "read_file".to_string(),
            content: "fn main() {}".to_string(),
        },
    ];
    let tools = vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })];
    let body = build_openai_agent_body(ProviderId::Openai, None, "test-model", &messages, "系统提示", &tools);
    assert_eq!(body["model"], "test-model");
    assert_eq!(body["tool_choice"], "auto");
    assert_eq!(body["tools"].as_array().unwrap().len(), 1);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs[0]["role"], "system");
    assert_eq!(msgs[1]["role"], "user");
    assert_eq!(msgs[2]["role"], "assistant");
    assert_eq!(msgs[2]["tool_calls"][0]["function"]["name"], "read_file");
    assert_eq!(msgs[2]["tool_calls"][0]["function"]["arguments"], "{\"path\":\"a.rs\"}");
    assert_eq!(msgs[3]["role"], "tool");
    assert_eq!(msgs[3]["tool_call_id"], "call-1");
    assert!(msgs[2].get("reasoning_content").is_none());
    assert!(body.get("max_tokens").is_none());
}

#[test]
fn test_deepseek_agent_body_replays_reasoning_and_sets_output_budget() {
    let call = |id: &str| ToolInvocation {
        id: id.to_string(),
        name: "read_file".to_string(),
        arguments: serde_json::json!({"path": "a.rs"}),
    };
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        // 客户端重放的上一轮工具调用不含思维链
        AgentMessage::Assistant { text: String::new(), reasoning: String::new(), native: Vec::new(), tool_calls: vec![call("call-0")] },
        AgentMessage::ToolResult { tool_call_id: "call-0".to_string(), name: "read_file".to_string(), content: "旧".to_string() },
        AgentMessage::Assistant { text: "读过了".to_string(), reasoning: String::new(), native: Vec::new(), tool_calls: vec![] },
        AgentMessage::User { text: "再读一次".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: String::new(), reasoning: "需要重新读取".to_string(), tool_calls: vec![call("call-1")], native: Vec::new() },
        AgentMessage::ToolResult { tool_call_id: "call-1".to_string(), name: "read_file".to_string(), content: "新".to_string() },
    ];
    let body = build_openai_agent_body(ProviderId::Deepseek, None, "deepseek-v4-flash", &messages, "系统提示", &[]);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs[2]["reasoning_content"], "");
    assert_eq!(msgs[4]["reasoning_content"], "");
    assert_eq!(msgs[6]["reasoning_content"], "需要重新读取");
    assert_eq!(body["max_tokens"], 256_000);
}

#[test]
fn test_openai_tool_call_delta_extraction_and_aggregation() {
    let chunk1 = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"write_file","arguments":""}}]}}]}"#;
    let delta1 = extract_openai_delta(chunk1).expect("should parse tool delta");
    assert_eq!(delta1.tool_calls.len(), 1);

    let chunk2 = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]}}]}"#;
    let delta2 = extract_openai_delta(chunk2).expect("should parse args fragment");

    let chunk3 = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.rs\",\"content\":\"hi\"}"}}]}}]}"#;
    let delta3 = extract_openai_delta(chunk3).expect("should parse args tail");

    let mut agg = ToolCallAggregator::new();
    agg.push(&delta1.tool_calls[0]);
    agg.push(&delta2.tool_calls[0]);
    agg.push(&delta3.tool_calls[0]);
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call-1");
    assert_eq!(calls[0].name, "write_file");
    assert_eq!(calls[0].arguments["path"], "a.rs");
}

#[test]
fn test_aggregator_assigns_id_for_gemini_calls() {
    use yachiyo_desktop_lib::types::ToolCallStreamDelta;
    let mut agg = ToolCallAggregator::new();
    agg.push(&ToolCallStreamDelta::Gemini {
        call: ToolInvocation {
            id: String::new(),
            name: "read_file".to_string(),
            arguments: serde_json::json!({"path": "x"}),
        },
    });
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert!(!calls[0].id.is_empty());
}

#[test]
fn test_anthropic_agent_body_structure() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::build_anthropic_agent_body;

    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: "好的".to_string(),
            reasoning: String::new(), native: Vec::new(),
            tool_calls: vec![ToolInvocation {
                id: "toolu_1".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({"path": "a.rs"}),
            }],
        },
        AgentMessage::ToolResult {
            tool_call_id: "toolu_1".to_string(),
            name: "read_file".to_string(),
            content: "fn main() {}".to_string(),
        },
    ];
    let tools = vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })];
    let body = build_anthropic_agent_body("claude-sonnet-5", &messages, "系统提示", &tools);

    assert_eq!(body["model"], "claude-sonnet-5");
    assert_eq!(body["system"], "系统提示");
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[1]["role"], "assistant");
    assert_eq!(msgs[1]["content"][1]["type"], "tool_use");
    assert_eq!(msgs[1]["content"][1]["id"], "toolu_1");
    assert_eq!(msgs[1]["content"][1]["input"]["path"], "a.rs");
    assert_eq!(msgs[2]["role"], "user");
    assert_eq!(msgs[2]["content"][0]["type"], "tool_result");
    assert_eq!(msgs[2]["content"][0]["tool_use_id"], "toolu_1");
    assert_eq!(body["tools"][0]["name"], "read_file");
    assert!(body["tools"][0].get("input_schema").is_some());
}

#[test]
fn test_anthropic_tool_use_stream_extraction() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::extract_anthropic_delta;

    let start = r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file"}}"#;
    let args1 = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"a"}}"#;
    let args2 = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":".rs\"}"}}"#;
    let stop = r#"{"type":"content_block_stop","index":1}"#;

    let mut agg = ToolCallAggregator::new();
    for chunk in [start, args1, args2, stop] {
        if let Some(delta) = extract_anthropic_delta(chunk) {
            for tc in &delta.tool_calls {
                agg.push(tc);
            }
        }
    }
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "toolu_1");
    assert_eq!(calls[0].name, "write_file");
    assert_eq!(calls[0].arguments["path"], "a.rs");
}

#[test]
fn test_gemini_agent_body_structure() {
    use yachiyo_desktop_lib::gateway::providers::gemini::build_gemini_agent_body;

    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: "好的".to_string(),
            reasoning: String::new(), native: Vec::new(),
            tool_calls: vec![ToolInvocation {
                id: "call-gemini-0".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({"path": "a.rs"}),
            }],
        },
        AgentMessage::ToolResult {
            tool_call_id: "call-gemini-0".to_string(),
            name: "read_file".to_string(),
            content: "fn main() {}".to_string(),
        },
    ];
    let tools = vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })];
    let body = build_gemini_agent_body("gemini-3.7-flash", &messages, "系统提示", &tools);

    assert_eq!(body["systemInstruction"]["parts"][0]["text"], "系统提示");
    let contents = body["contents"].as_array().unwrap();
    assert_eq!(contents[0]["role"], "user");
    assert_eq!(contents[1]["role"], "model");
    assert_eq!(contents[1]["parts"][1]["functionCall"]["name"], "read_file");
    assert_eq!(contents[1]["parts"][1]["functionCall"]["args"]["path"], "a.rs");
    assert_eq!(contents[2]["role"], "user");
    assert_eq!(contents[2]["parts"][0]["functionResponse"]["name"], "read_file");
    assert_eq!(
        contents[2]["parts"][0]["functionResponse"]["response"]["result"],
        "fn main() {}"
    );
    assert_eq!(body["tools"][0]["functionDeclarations"][0]["name"], "read_file");
}

#[test]
fn test_gemini_function_call_extraction() {
    use yachiyo_desktop_lib::gateway::providers::gemini::extract_gemini_delta;

    let chunk = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_directory","args":{"path":"."}}}]}}]}"#;
    let delta = extract_gemini_delta(chunk).expect("should parse functionCall");
    assert_eq!(delta.tool_calls.len(), 1);
    match &delta.tool_calls[0] {
        yachiyo_desktop_lib::types::ToolCallStreamDelta::Gemini { call } => {
            assert_eq!(call.name, "list_directory");
            assert_eq!(call.arguments["path"], ".");
        }
        _ => panic!("expected Gemini delta"),
    }
}

#[tokio::test]
async fn test_approval_registry_flow() {
    use yachiyo_desktop_lib::gateway::agent::permission::{ApprovalDecision, ApprovalRegistry};

    let registry = ApprovalRegistry::new();
    let rx = registry.register("req-1");
    assert!(registry.resolve(
        "req-1",
        ApprovalDecision { approved: true, session_scope: false }
    ));
    let decision = rx.await.expect("should receive decision");
    assert!(decision.approved);
    assert!(!registry.resolve("req-1", ApprovalDecision { approved: false, session_scope: false }));
    assert!(!registry.resolve("req-404", ApprovalDecision { approved: true, session_scope: false }));
}

#[tokio::test]
async fn test_approval_registry_cancel() {
    use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;

    let registry = ApprovalRegistry::new();
    let rx = registry.register("req-2");
    registry.cancel("req-2");
    assert!(rx.await.is_err(), "cancelled receiver should error");
}

#[test]
fn test_checkpoint_backup_and_rollback() {

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    let original = "原内容 v1";
    std::fs::write(root.join("a.txt"), original).unwrap();

    let mut store = checkpoint_store(root, "run-test-1");
    assert!(store.backup_before_write("a.txt").unwrap());
    assert_eq!(store.entries().len(), 1);

    std::fs::write(root.join("a.txt"), "被改坏的内容").unwrap();

    let restored = store.rollback_all().unwrap();
    assert_eq!(restored, 1);
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), original);
}

#[test]
fn test_checkpoint_captures_new_files_and_protects_storage() {

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    let mut store = checkpoint_store(root, "run-test-2");
    assert!(store.backup_before_write("new-file.txt").unwrap());
    assert!(store.backup_before_write(".yachiyo/checkpoints/x.txt").is_err());
    assert_eq!(store.entries().len(), 1);
}

#[test]
fn test_checkpoint_does_not_modify_gitignore() {

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let mut store = checkpoint_store(root, "run-test-3");
    store.capture_turn(1).unwrap();
    assert!(!root.join(".gitignore").exists());
}

/// 脚本化执行器：按序返回预编排轮次，并记录收到的消息序列
struct ScriptedExecutor {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Mutex<Vec<Vec<AgentMessage>>>,
}

impl ScriptedExecutor {
    fn new(turns: Vec<TurnOutcome>) -> Self {
        Self { turns: Mutex::new(turns), seen: Mutex::new(Vec::new()) }
    }
}

impl TurnExecutor for ScriptedExecutor {
    fn execute(
        &self,
        messages: &[AgentMessage],
        _sink: &yachiyo_desktop_lib::gateway::agent::runtime::EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        self.seen.lock().unwrap().push(messages.to_vec());
        let next = self.turns.lock().unwrap().remove(0);
        Box::pin(async move { Ok(next) })
    }
}

fn collector() -> (yachiyo_desktop_lib::gateway::agent::runtime::EventSink, Arc<Mutex<Vec<ClientStreamEvent>>>) {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let sink: yachiyo_desktop_lib::gateway::agent::runtime::EventSink =
        Arc::new(move |emit| {
            if let LoopEmit::Event(ev) = emit {
                sink_events.lock().unwrap().push(ev);
            }
        });
    (sink, events)
}

fn read_call(id: &str, path: &str) -> TurnOutcome {
    TurnOutcome {
        reasoning: String::new(), native: Vec::new(),
        text: "我先读文件".to_string(),
        tool_calls: vec![ToolInvocation {
            id: id.to_string(),
            name: "read_file".to_string(),
            arguments: serde_json::json!({ "path": path }),
        }],
        usage: None,
    }
}

#[tokio::test]
async fn test_loop_plain_text_completion() {
    let dir = temp_workspace();
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        reasoning: String::new(), native: Vec::new(),
        text: "任务完成".to_string(),
        tool_calls: vec![],
        usage: None,
    }]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-1"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert!(events.lock().unwrap().iter().all(|ev| !matches!(ev, ClientStreamEvent::ToolCall { .. })));
    assert_eq!(executor.seen.lock().unwrap()[0].len(), 1);
}

#[tokio::test]
async fn test_loop_multi_turn_chain() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("a.txt"), "内容").unwrap();
    let executor = ScriptedExecutor::new(vec![
        read_call("call-1", "a.txt"),
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "读完了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-2"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "读 a.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let all = events.lock().unwrap();
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::ToolCall { name, .. } if name == "read_file")));
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::ToolResult { is_error: false, .. })));
    let second = &executor.seen.lock().unwrap()[1];
    assert_eq!(second.len(), 3);
    assert!(matches!(&second[2], AgentMessage::ToolResult { content, .. } if content.contains("内容")));
}

fn tool_call(id: &str, name: &str, arguments: serde_json::Value) -> ToolInvocation {
    ToolInvocation { id: id.to_string(), name: name.to_string(), arguments }
}

fn tool_event_order(events: &[ClientStreamEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|ev| match ev {
            ClientStreamEvent::ToolCall { id, .. } => Some(format!("call:{id}")),
            ClientStreamEvent::ToolResult { id, .. } => Some(format!("result:{id}")),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn test_loop_runs_independent_reads_concurrently_in_call_order() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("a.txt"), "甲").unwrap();
    std::fs::write(dir.path().join("b.txt"), "乙").unwrap();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: String::new(),
            tool_calls: vec![
                tool_call("call-a", "read_file", serde_json::json!({ "path": "a.txt" })),
                tool_call("call-b", "read_file", serde_json::json!({ "path": "b.txt" })),
                tool_call("call-ls", "list_directory", serde_json::json!({ "path": "." })),
            ],
            usage: None,
        },
        done_turn("读完了"),
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-concurrent"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "读两个文件".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    // 整段先全部标为执行中，再按调用顺序回填结果
    assert_eq!(
        tool_event_order(&events.lock().unwrap()),
        ["call:call-a", "call:call-b", "call:call-ls", "result:call-a", "result:call-b", "result:call-ls"]
    );
    let second = &executor.seen.lock().unwrap()[1];
    assert_eq!(second.len(), 5);
    assert!(matches!(&second[2], AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "call-a" && content.contains('甲')));
    assert!(matches!(&second[3], AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "call-b" && content.contains('乙')));
    assert!(matches!(&second[4], AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "call-ls" && content.contains("a.txt")));
}

#[tokio::test]
async fn test_loop_reads_after_write_in_same_turn_see_new_content() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("a.txt"), "甲").unwrap();
    std::fs::write(dir.path().join("b.txt"), "乙").unwrap();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: String::new(),
            tool_calls: vec![
                tool_call("read-1", "read_file", serde_json::json!({ "path": "a.txt" })),
                tool_call("edit", "edit_file", serde_json::json!({ "path": "a.txt", "old_string": "甲", "new_string": "丙" })),
                tool_call("read-2", "read_file", serde_json::json!({ "path": "a.txt" })),
                tool_call("read-3", "read_file", serde_json::json!({ "path": "b.txt" })),
            ],
            usage: None,
        },
        done_turn("改好了"),
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-write-barrier"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();
    let mut config = AgentLoopConfig::default();
    config.execution_mode = AgentExecutionMode::FullAuto;

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "改 a.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        config,
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    // 写操作是并发段的边界：之前的读取先完成，之后的读取等写入落地再一起并发
    assert_eq!(
        tool_event_order(&events.lock().unwrap()),
        ["call:read-1", "result:read-1", "call:edit", "result:edit", "call:read-2", "call:read-3", "result:read-2", "result:read-3"]
    );
    let second = &executor.seen.lock().unwrap()[1];
    assert!(matches!(&second[3], AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "edit" && !content.contains("FS_")));
    assert!(matches!(&second[4], AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "read-2" && content.contains('丙')));
    assert!(matches!(&second[5], AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "read-3" && content.contains('乙')));
}

#[tokio::test]
async fn test_loop_carries_turn_reasoning_into_next_request() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("a.txt"), "内容").unwrap();
    let mut first = read_call("call-1", "a.txt");
    first.reasoning = "先读文件确认现状".to_string();
    first.native = vec![serde_json::json!({ "type": "thinking", "thinking": "", "signature": "sig-1" })];
    let executor = ScriptedExecutor::new(vec![
        first,
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "读完了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-reasoning"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    run_agent_loop(
        vec![AgentMessage::User { text: "读 a.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();

    let second = &executor.seen.lock().unwrap()[1];
    assert!(matches!(&second[1], AgentMessage::Assistant { reasoning, .. } if reasoning == "先读文件确认现状"));
    assert!(matches!(&second[1], AgentMessage::Assistant { native, .. } if native.len() == 1 && native[0]["signature"] == "sig-1"));
}

#[tokio::test]
async fn test_loop_write_permission_denied() {
    let dir = temp_workspace();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: "我要写文件".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "call-w".to_string(),
                name: "write_file".to_string(),
                arguments: serde_json::json!({ "path": "out.txt", "content": "x" }),
            }],
            usage: None,
        },
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "好的，那我不写了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = Arc::new(ApprovalRegistry::new());
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-3"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let gate_ref = Arc::clone(&gate);
    let handle = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        gate_ref.resolve("run-3-call-w", ApprovalDecision { approved: false, session_scope: false });
    });

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写 out.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();
    handle.abort();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let all = events.lock().unwrap();
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::PermissionRequest { .. })));
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::ToolResult { is_error: true, .. })));
    assert!(!dir.path().join("out.txt").exists());
}

#[tokio::test]
async fn test_loop_remembered_file_permission_does_not_approve_other_paths() {
    let dir = temp_workspace();
    let write_call = |id: &str| TurnOutcome {
        reasoning: String::new(), native: Vec::new(),
        text: "写".to_string(),
        tool_calls: vec![ToolInvocation {
            id: id.to_string(),
            name: "write_file".to_string(),
            arguments: serde_json::json!({ "path": format!("{}.txt", id), "content": "x" }),
        }],
        usage: None,
    };
    let executor = ScriptedExecutor::new(vec![
        write_call("w1"),
        write_call("w2"),
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "完成".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = Arc::new(ApprovalRegistry::new());
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-4"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let gate_ref = Arc::clone(&gate);
    let approver = tokio::spawn(async move {
        for _ in 0..2 {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            gate_ref.resolve("run-4-w1", ApprovalDecision { approved: true, session_scope: true });
            gate_ref.resolve("run-4-w2", ApprovalDecision { approved: true, session_scope: true });
        }
    });

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写两个文件".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();
    approver.abort();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let all = events.lock().unwrap();
    let permission_count = all
        .iter()
        .filter(|ev| matches!(ev, ClientStreamEvent::PermissionRequest { .. }))
        .count();
    assert_eq!(permission_count, 2, "批准某文件不应放行其他文件路径");
    assert!(dir.path().join("w1.txt").exists());
    assert!(dir.path().join("w2.txt").exists());
}

#[tokio::test]
async fn test_loop_permission_timeout_treated_as_denied() {
    let dir = temp_workspace();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: "写".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "w1".to_string(),
                name: "write_file".to_string(),
                arguments: serde_json::json!({ "path": "t.txt", "content": "x" }),
            }],
            usage: None,
        },
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "超时了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-5"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig { max_turns: Some(12), permission_timeout_secs: 1, ..AgentLoopConfig::default() },
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert!(events.lock().unwrap().iter().any(|ev| matches!(ev, ClientStreamEvent::ToolResult { is_error: true, .. })));
    assert!(!dir.path().join("t.txt").exists());
}

#[tokio::test]
async fn test_loop_cancel_between_turns() {
    let dir = temp_workspace();
    let executor = ScriptedExecutor::new(vec![read_call("c1", ".")]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-6"));
    let cancelled = AtomicBool::new(true);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "列目录".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::Cancelled { .. }));
}

#[tokio::test]
async fn test_loop_usage_accumulates() {
    let dir = temp_workspace();
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        reasoning: String::new(), native: Vec::new(),
        text: "a".to_string(),
        tool_calls: vec![],
        usage: Some(TokenUsage {
            prompt_tokens: Some(10),
            completion_tokens: Some(5),
            total_tokens: Some(15),
            ..Default::default()
        }),
    }]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = Some(checkpoint_store(dir.path(), "run-7"));
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        Some(dir.path()),
        &http,
    )
    .await
    .unwrap();
    match outcome {
        LoopOutcome::Completed { usage } => assert_eq!(usage.total_tokens, Some(15)),
        _ => panic!("expected Completed"),
    }
}

#[tokio::test]
async fn test_loop_without_workspace_plain_completion() {
    // 无工作区时（无项目），模型直接输出文本回答（如“你能长任务运行吗”），Agent 模式应平滑完成
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        reasoning: String::new(), native: Vec::new(),
        text: "我当然可以帮你执行长任务啦～".to_string(),
        tool_calls: vec![],
        usage: Some(TokenUsage {
            prompt_tokens: Some(20),
            completion_tokens: Some(15),
            total_tokens: Some(35),
            ..Default::default()
        }),
    }]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = None;
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "你能长任务运行吗".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        None,
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let evs = events.lock().unwrap();
    assert!(evs.iter().any(|ev| matches!(ev, ClientStreamEvent::Turn { index: 1, .. })));
    assert!(evs.iter().all(|ev| !matches!(ev, ClientStreamEvent::ToolCall { .. })));
}

#[tokio::test]
async fn test_loop_without_workspace_tool_interception() {
    // 无工作区时相对路径落在临时项目中，读取不存在的文件应安全返回工具错误，而不是导致系统崩溃
    let executor = ScriptedExecutor::new(vec![
        read_call("call-no-ws", "yachiyo-missing/package.json"),
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: "彩叶，请先在上方打开工作区文件夹哦～".to_string(),
            tool_calls: vec![],
            usage: None,
        },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = None;
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "读 package.json".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        None,
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let evs = events.lock().unwrap();
    let has_tool_err = evs.iter().any(|ev| match ev {
        ClientStreamEvent::ToolResult { is_error, output, .. } => {
            *is_error && output.contains("package.json")
        }
        _ => false,
    });
    assert!(has_tool_err, "无工作区时读取临时项目中不存在的文件应安全返回错误");
}

#[tokio::test]
async fn test_loop_without_workspace_run_command_allowed_in_full_auto() {
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: "我来查看系统状态～".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "cmd1".to_string(),
                name: "run_command".to_string(),
                arguments: serde_json::json!({ "command": "echo 'system check ok'" }),
            }],
            usage: None,
        },
        TurnOutcome {
            reasoning: String::new(), native: Vec::new(),
            text: "系统检查完成啦！".to_string(),
            tool_calls: vec![],
            usage: None,
        },
    ]);
    let (sink, events) = collector();
    let gate = Arc::new(ApprovalRegistry::new());
    let mut checkpoint = None;
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let mut config = AgentLoopConfig::default();
    config.execution_mode = AgentExecutionMode::FullAuto;

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "帮我看看系统".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        config,
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        None,
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let evs = events.lock().unwrap();
    let has_tool_success = evs.iter().any(|ev| match ev {
        ClientStreamEvent::ToolResult { is_error, output, .. } => {
            !*is_error && output.contains("system check ok")
        }
        _ => false,
    });
    assert!(has_tool_success, "无工作区全自动模式下应允许直接执行系统命令并获得输出");
}


fn read_tools() -> Vec<serde_json::Value> {
    vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })]
}

#[test]
fn test_anthropic_agent_body_replays_native_blocks_with_caching() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::build_anthropic_agent_body;

    let native = vec![
        serde_json::json!({ "type": "thinking", "thinking": "先看文件", "signature": "sig-1" }),
        serde_json::json!({ "type": "tool_use", "id": "toolu_1", "name": "read_file", "input": { "path": "a.rs" } }),
    ];
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: String::new(),
            reasoning: String::new(),
            tool_calls: vec![ToolInvocation {
                id: "toolu_1".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({ "path": "a.rs" }),
            }],
            native: native.clone(),
        },
        AgentMessage::ToolResult { tool_call_id: "toolu_1".to_string(), name: "read_file".to_string(), content: "fn main() {}".to_string() },
    ];
    let body = build_anthropic_agent_body("claude-opus-5-5", &messages, "角色设定\n\n<runtime>\n时间\n</runtime>", &read_tools());

    assert_eq!(body["messages"][1]["content"], serde_json::Value::Array(native));
    assert_eq!(body["cache_control"]["type"], "ephemeral");
    assert_eq!(body["system"][0]["text"], "角色设定");
    assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(body["system"][1]["text"], "<runtime>\n时间\n</runtime>");
    assert_eq!(body["max_tokens"], 64_000);
    assert_eq!(body["thinking"], serde_json::json!({ "type": "adaptive", "display": "summarized" }));
    assert!(body.get("output_config").is_none());
    assert_eq!(body["fallbacks"], "default");

    let legacy = build_anthropic_agent_body("claude-haiku-4-5", &messages, "系统提示", &read_tools());
    assert!(legacy.get("thinking").is_none());
    assert!(legacy.get("fallbacks").is_none());
}

#[test]
fn test_anthropic_turn_collector_rebuilds_blocks_and_drops_pre_fallback_reasoning() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::AnthropicTurnCollector;

    let mut collector = AnthropicTurnCollector::new();
    for event in [
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先读"}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"我看看"}}"#,
        r#"{"type":"content_block_stop","index":1}"#,
        r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}"#,
        r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#,
        r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\"a.rs\"}"}}"#,
        r#"{"type":"content_block_stop","index":2}"#,
    ] {
        collector.push(event);
    }
    let (blocks, calls) = collector.finish();
    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0], serde_json::json!({ "type": "thinking", "thinking": "先读", "signature": "sig-1" }));
    assert_eq!(blocks[1]["text"], "我看看");
    assert_eq!(blocks[2]["input"]["path"], "a.rs");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "toolu_1");
    assert_eq!(calls[0].arguments["path"], "a.rs");

    let mut collector = AnthropicTurnCollector::new();
    for event in [
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig-0"}}"#,
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":"部分回答"}}"#,
        r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_0","name":"read_file","input":{}}}"#,
        r#"{"type":"content_block_start","index":3,"content_block":{"type":"fallback","from":{"model":"claude-opus-5-5"},"to":{"model":"claude-opus-4-8"}}}"#,
        r#"{"type":"content_block_stop","index":3}"#,
        r#"{"type":"content_block_start","index":4,"content_block":{"type":"text","text":"续写"}}"#,
    ] {
        collector.push(event);
    }
    let (blocks, calls) = collector.finish();
    assert_eq!(blocks, vec![
        serde_json::json!({ "type": "text", "text": "部分回答" }),
        serde_json::json!({ "type": "text", "text": "续写" }),
    ]);
    assert!(calls.is_empty());
}

#[test]
fn test_gemini_turn_collector_keeps_function_call_signatures() {
    use yachiyo_desktop_lib::gateway::providers::gemini::{build_gemini_agent_body, GeminiTurnCollector};

    let mut collector = GeminiTurnCollector::new();
    collector.push(r#"{"candidates":[{"content":{"parts":[{"text":"思考摘要","thought":true}]}}]}"#);
    collector.push(r#"{"candidates":[{"content":{"parts":[{"text":"我先"}]}}]}"#);
    collector.push(r#"{"candidates":[{"content":{"parts":[{"text":"看看"},{"functionCall":{"name":"read_file","args":{"path":"a.rs"}},"thoughtSignature":"sig-g"}]}}]}"#);
    let parts = collector.finish();
    assert_eq!(parts, vec![
        serde_json::json!({ "text": "我先看看" }),
        serde_json::json!({ "functionCall": { "name": "read_file", "args": { "path": "a.rs" } }, "thoughtSignature": "sig-g" }),
    ]);

    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: "我先看看".to_string(), reasoning: String::new(), tool_calls: vec![], native: parts.clone() },
    ];
    let body = build_gemini_agent_body("gemini-3.8-flash", &messages, "系统提示", &read_tools());
    assert_eq!(body["contents"][1]["parts"], serde_json::Value::Array(parts));
    assert_eq!(body["generationConfig"]["thinkingConfig"]["includeThoughts"], true);
}

#[test]
fn test_openai_responses_agent_body_maps_history_and_replays_items() {
    use yachiyo_desktop_lib::gateway::providers::openai_responses::build_openai_responses_agent_body;

    let reasoning_item = serde_json::json!({ "type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "enc" });
    let call_item = serde_json::json!({ "type": "function_call", "id": "fc_1", "call_id": "call_2", "name": "read_file", "arguments": "{\"path\":\"b.rs\"}" });
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: Some("data:image/png;base64,AAAA".to_string()) },
        // 客户端重放的历史轮次没有原生输出项，按 function_call 重建
        AgentMessage::Assistant {
            text: "好的".to_string(),
            reasoning: String::new(),
            tool_calls: vec![ToolInvocation { id: "call_1".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({ "path": "a.rs" }) }],
            native: Vec::new(),
        },
        AgentMessage::ToolResult { tool_call_id: "call_1".to_string(), name: "read_file".to_string(), content: "旧".to_string() },
        AgentMessage::Assistant {
            text: String::new(),
            reasoning: String::new(),
            tool_calls: vec![],
            native: vec![reasoning_item.clone(), call_item.clone()],
        },
        AgentMessage::ToolResult { tool_call_id: "call_2".to_string(), name: "read_file".to_string(), content: "新".to_string() },
    ];
    let body = build_openai_responses_agent_body("gpt-6.1-sol", &messages, "系统提示", &read_tools());

    assert_eq!(body["instructions"], "系统提示");
    assert_eq!(body["store"], false);
    assert_eq!(body["include"], serde_json::json!(["reasoning.encrypted_content"]));
    assert_eq!(body["tools"][0], serde_json::json!({ "type": "function", "name": "read_file", "description": "read", "parameters": { "type": "object", "properties": {} } }));
    let input = body["input"].as_array().unwrap();
    assert_eq!(input[0]["content"][1], serde_json::json!({ "type": "input_image", "image_url": "data:image/png;base64,AAAA" }));
    assert_eq!(input[1], serde_json::json!({ "role": "assistant", "content": "好的" }));
    assert_eq!(input[2], serde_json::json!({ "type": "function_call", "call_id": "call_1", "name": "read_file", "arguments": "{\"path\":\"a.rs\"}" }));
    assert_eq!(input[3], serde_json::json!({ "type": "function_call_output", "call_id": "call_1", "output": "旧" }));
    assert_eq!(input[4], reasoning_item);
    assert_eq!(input[5], call_item);
    assert_eq!(input[6]["call_id"], "call_2");

    let legacy = build_openai_responses_agent_body("gpt-4.1", &messages, "系统提示", &read_tools());
    assert!(legacy.get("include").is_none());
}

#[test]
fn test_openai_responses_stream_extraction_and_collection() {
    use yachiyo_desktop_lib::gateway::providers::openai_responses::{extract_openai_responses_delta, ResponsesTurnCollector};

    let events = [
        r#"{"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[]}}"#,
        r#"{"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[],"encrypted_content":"enc"}}"#,
        r#"{"type":"response.output_text.delta","output_index":1,"delta":"我先读"}"#,
        r#"{"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":""}}"#,
        r#"{"type":"response.function_call_arguments.delta","output_index":2,"item_id":"fc_1","delta":"{\"path\":"}"#,
        r#"{"type":"response.function_call_arguments.delta","output_index":2,"item_id":"fc_1","delta":"\"a.rs\"}"}"#,
        r#"{"type":"response.output_item.done","output_index":2,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":"{\"path\":\"a.rs\"}"}}"#,
        r#"{"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":30,"total_tokens":150}}}"#,
    ];
    let mut agg = ToolCallAggregator::new();
    let mut collector = ResponsesTurnCollector::new();
    let mut text = String::new();
    let mut usage = None;
    for event in events {
        collector.push(event);
        if let Some(delta) = extract_openai_responses_delta(event) {
            if let Some(content) = delta.content { text.push_str(&content); }
            if delta.usage.is_some() { usage = delta.usage; }
            for tc in &delta.tool_calls { agg.push(tc); }
        }
    }
    assert_eq!(text, "我先读");
    assert_eq!(usage.and_then(|u| u.total_tokens), Some(150));
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call_1");
    assert_eq!(calls[0].arguments["path"], "a.rs");
    let items = collector.finish().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["encrypted_content"], "enc");
    assert_eq!(items[1]["call_id"], "call_1");

    let mut failed = ResponsesTurnCollector::new();
    failed.push(r#"{"type":"response.failed","response":{"error":{"code":"server_error","message":"boom"}}}"#);
    assert!(failed.finish().is_err());
}

#[test]
fn test_glm_agent_body_enables_preserved_thinking() {
    let call = ToolInvocation { id: "call-1".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({ "path": "a.rs" }) };
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: "上一轮".to_string(), reasoning: String::new(), tool_calls: vec![], native: Vec::new() },
        AgentMessage::User { text: "再读".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: String::new(), reasoning: "需要读取".to_string(), tool_calls: vec![call], native: Vec::new() },
        AgentMessage::ToolResult { tool_call_id: "call-1".to_string(), name: "read_file".to_string(), content: "内容".to_string() },
    ];
    let body = build_openai_agent_body(ProviderId::Glm, None, "glm-5.3", &messages, "系统提示", &[]);
    assert_eq!(body["thinking"], serde_json::json!({ "type": "enabled", "clear_thinking": false }));
    let msgs = body["messages"].as_array().unwrap();
    assert!(msgs[2].get("reasoning_content").is_none());
    assert_eq!(msgs[4]["reasoning_content"], "需要读取");

    let hybrid = build_openai_agent_body(ProviderId::Glm, None, "glm-4.6", &messages, "系统提示", &[]);
    assert!(hybrid.get("thinking").is_none());
    assert!(hybrid["messages"][4].get("reasoning_content").is_none());
}

#[test]
fn test_third_party_agent_bodies_replay_reasoning_per_vendor() {
    let call = ToolInvocation { id: "call-1".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({ "path": "a.rs" }) };
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: "上一轮".to_string(), reasoning: String::new(), tool_calls: vec![], native: Vec::new() },
        AgentMessage::User { text: "再读".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: String::new(), reasoning: "需要读取".to_string(), tool_calls: vec![call], native: Vec::new() },
        AgentMessage::ToolResult { tool_call_id: "call-1".to_string(), name: "read_file".to_string(), content: "内容".to_string() },
    ];

    let kimi = build_openai_agent_body(ProviderId::Openai, Some("https://api.moonshot.cn/v1"), "kimi-k3", &messages, "系统提示", &[]);
    assert_eq!(kimi["messages"][2]["reasoning_content"], "");
    assert_eq!(kimi["messages"][4]["reasoning_content"], "需要读取");
    assert!(kimi.get("reasoning_effort").is_none());

    let qwen = build_openai_agent_body(ProviderId::Openai, Some("https://dashscope.aliyuncs.com/compatible-mode/v1"), "qwen3.8-flash", &messages, "系统提示", &[]);
    assert!(qwen["messages"][2].get("reasoning_content").is_none());
    assert_eq!(qwen["messages"][4]["reasoning_content"], "需要读取");

    let minimax = build_openai_agent_body(ProviderId::Openai, Some("https://api.minimax.io/v1"), "MiniMax-M3", &messages, "系统提示", &[]);
    assert_eq!(minimax["reasoning_split"], true);
    assert!(minimax["messages"][2].get("reasoning_details").is_none());
    assert_eq!(minimax["messages"][4]["reasoning_details"][0]["text"], "需要读取");
    assert_eq!(minimax["messages"][4]["reasoning_details"][0]["format"], "MiniMax-response-v1");
    assert!(minimax["messages"][4].get("reasoning_content").is_none());

    let plain = build_openai_agent_body(ProviderId::Openai, Some("https://example.com/v1"), "kimi-k3", &messages, "系统提示", &[]);
    assert!(plain["messages"][4].get("reasoning_content").is_none());
}

#[test]
fn test_wire_protocol_uses_chat_completions_for_custom_openai_endpoints() {
    use yachiyo_desktop_lib::gateway::agent::runtime::WireProtocol;

    assert_eq!(WireProtocol::resolve(ProviderId::Openai, None), WireProtocol::Responses);
    assert_eq!(WireProtocol::resolve(ProviderId::Openai, Some("https://api.moonshot.cn/v1")), WireProtocol::ChatCompletions);
    assert_eq!(WireProtocol::resolve(ProviderId::Deepseek, None), WireProtocol::ChatCompletions);
    assert_eq!(WireProtocol::resolve(ProviderId::Claude, None), WireProtocol::Anthropic);
    assert_eq!(WireProtocol::resolve(ProviderId::Gemini, None), WireProtocol::Gemini);
}

fn done_turn(text: &str) -> TurnOutcome {
    TurnOutcome { reasoning: String::new(), native: Vec::new(), text: text.to_string(), tool_calls: vec![], usage: None }
}

#[tokio::test]
async fn test_loop_has_no_turn_cap_while_making_progress() {
    let dir = temp_workspace();
    let mut turns: Vec<TurnOutcome> = (0..20).map(|i| read_call(&format!("call-{i}"), &format!("file-{i}.txt"))).collect();
    turns.push(done_turn("读完了"));
    let executor = ScriptedExecutor::new(turns);
    let (sink, _events) = collector();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "逐个读".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &ApprovalRegistry::new(),
        &mut None,
        &AtomicBool::new(false),
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert_eq!(executor.seen.lock().unwrap().len(), 21);
}

#[tokio::test]
async fn test_identical_tool_turns_are_nudged_then_stopped() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("a.txt"), "内容").unwrap();
    let turns: Vec<TurnOutcome> = (0..10).map(|i| read_call(&format!("call-{i}"), "a.txt")).collect();
    let executor = ScriptedExecutor::new(turns);
    let (sink, _events) = collector();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "读 a.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &ApprovalRegistry::new(),
        &mut None,
        &AtomicBool::new(false),
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::LoopDetected { .. }));
    let seen = executor.seen.lock().unwrap();
    // 第 3 轮后提醒、计数清零，再重复 3 轮后停止
    assert_eq!(seen.len(), 6);
    let nudged = seen[3].iter().any(|message| matches!(message, AgentMessage::ToolResult { content, .. } if content.contains("[循环提醒]")));
    assert!(nudged, "第 4 次请求应带上循环提醒");
    assert!(!seen[2].iter().any(|message| matches!(message, AgentMessage::ToolResult { content, .. } if content.contains("[循环提醒]"))));
}

struct RepetitionExecutor;

impl TurnExecutor for RepetitionExecutor {
    fn execute(
        &self,
        _messages: &[AgentMessage],
        _sink: &yachiyo_desktop_lib::gateway::agent::runtime::EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        Box::pin(async { Err(yachiyo_desktop_lib::gateway::agent::loop_guard::REPETITION_LOOP_DETECTED.to_string()) })
    }
}

#[tokio::test]
async fn test_stream_repetition_ends_the_run_as_loop_detected() {
    let (sink, _events) = collector();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &RepetitionExecutor,
        &ApprovalRegistry::new(),
        &mut None,
        &AtomicBool::new(false),
        &sink,
        None,
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::LoopDetected { .. }));
}

/// 模拟一轮迟迟不结束的上游请求（长时间思考或超长输出），记录其 Future 是否被丢弃
struct HangingExecutor {
    dropped: Arc<AtomicBool>,
}

struct DropFlag(Arc<AtomicBool>);

impl Drop for DropFlag {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl TurnExecutor for HangingExecutor {
    fn execute(
        &self,
        _messages: &[AgentMessage],
        _sink: &yachiyo_desktop_lib::gateway::agent::runtime::EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let flag = DropFlag(Arc::clone(&self.dropped));
        Box::pin(async move {
            let _flag = flag;
            futures::future::pending::<Result<TurnOutcome, String>>().await
        })
    }
}

#[tokio::test]
async fn test_cancel_drops_in_flight_upstream_turn() {
    let (sink, _events) = collector();
    let dropped = Arc::new(AtomicBool::new(false));
    let executor = HangingExecutor { dropped: Arc::clone(&dropped) };
    let cancelled = Arc::new(AtomicBool::new(false));
    let trigger = Arc::clone(&cancelled);
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        trigger.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        run_agent_loop(
            vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
            get_agent_tools_schema(),
            AgentLoopConfig::default(),
            &executor,
            &ApprovalRegistry::new(),
            &mut None,
            &cancelled,
            &sink,
            None,
            &reqwest::Client::new(),
        ),
    )
    .await
    .expect("取消后应立即结束，而不是等上游这一轮跑完")
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::Cancelled { .. }));
    assert!(dropped.load(std::sync::atomic::Ordering::SeqCst), "进行中的上游请求 Future 必须被丢弃以断开连接");
}

#[test]
fn test_tool_loop_detector_catches_short_cycles_only() {
    use yachiyo_desktop_lib::gateway::agent::loop_guard::{ToolLoopDetector, ToolLoopVerdict};

    let call = |path: &str| vec![ToolInvocation { id: "x".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({ "path": path }) }];
    let mut detector = ToolLoopDetector::default();
    let output = |text: &str| vec![text.to_string()];
    // A、B 两步交替且结果不变：第 3 个周期结束时判定为循环
    let sequence = ["a", "b", "a", "b", "a"];
    for path in sequence {
        assert_eq!(detector.record(&call(path), &output(path)), ToolLoopVerdict::Progressing);
    }
    assert_eq!(detector.record(&call("b"), &output("b")), ToolLoopVerdict::Nudge);

    // 调用相同但结果在变（轮询）时放宽到 5 次
    let mut polling = ToolLoopDetector::default();
    for round in 0..4 {
        assert_eq!(polling.record(&call("status"), &output(&format!("第 {round} 次"))), ToolLoopVerdict::Progressing);
    }
    assert_eq!(polling.record(&call("status"), &output("第 4 次")), ToolLoopVerdict::Nudge);
}

#[test]
fn test_repetition_detector_flags_degenerate_output_only() {
    use yachiyo_desktop_lib::gateway::agent::loop_guard::RepetitionDetector;

    let mut looping = RepetitionDetector::default();
    let sentence = "我需要再检查一下这个文件的内容，确认配置项是否正确。";
    let tripped = (0..40).any(|_| looping.push(sentence));
    assert!(tripped);

    let mut normal = RepetitionDetector::default();
    let tripped = (0..400).any(|i| normal.push(&format!("第 {i} 步：读取模块 {} 并记录它导出的接口。", i * 7)));
    assert!(!tripped);

    let mut divider = RepetitionDetector::default();
    assert!(!(0..200).any(|_| divider.push("==========\n")));

    // 不同字符很少的短周期复读不满足样本规则，靠末尾的严格周期规则兜住
    let mut short_period = RepetitionDetector::default();
    assert!(!(0..300).any(|_| short_period.push("好的")));
    assert!((0..2000).any(|_| short_period.push("好的")));
}

#[test]
fn test_ark_agent_body_replays_encrypted_thinking_within_the_run() {
    let call = ToolInvocation { id: "call-1".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({ "path": "a.rs" }) };
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: String::new(), reasoning: "思考摘要".to_string(), tool_calls: vec![call.clone()], native: vec![serde_json::json!({ "encrypted_content": "密文-abc" })] },
        AgentMessage::ToolResult { tool_call_id: "call-1".to_string(), name: "read_file".to_string(), content: "内容".to_string() },
    ];
    let ark = build_openai_agent_body(ProviderId::Openai, Some("https://ark.cn-beijing.volces.com/api/v3"), "doubao-seed-2-1-pro-260915", &messages, "系统提示", &[]);
    assert_eq!(ark["messages"][2]["encrypted_content"], "密文-abc");
    assert_eq!(ark["messages"][2]["reasoning_content"], "思考摘要");

    // 其他厂商不带加密块；客户端重放的历史没有 native，也不带
    let other = build_openai_agent_body(ProviderId::Openai, Some("https://api.moonshot.cn/v1"), "kimi-k3", &messages, "系统提示", &[]);
    assert!(other["messages"][2].get("encrypted_content").is_none());
    let replayed = vec![
        AgentMessage::User { text: "x".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: String::new(), reasoning: String::new(), tool_calls: vec![call], native: Vec::new() },
    ];
    let body = build_openai_agent_body(ProviderId::Openai, Some("https://ark.cn-beijing.volces.com/api/v3"), "doubao-seed-2-1-pro-260915", &replayed, "系统提示", &[]);
    assert!(body["messages"][2].get("encrypted_content").is_none());
}

#[test]
fn test_hunyuan_and_qianfan_agent_bodies_replay_non_empty_reasoning() {
    let call = ToolInvocation { id: "call-1".to_string(), name: "read_file".to_string(), arguments: serde_json::json!({}) };
    let messages = vec![
        AgentMessage::User { text: "读".to_string(), image_data_url: None },
        AgentMessage::Assistant { text: String::new(), reasoning: "需要读取".to_string(), tool_calls: vec![call.clone()], native: Vec::new() },
        AgentMessage::ToolResult { tool_call_id: "call-1".to_string(), name: "read_file".to_string(), content: "内容".to_string() },
        AgentMessage::Assistant { text: String::new(), reasoning: String::new(), tool_calls: vec![call], native: Vec::new() },
    ];
    for (url, model) in [("https://tokenhub.tencentmaas.com/v1", "hy3"), ("https://qianfan.baidubce.com/v2", "ernie-5.1")] {
        let body = build_openai_agent_body(ProviderId::Openai, Some(url), model, &messages, "系统提示", &[]);
        assert_eq!(body["messages"][2]["reasoning_content"], "需要读取", "{model}");
        assert!(body["messages"][4].get("reasoning_content").is_none(), "{model}");
    }
}

#[test]
fn screenshot_messages_keep_only_the_latest_image() {
    use yachiyo_desktop_lib::gateway::agent::runtime::{attach_screenshot, SCREENSHOT_MESSAGE};
    let mut messages = vec![AgentMessage::User { text: "看看游戏".to_string(), image_data_url: None }];
    attach_screenshot(&mut messages, "data:image/png;base64,AAAA".to_string());
    attach_screenshot(&mut messages, "data:image/png;base64,BBBB".to_string());
    let images: Vec<Option<&str>> = messages
        .iter()
        .map(|message| match message {
            AgentMessage::User { image_data_url, .. } => image_data_url.as_deref(),
            _ => None,
        })
        .collect();
    assert_eq!(images, vec![None, None, Some("data:image/png;base64,BBBB")]);
    assert!(matches!(&messages[1], AgentMessage::User { text, .. } if text.starts_with(SCREENSHOT_MESSAGE) && text.contains("已省略")));
}

#[test]
fn anthropic_merges_screenshot_into_tool_result_turn() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::build_anthropic_agent_body;
    let messages = vec![
        AgentMessage::User { text: "看看画面".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: String::new(),
            reasoning: String::new(),
            tool_calls: vec![ToolInvocation { id: "c1".to_string(), name: "mcp__windows_mcp__look".to_string(), arguments: serde_json::json!({}) }],
            native: Vec::new(),
        },
        AgentMessage::ToolResult { tool_call_id: "c1".to_string(), name: "mcp__windows_mcp__look".to_string(), content: "已截取".to_string() },
        AgentMessage::User { text: "【系统附图】".to_string(), image_data_url: Some("data:image/png;base64,AAAA".to_string()) },
    ];
    let body = build_anthropic_agent_body("claude-sonnet-5-5", &messages, "system", &[]);
    let turns = body["messages"].as_array().unwrap();
    assert_eq!(turns.len(), 3, "截图并入工具结果所在的用户消息");
    let last = turns[2]["content"].as_array().unwrap();
    assert_eq!(last[0]["type"], "tool_result");
    assert_eq!(last.last().unwrap()["type"], "image");
}

/// 本地假上游：带 reasoning_effort 的请求返回 400，其余返回一段正常的流式回复；记录每次请求体
async fn effort_rejecting_upstream() -> (String, Arc<Mutex<Vec<serde_json::Value>>>) {
    use axum::{body::Body, extract::State, http::StatusCode, response::Response, routing::post, Json, Router};
    let seen: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
    async fn handle(State(seen): State<Arc<Mutex<Vec<serde_json::Value>>>>, Json(body): Json<serde_json::Value>) -> Response {
        let rejected = body.get("reasoning_effort").is_some();
        seen.lock().unwrap().push(body);
        if rejected {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from(r#"{"error":{"message":"Unsupported value: reasoning_effort"}}"#))
                .unwrap();
        }
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"好的\"}}]}\n\ndata: [DONE]\n\n";
        Response::builder().header("content-type", "text/event-stream").body(Body::from(sse)).unwrap()
    }
    let app = Router::new().route("/chat/completions", post(handle)).with_state(Arc::clone(&seen));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), seen)
}

#[tokio::test]
async fn test_rejected_reasoning_effort_retries_without_it_and_notifies() {
    use yachiyo_desktop_lib::gateway::agent::runtime::{HttpTurnExecutor, NOTICE_REASONING_EFFORT_REJECTED};

    let (base_url, seen) = effort_rejecting_upstream().await;
    let executor = HttpTurnExecutor {
        client: reqwest::Client::new(),
        fallback_client: None,
        provider_id: ProviderId::Openai,
        base_url: Some(base_url),
        api_key: "test-key".to_string(),
        model: "test-model".to_string(),
        system_prompt: "system".to_string(),
        tools_schema: Vec::new(),
        reasoning_effort: Some("max"),
        effort_rejected: Arc::new(AtomicBool::new(false)),
        custom_model: None,
    };
    let (sink, events) = collector();
    let messages = vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }];

    let outcome = executor.execute(&messages, &sink).await.expect("档位被拒后应去掉强度字段重发成功");
    assert_eq!(outcome.text, "好的");
    assert!(events.lock().unwrap().iter().any(|event| matches!(event,
        ClientStreamEvent::Notice { code } if code == NOTICE_REASONING_EFFORT_REJECTED)));
    {
        let requests = seen.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0]["reasoning_effort"], "max");
        assert!(requests[1].get("reasoning_effort").is_none());
    }

    // 同一运行的后续轮次不再携带被拒的档位，也不再重复提示
    events.lock().unwrap().clear();
    executor.execute(&messages, &sink).await.unwrap();
    assert_eq!(seen.lock().unwrap().len(), 3);
    assert!(seen.lock().unwrap()[2].get("reasoning_effort").is_none());
    assert!(events.lock().unwrap().iter().all(|event| !matches!(event, ClientStreamEvent::Notice { .. })));
}

struct TruncatedExecutor;

impl TurnExecutor for TruncatedExecutor {
    fn execute(
        &self,
        _messages: &[AgentMessage],
        _sink: &yachiyo_desktop_lib::gateway::agent::runtime::EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        Box::pin(async { Err(yachiyo_desktop_lib::gateway::agent::runtime::OUTPUT_TRUNCATED.to_string()) })
    }
}

#[tokio::test]
async fn test_truncated_turn_ends_the_run_as_truncated() {
    let (sink, _events) = collector();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &TruncatedExecutor,
        &ApprovalRegistry::new(),
        &mut None,
        &AtomicBool::new(false),
        &sink,
        None,
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::Truncated { .. }));
}

#[test]
fn test_output_limit_stop_detection_per_protocol() {
    use yachiyo_desktop_lib::gateway::agent::runtime::{is_output_limit_stop, WireProtocol};

    assert!(is_output_limit_stop(WireProtocol::ChatCompletions, r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#));
    assert!(!is_output_limit_stop(WireProtocol::ChatCompletions, r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#));
    assert!(!is_output_limit_stop(WireProtocol::ChatCompletions, r#"{"choices":[{"delta":{"content":"\"length\""}}]}"#));
    assert!(is_output_limit_stop(WireProtocol::Anthropic, r#"{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}"#));
    assert!(is_output_limit_stop(WireProtocol::Gemini, r#"{"candidates":[{"finishReason":"MAX_TOKENS"}]}"#));
    assert!(is_output_limit_stop(
        WireProtocol::Responses,
        r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#,
    ));
}

#[test]
fn test_upstream_error_summary_prefers_upstream_message() {
    use yachiyo_desktop_lib::gateway::agent::runtime::upstream_error_summary;

    assert_eq!(
        upstream_error_summary(r#"上游返回错误 400 Bad Request: {"error":{"message":"Invalid reasoning_effort","type":"invalid_request_error"}}"#),
        "上游返回错误 400 Bad Request：Invalid reasoning_effort",
    );
    assert_eq!(upstream_error_summary("上游网络错误: connection refused"), "上游网络错误: connection refused");
    let long = format!("上游返回错误 500: {}", "界".repeat(400));
    let summary = upstream_error_summary(&long);
    assert_eq!(summary.chars().count(), 301);
    assert!(summary.ends_with('…'));
}

/// 本地假上游（Anthropic Messages 协议）：记录请求路径、鉴权头与请求体，返回一段正常的流式回复
async fn anthropic_upstream() -> (String, Arc<Mutex<Vec<(String, Option<String>, serde_json::Value)>>>) {
    use axum::{body::Body, extract::State, http::{HeaderMap, Uri}, response::Response, routing::post, Json, Router};
    type Seen = Arc<Mutex<Vec<(String, Option<String>, serde_json::Value)>>>;
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    async fn handle(State(seen): State<Seen>, uri: Uri, headers: HeaderMap, Json(body): Json<serde_json::Value>) -> Response {
        let key = headers.get("x-api-key").and_then(|v| v.to_str().ok()).map(String::from);
        seen.lock().unwrap().push((uri.path().to_string(), key, body));
        let sse = concat!(
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"好的\"}}\n\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n",
        );
        Response::builder().header("content-type", "text/event-stream").body(Body::from(sse)).unwrap()
    }
    let app = Router::new().route("/v1/messages", post(handle)).with_state(Arc::clone(&seen));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/v1"), seen)
}

#[tokio::test]
async fn test_custom_model_agent_turn_uses_selected_anthropic_format() {
    use yachiyo_desktop_lib::gateway::agent::runtime::HttpTurnExecutor;
    use yachiyo_desktop_lib::types::CustomModelOptions;

    let (base_url, seen) = anthropic_upstream().await;
    let custom: CustomModelOptions = serde_json::from_value(serde_json::json!({
        "apiFormat": "anthropic_messages",
        "maxOutputTokens": 4000,
        "thinking": "on",
        "temperature": 0.4,
        "topP": 0.9
    }))
    .unwrap();
    let executor = HttpTurnExecutor {
        client: reqwest::Client::new(),
        fallback_client: None,
        provider_id: ProviderId::Openai,
        base_url: Some(base_url),
        api_key: "test-key".to_string(),
        model: "relay-claude".to_string(),
        system_prompt: "system".to_string(),
        tools_schema: Vec::new(),
        reasoning_effort: None,
        effort_rejected: Arc::new(AtomicBool::new(false)),
        custom_model: Some(custom),
    };
    let (sink, _events) = collector();
    let messages = vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }];

    let outcome = executor.execute(&messages, &sink).await.expect("自定义 Anthropic 格式应按 Messages 协议解析");
    assert_eq!(outcome.text, "好的");
    // message_start 只带输入、message_delta 只带输出，合并后两者都在
    let usage = outcome.usage.expect("应汇总本轮用量");
    assert_eq!((usage.prompt_tokens, usage.completion_tokens), (Some(5), Some(2)));
    let requests = seen.lock().unwrap();
    let (path, key, body) = &requests[0];
    assert_eq!(path, "/v1/messages");
    assert_eq!(key.as_deref(), Some("test-key"));
    assert_eq!(body["max_tokens"], 4000);
    assert_eq!(body["thinking"], serde_json::json!({ "type": "enabled", "budget_tokens": 2000 }));
    assert_eq!(body["top_p"], 0.9);
    // 开启思考时不再发送 temperature，也不带官方 Claude 专属的 effort 与服务端回退
    assert!(body.get("temperature").is_none());
    assert!(body.get("output_config").is_none());
    assert!(body.get("fallbacks").is_none());
}
