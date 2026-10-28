//! 命令执行、取消与审批绑定的循环级测试：模型由脚本替身驱动，命令、取消与进程终止走真实执行路径
#![cfg(unix)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::run_registry::{RunInfo, RunRegistry};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::tools::process::ProcessTable;
use yachiyo_desktop_lib::types::{AgentExecutionMode, ClientStreamEvent, PermissionOutcome, ProviderId, ToolInvocation};

struct ScriptedExecutor {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Mutex<Vec<Vec<AgentMessage>>>,
}

impl ScriptedExecutor {
    fn new(turns: Vec<TurnOutcome>) -> Self {
        Self { turns: Mutex::new(turns), seen: Mutex::new(Vec::new()) }
    }
    fn calls(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

impl TurnExecutor for ScriptedExecutor {
    fn execute(&self, messages: &[AgentMessage], _sink: &EventSink) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        self.seen.lock().unwrap().push(messages.to_vec());
        let next = self.turns.lock().unwrap().remove(0);
        Box::pin(async move { Ok(next) })
    }
}

fn command_turn(id: &str, command: &str) -> TurnOutcome {
    TurnOutcome {
        text: String::new(),
        reasoning: String::new(),
        native: Vec::new(),
        tool_calls: vec![ToolInvocation { id: id.to_string(), name: "run_command".to_string(), arguments: serde_json::json!({ "command": command }) }],
        usage: None,
    }
}

fn final_turn(text: &str) -> TurnOutcome {
    TurnOutcome { text: text.to_string(), reasoning: String::new(), native: Vec::new(), tool_calls: Vec::new(), usage: None }
}

fn collector() -> (EventSink, Arc<Mutex<Vec<(Instant, ClientStreamEvent)>>>) {
    let events: Arc<Mutex<Vec<(Instant, ClientStreamEvent)>>> = Arc::default();
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(event) = emit {
            sink_events.lock().unwrap().push((Instant::now(), event));
        }
    });
    (sink, events)
}

fn full_auto() -> AgentLoopConfig {
    AgentLoopConfig { execution_mode: AgentExecutionMode::FullAuto, ..AgentLoopConfig::default() }
}

fn process_alive(pid: i32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat.rsplit(')').next().map(|rest| !rest.trim_start().starts_with('Z')).unwrap_or(false),
        Err(_) => false,
    }
}

#[tokio::test]
async fn failing_test_command_is_reported_as_failure_to_ui_and_model() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![command_turn("t1", "echo 'FAIL: 1 test failed' >&2; exit 1"), final_turn("测试失败了")]);
    let (sink, events) = collector();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "运行测试".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        full_auto(),
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

    let events = events.lock().unwrap();
    let (output, is_error, command) = events
        .iter()
        .find_map(|(_, event)| match event {
            ClientStreamEvent::ToolResult { id, output, is_error, command, .. } if id == "t1" => Some((output.clone(), *is_error, command.clone())),
            _ => None,
        })
        .expect("工具结果");
    assert!(is_error, "非零退出必须标记为失败");
    assert!(output.contains("失败：退出码 1"));
    let command = command.expect("结构化命令记录");
    assert_eq!(command["exitCode"], 1);
    assert_eq!(command["endReason"], "exited");
    assert_eq!(command["exitConfirmed"], true);
    assert!(command["executionId"].as_str().is_some_and(|id| id.starts_with("exec-")));

    // 模型在下一轮看到失败结论与诊断输出
    let seen = executor.seen.lock().unwrap();
    let tool_message = seen[1].iter().find_map(|message| match message {
        AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "t1" => Some(content.clone()),
        _ => None,
    });
    let tool_message = tool_message.expect("模型收到工具结果");
    assert!(tool_message.contains("[结果] 失败：退出码 1"));
    assert!(tool_message.contains("FAIL: 1 test failed"));
}

