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
use yachiyo_desktop_lib::types::{ClientHistoryMessage, ClientStreamEvent, TokenUsage, ToolInvocation};

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
        AgentMessage::Assistant { text, tool_calls } => {
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
    let body = build_openai_agent_body("test-model", &messages, "系统提示", &tools);
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
    let mut rx = registry.register("req-1");
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
    let mut rx = registry.register("req-2");
    registry.cancel("req-2");
    assert!(rx.await.is_err(), "cancelled receiver should error");
}

#[test]
fn test_checkpoint_backup_and_rollback() {
    use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    let original = "原内容 v1";
    std::fs::write(root.join("a.txt"), original).unwrap();

    let mut store = CheckpointStore::new(root, "run-test-1");
    assert!(store.backup_before_write("a.txt").unwrap());
    assert_eq!(store.entries().len(), 1);

    std::fs::write(root.join("a.txt"), "被改坏的内容").unwrap();

    let restored = store.rollback_all().unwrap();
    assert_eq!(restored, 1);
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), original);
}

#[test]
fn test_checkpoint_skips_new_files_and_yachiyo_dir() {
    use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    let mut store = CheckpointStore::new(root, "run-test-2");
    assert!(!store.backup_before_write("new-file.txt").unwrap());
    assert!(!store.backup_before_write(".yachiyo/x.txt").unwrap());
    assert_eq!(store.entries().len(), 0);
}

#[test]
fn test_checkpoint_ensure_gitignore() {
    use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let store = CheckpointStore::new(root, "run-test-3");
    store.ensure_gitignore().unwrap();
    let content = std::fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(content.contains(".yachiyo/"));
    store.ensure_gitignore().unwrap();
    let again = std::fs::read_to_string(root.join(".gitignore")).unwrap();
    assert_eq!(content.matches(".yachiyo/").count(), again.matches(".yachiyo/").count());
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
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        text: "任务完成".to_string(),
        tool_calls: vec![],
        usage: None,
    }]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-1");
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
        dir.path(),
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
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), "内容").unwrap();
    let executor = ScriptedExecutor::new(vec![
        read_call("call-1", "a.txt"),
        TurnOutcome { text: "读完了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-2");
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
        dir.path(),
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

#[tokio::test]
async fn test_loop_write_permission_denied() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            text: "我要写文件".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "call-w".to_string(),
                name: "write_file".to_string(),
                arguments: serde_json::json!({ "path": "out.txt", "content": "x" }),
            }],
            usage: None,
        },
        TurnOutcome { text: "好的，那我不写了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = Arc::new(ApprovalRegistry::new());
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-3");
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
        dir.path(),
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
async fn test_loop_session_scope_skips_second_prompt() {
    let dir = tempfile::tempdir().unwrap();
    let write_call = |id: &str| TurnOutcome {
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
        TurnOutcome { text: "完成".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = Arc::new(ApprovalRegistry::new());
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-4");
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
        dir.path(),
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
    assert_eq!(permission_count, 1, "session_scope 批准后同类工具不再询问");
    assert!(dir.path().join("w1.txt").exists());
    assert!(dir.path().join("w2.txt").exists());
}

#[tokio::test]
async fn test_loop_permission_timeout_treated_as_denied() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            text: "写".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "w1".to_string(),
                name: "write_file".to_string(),
                arguments: serde_json::json!({ "path": "t.txt", "content": "x" }),
            }],
            usage: None,
        },
        TurnOutcome { text: "超时了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-5");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig { max_turns: 12, permission_timeout_secs: 1 },
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
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
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![read_call("c1", ".")]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-6");
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
        dir.path(),
        &http,
    )
    .await
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::Cancelled));
}

#[tokio::test]
async fn test_loop_usage_accumulates() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        text: "a".to_string(),
        tool_calls: vec![],
        usage: Some(TokenUsage {
            prompt_tokens: Some(10),
            completion_tokens: Some(5),
            total_tokens: Some(15),
        }),
    }]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-7");
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
        dir.path(),
        &http,
    )
    .await
    .unwrap();
    match outcome {
        LoopOutcome::Completed { usage } => assert_eq!(usage.total_tokens, Some(15)),
        _ => panic!("expected Completed"),
    }
}