#[tokio::test]
async fn long_command_streams_output_before_its_result() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![command_turn("t1", "echo 开始构建; sleep 0.8; echo 构建完成"), final_turn("完成")]);
    let (sink, events) = collector();
    run_agent_loop(
        vec![AgentMessage::User { text: "构建".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        full_auto(),
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
    let events = events.lock().unwrap();
    let first_output = events
        .iter()
        .find(|(_, event)| matches!(event, ClientStreamEvent::ToolOutput { id, text, .. } if id == "t1" && text.contains("开始构建")))
        .map(|(at, _)| *at)
        .expect("增量输出");
    let result = events
        .iter()
        .find(|(_, event)| matches!(event, ClientStreamEvent::ToolResult { id, is_error: false, .. } if id == "t1"))
        .map(|(at, _)| *at)
        .expect("成功结果");
    assert!(result.duration_since(first_output) > Duration::from_millis(500), "输出应在命令结束前推送");
}

#[tokio::test]
async fn cancelling_a_run_terminates_the_running_command_before_finishing() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("child.pid");
    let executor = ScriptedExecutor::new(vec![
        command_turn("t1", &format!("sleep 30 & echo $! > '{}'; wait", pid_file.display())),
        final_turn("不应到达"),
    ]);
    let (sink, events) = collector();
    let processes = Arc::new(ProcessTable::new());
    let cancelled = Arc::new(AtomicBool::new(false));
    let watcher = (Arc::clone(&processes), Arc::clone(&cancelled), pid_file.clone());
    let observed = tokio::spawn(async move {
        // 命令登记到运行的进程表且后台子进程已启动后再请求取消，模拟用户在命令运行中点击停止
        for _ in 0..100 {
            let started = std::fs::read_to_string(&watcher.2).is_ok_and(|text| !text.trim().is_empty());
            if let (Some(info), true) = (watcher.0.list().first().cloned(), started) {
                watcher.1.store(true, Ordering::SeqCst);
                return Some(info);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        None
    });
    let started = Instant::now();
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "跑一下".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig { processes: Some(Arc::clone(&processes)), ..full_auto() },
        &executor,
        &ApprovalRegistry::new(),
        &mut None,
        &cancelled,
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    let info = observed.await.unwrap().expect("命令出现在运行的进程表中");
    assert_eq!(info.call_id.as_deref(), Some("t1"));
    assert!(matches!(outcome, LoopOutcome::Cancelled { ref unknown } if unknown.is_empty()));
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(executor.calls(), 1, "取消后不再调度新的模型轮次");
    assert!(processes.list().is_empty());

    let events = events.lock().unwrap();
    let command = events
        .iter()
        .find_map(|(_, event)| match event {
            ClientStreamEvent::ToolResult { id, is_error: true, command, .. } if id == "t1" => command.clone(),
            _ => None,
        })
        .expect("取消的命令仍有结构化结果");
    assert_eq!(command["endReason"], "cancelled");
    assert_eq!(command["exitConfirmed"], true);
    let pid: i32 = std::fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
    assert!(!process_alive(pid), "受管命令的子进程必须随取消结束");
}

#[tokio::test]
async fn approval_timeout_is_distinguished_from_denial() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![command_turn("t1", "echo hi"), final_turn("超时了")]);
    let (sink, events) = collector();
    run_agent_loop(
        vec![AgentMessage::User { text: "运行".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig { permission_timeout_secs: 1, run_id: Some("run-timeout".to_string()), ..AgentLoopConfig::default() },
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
    let events = events.lock().unwrap();
    let request = events.iter().find_map(|(_, event)| match event {
        ClientStreamEvent::PermissionRequest { request_id, call_id, .. } => Some((request_id.clone(), call_id.clone())),
        _ => None,
    });
    assert_eq!(request, Some(("run-timeout-t1".to_string(), "t1".to_string())), "审批编号绑定运行与调用");
    assert!(events.iter().any(|(_, event)| matches!(event, ClientStreamEvent::PermissionResolved { approved: false, reason: PermissionOutcome::Timeout, .. })));
    assert!(events.iter().any(|(_, event)| matches!(event, ClientStreamEvent::ToolResult { output, is_error: true, .. } if output.contains("审批等待超时"))));
}

#[tokio::test]
async fn approval_arriving_after_cancellation_never_executes() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("executed.txt");
    let executor = ScriptedExecutor::new(vec![command_turn("t1", &format!("touch '{}'", marker.display())), final_turn("不应到达")]);
    let gate = Arc::new(ApprovalRegistry::new());
    let cancelled = Arc::new(AtomicBool::new(false));
    let (inner_sink, _events) = collector();
    let request_ids: Arc<Mutex<Vec<String>>> = Arc::default();
    let ids = Arc::clone(&request_ids);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(ClientStreamEvent::PermissionRequest { request_id, .. }) = &emit {
            ids.lock().unwrap().push(request_id.clone());
        }
        inner_sink(emit);
    });
    let approver = {
        let (gate, cancelled, ids) = (Arc::clone(&gate), Arc::clone(&cancelled), Arc::clone(&request_ids));
        tokio::spawn(async move {
            loop {
                let next = ids.lock().unwrap().first().cloned();
                if let Some(id) = next {
                    // 用户先停止，随后批准才到达
                    cancelled.store(true, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    gate.resolve(&id, yachiyo_desktop_lib::gateway::agent::permission::ApprovalDecision { approved: true, session_scope: false });
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
    };
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "运行".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig { run_id: Some("run-late".to_string()), ..AgentLoopConfig::default() },
        &executor,
        &gate,
        &mut None,
        &cancelled,
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    approver.await.unwrap();
    assert!(matches!(outcome, LoopOutcome::Cancelled { .. }));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!marker.exists(), "取消后到达的批准不得触发执行");
    // 运行结束后审批编号已失效
    assert!(!gate.resolve("run-late-t1", yachiyo_desktop_lib::gateway::agent::permission::ApprovalDecision { approved: true, session_scope: false }));
}

#[test]
fn registry_rejects_approvals_for_other_or_cancelled_runs() {
    let registry = Arc::new(RunRegistry::new());
    let info = |run_id: &str| RunInfo {
        run_id: run_id.to_string(),
        conversation_id: None,
        workspace: None,
        provider: ProviderId::Openai,
        model: "m".to_string(),
        execution_mode: AgentExecutionMode::Confirm,
        started_at: 0,
    };
    let handle = registry.begin(info("run-a")).unwrap();
    let _other = registry.begin(info("run-b")).unwrap();
    assert!(registry.accepts_approval("run-a", "run-a-call-1"));
    assert!(!registry.accepts_approval("run-a", "run-b-call-1"), "审批编号必须属于该运行");
    assert!(!registry.accepts_approval("run-x", "run-x-call-1"));
    let snapshot = registry.cancel("run-a").expect("运行仍活跃");
    assert_eq!(serde_json::to_value(&snapshot).unwrap()["status"], "cancelling");
    assert!(handle.control().cancelled.load(Ordering::SeqCst));
    assert!(!registry.accepts_approval("run-a", "run-a-call-1"), "取消后不再接受审批");
    drop(handle);
    assert!(registry.cancel("run-a").is_none());
}

/// 通过本地网关的真实 HTTP 接口：SSE 保持连接，显式取消后运行以 cancelled 结束，取消后的审批被拒绝
#[tokio::test]
async fn gateway_cancel_endpoint_ends_the_run_and_rejects_late_approvals() {
    use yachiyo_desktop_lib::crypto::keys::KeyStore;
    use yachiyo_desktop_lib::mcp::McpManager;
    use yachiyo_desktop_lib::server::http::{generate_gateway_token, start_local_server, GATEWAY_TOKEN_HEADER};
    use yachiyo_desktop_lib::tools::WorkspaceManager;

    let storage = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let token = generate_gateway_token();
    let (port, _server) = start_local_server(
        Arc::new(KeyStore::at_path(storage.path().join("keys.dat"))),
        Arc::new(WorkspaceManager::new(None)),
        Arc::new(McpManager::new(Some(storage.path().join("mcp_servers.json")), reqwest::Client::new())),
        token.clone(),
        39388,
    )
    .await
    .expect("local gateway should start");
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let post = |path: &str, body: serde_json::Value| {
        client.post(format!("{base}{path}")).header(GATEWAY_TOKEN_HEADER, token.as_str()).json(&body).send()
    };

    let response = post("/api/chat", serde_json::json!({
        "locale": "zh-CN",
        "messages": [{ "role": "user", "text": "检查" }],
        "provider": "openai",
        "apiKey": "sk-test",
        "model": "test-model",
        "baseUrl": "https://127.0.0.1:9/v1",
        "agent": { "enabled": true, "executionMode": "confirm", "runId": "run-http", "workspace": project.path().to_string_lossy() },
    }))
    .await
    .unwrap();
    let mut events = SseReader { body: Box::pin(response.bytes_stream()), buffer: String::new() };
    assert_eq!(events.next().await.0, "run_started");

    let runs: serde_json::Value = client.get(format!("{base}/api/agent/runs")).header(GATEWAY_TOKEN_HEADER, token.as_str()).send().await.unwrap().json().await.unwrap();
    assert_eq!(runs["runs"][0]["runId"], "run-http");
    assert_eq!(runs["runs"][0]["status"], "running");

    // 运行中追加的补充要求排队；格式不合法的补充返回 400
    let queued = post("/api/agent/runs/run-http/supplements", serde_json::json!({ "id": "sup-1", "text": "顺便检查日志" })).await.unwrap();
    assert_eq!(queued.status(), reqwest::StatusCode::ACCEPTED);
    let invalid = post("/api/agent/runs/run-http/supplements", serde_json::json!({ "id": "sup-2", "text": " " })).await.unwrap();
    assert_eq!(invalid.status(), reqwest::StatusCode::BAD_REQUEST);

    let foreign = post("/api/agent/approval", serde_json::json!({ "runId": "run-other", "requestId": "run-http-c1", "approved": true })).await.unwrap();
    assert_eq!(foreign.status(), reqwest::StatusCode::CONFLICT);

    let cancel = post("/api/agent/runs/run-http/cancel", serde_json::json!({})).await.unwrap();
    assert_eq!(cancel.status(), reqwest::StatusCode::ACCEPTED);
    let cancel: serde_json::Value = cancel.json().await.unwrap();
    assert_eq!(cancel["run"]["status"], "cancelling");

    let late = post("/api/agent/approval", serde_json::json!({ "runId": "run-http", "requestId": "run-http-c1", "approved": true })).await.unwrap();
    assert_eq!(late.status(), reqwest::StatusCode::CONFLICT, "取消后的审批必须被拒绝");
    let late_supplement = post("/api/agent/runs/run-http/supplements", serde_json::json!({ "id": "sup-3", "text": "再加一点" })).await.unwrap();
    assert_eq!(late_supplement.status(), reqwest::StatusCode::CONFLICT, "取消后不再接受补充要求");
    let reason: serde_json::Value = late_supplement.json().await.unwrap();
    assert_eq!(reason["error"], "RUN_CANCELLING");

    // 观察连接一直保持，直到运行收尾并以 cancelled 结束
    let done = loop {
        let (name, data) = events.next().await;
        if name == "done" {
            break data;
        }
    };
    assert_eq!(done["reason"], "cancelled");
    for _ in 0..50 {
        let again = post("/api/agent/runs/run-http/cancel", serde_json::json!({})).await.unwrap();
        if again.status() == reqwest::StatusCode::NOT_FOUND {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("运行结束后应从登记表注销");
}

struct SseReader {
    body: std::pin::Pin<Box<dyn futures::Stream<Item = reqwest::Result<axum::body::Bytes>> + Send>>,
    buffer: String,
}

impl SseReader {
    async fn next(&mut self) -> (String, serde_json::Value) {
        use futures_util::StreamExt;
        loop {
            if let Some(end) = self.buffer.find("\n\n") {
                let record: String = self.buffer.drain(..end + 2).collect();
                let name = record.lines().find_map(|line| line.strip_prefix("event: ")).map(str::to_string);
                let data = record.lines().find_map(|line| line.strip_prefix("data: ")).map(|d| serde_json::from_str::<serde_json::Value>(d).unwrap());
                if let (Some(name), Some(data)) = (name, data) {
                    return (name, data);
                }
                continue;
            }
            let chunk = tokio::time::timeout(Duration::from_secs(10), self.body.next()).await.expect("事件超时").expect("流结束").unwrap();
            self.buffer.push_str(std::str::from_utf8(&chunk).unwrap());
        }
    }
}
