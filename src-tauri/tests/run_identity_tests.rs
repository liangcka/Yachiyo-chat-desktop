//! 运行身份与工作区归属：运行的工作区只取自请求，界面随后切换项目或网关当前浏览的项目都不影响正在执行的任务
use futures_util::StreamExt;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use yachiyo_desktop_lib::crypto::keys::KeyStore;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::run_registry::{RunRegistry, RUN_ALREADY_ACTIVE};
use yachiyo_desktop_lib::gateway::handle_chat_stream;
use yachiyo_desktop_lib::mcp::McpManager;
use yachiyo_desktop_lib::tools::{
    display_path, execute_tool_with_context, ui_tool_arguments, ToolAuthorization, WorkspaceManager,
};
use yachiyo_desktop_lib::types::ClientChatRequest;

struct Gateway {
    _storage: tempfile::TempDir,
    key_store: Arc<KeyStore>,
    workspaces: Arc<WorkspaceManager>,
    approvals: Arc<ApprovalRegistry>,
    mcp: Arc<McpManager>,
    runs: Arc<RunRegistry>,
}

fn gateway(global_root: Option<std::path::PathBuf>) -> Gateway {
    let storage = tempfile::tempdir().unwrap();
    Gateway {
        key_store: Arc::new(KeyStore::at_path(storage.path().join("keys.dat"))),
        workspaces: Arc::new(WorkspaceManager::new(global_root)),
        approvals: Arc::new(ApprovalRegistry::new()),
        mcp: Arc::new(McpManager::new(Some(storage.path().join("mcp_servers.json")), reqwest::Client::new())),
        runs: Arc::new(RunRegistry::new()),
        _storage: storage,
    }
}

/// 上游指向本机不可连接的端口：运行能完整走到工具循环入口，但不会产生任何外部请求
fn agent_request(run_id: &str, workspace: Option<&std::path::Path>) -> ClientChatRequest {
    let mut agent = json!({ "enabled": true, "executionMode": "confirm", "runId": run_id, "conversationId": "conv-a" });
    if let Some(workspace) = workspace {
        agent["workspace"] = json!(workspace.to_string_lossy());
    }
    serde_json::from_value(json!({
        "locale": "zh-CN",
        "messages": [{ "role": "user", "text": "检查项目" }],
        "provider": "openai",
        "apiKey": "sk-test",
        "model": "test-model",
        "baseUrl": "https://127.0.0.1:9/v1",
        "agent": agent,
    }))
    .unwrap()
}

fn open_stream(gateway: &Gateway, request: ClientChatRequest) -> impl futures::Stream<Item = Result<String, axum::Error>> {
    handle_chat_stream(
        reqwest::Client::new(),
        None,
        request,
        Arc::clone(&gateway.key_store),
        Arc::clone(&gateway.workspaces),
        Arc::clone(&gateway.approvals),
        Arc::clone(&gateway.mcp),
        Arc::clone(&gateway.runs),
    )
}

/// 读取下一个具名事件（跳过心跳注释）
async fn next_event<S>(stream: &mut std::pin::Pin<Box<S>>) -> (String, serde_json::Value)
where
    S: futures::Stream<Item = Result<String, axum::Error>>,
{
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(10), stream.next())
            .await
            .expect("事件超时")
            .expect("流提前结束")
            .expect("流出错");
        let mut name = None;
        let mut data = None;
        for line in chunk.lines() {
            if let Some(value) = line.strip_prefix("event: ") {
                name = Some(value.to_string());
            } else if let Some(value) = line.strip_prefix("data: ") {
                data = Some(serde_json::from_str(value).unwrap());
            }
        }
        if let (Some(name), Some(data)) = (name, data) {
            return (name, data);
        }
    }
}

/// SSE 断开不会取消运行：确认运行仍在执行且未被取消，再显式取消并等待它结束
async fn disconnect_then_cancel(runs: &RunRegistry, run_id: &str) {
    let control = runs.control(run_id).expect("SSE 断开后运行仍在执行");
    assert!(!control.cancelled.load(std::sync::atomic::Ordering::SeqCst), "SSE 断开不得取消运行");
    runs.cancel(run_id);
    wait_until_idle(runs).await;
}

async fn wait_until_idle(runs: &RunRegistry) {
    for _ in 0..200 {
        if runs.list().is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("运行在取消后未能结束");
}

#[tokio::test]
async fn agent_run_uses_request_workspace_and_leaves_ui_project_untouched() {
    let project_a = tempfile::tempdir().unwrap();
    let project_b = tempfile::tempdir().unwrap();
    let gateway = gateway(Some(project_b.path().to_path_buf()));
    let canonical_b = gateway.workspaces.get_workspace_root();

    let mut stream = Box::pin(open_stream(&gateway, agent_request("run-a", Some(project_a.path()))));
    let (name, data) = next_event(&mut stream).await;
    assert_eq!(name, "run_started");
    let canonical_a = project_a.path().canonicalize().unwrap();
    assert_eq!(data["workspace"], json!(display_path(&canonical_a)));
    assert_eq!(data["runId"], json!("run-a"));
    assert_eq!(data["conversationId"], json!("conv-a"));
    assert_eq!(data["executionMode"], json!("confirm"));

    // 运行不得改写界面当前浏览的项目，否则界面里的编辑器保存与审阅会落到运行的项目里
    assert_eq!(gateway.workspaces.get_workspace_root(), canonical_b);
    let active = gateway.runs.get("run-a").expect("运行已登记");
    assert_eq!(active.workspace.as_deref(), Some(canonical_a.as_path()));

    drop(stream);
    disconnect_then_cancel(&gateway.runs, "run-a").await;
}

#[tokio::test]
async fn request_without_workspace_runs_unbound_even_when_ui_has_a_project() {
    let project_b = tempfile::tempdir().unwrap();
    let gateway = gateway(Some(project_b.path().to_path_buf()));

    let mut stream = Box::pin(open_stream(&gateway, agent_request("run-unbound", None)));
    let (name, data) = next_event(&mut stream).await;
    assert_eq!(name, "run_started");
    assert_eq!(data["workspace"], serde_json::Value::Null, "缺省工作区不得回退到界面当前项目");
    assert_eq!(gateway.runs.get("run-unbound").unwrap().workspace, None);
    drop(stream);
    disconnect_then_cancel(&gateway.runs, "run-unbound").await;
}

#[tokio::test]
async fn unavailable_workspace_fails_before_the_run_starts() {
    let gateway = gateway(None);
    let missing = std::env::temp_dir().join(format!("yachiyo-missing-{}", rand_suffix()));
    let mut stream = Box::pin(open_stream(&gateway, agent_request("run-missing", Some(&missing))));
    let (name, data) = next_event(&mut stream).await;
    assert_eq!(name, "error");
    assert_eq!(data["code"], json!("WORKSPACE_UNAVAILABLE"));
    assert!(gateway.runs.list().is_empty());
}

#[tokio::test]
async fn duplicate_run_id_is_rejected_until_the_first_run_ends() {
    let project = tempfile::tempdir().unwrap();
    let gateway = gateway(None);

    let mut first = Box::pin(open_stream(&gateway, agent_request("run-dup", Some(project.path()))));
    assert_eq!(next_event(&mut first).await.0, "run_started");

    // 同一运行编号重复提交（重复点击、重连重发）不得启动第二次执行
    let mut second = Box::pin(open_stream(&gateway, agent_request("run-dup", Some(project.path()))));
    let (name, data) = next_event(&mut second).await;
    assert_eq!(name, "error");
    assert_eq!(data["code"], json!(RUN_ALREADY_ACTIVE));
    drop(second);

    drop(first);
    disconnect_then_cancel(&gateway.runs, "run-dup").await;
    let mut third = Box::pin(open_stream(&gateway, agent_request("run-dup", Some(project.path()))));
    assert_eq!(next_event(&mut third).await.0, "run_started");
    drop(third);
    disconnect_then_cancel(&gateway.runs, "run-dup").await;
}

#[tokio::test]
async fn invalid_run_id_is_rejected() {
    let gateway = gateway(None);
    let mut stream = Box::pin(open_stream(&gateway, agent_request("../escape", None)));
    let (name, data) = next_event(&mut stream).await;
    assert_eq!(name, "error");
    assert_eq!(data["code"], json!("INVALID_RUN_ID"));
}

#[test]
fn native_switch_returns_canonical_path_and_keeps_previous_root_on_failure() {
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir(project.path().join("sub")).unwrap();
    let manager = WorkspaceManager::new(None);
    let canonical = manager.set_workspace_root(project.path().join("sub").join("..")).unwrap();
    assert_eq!(canonical, project.path().canonicalize().unwrap());

    let missing = project.path().join("missing");
    assert!(manager.set_workspace_root(missing).is_err());
    assert_eq!(manager.get_workspace_root(), Some(canonical), "切换失败不得改变当前项目");
}

#[tokio::test]
async fn ui_reads_receive_full_raw_content_for_long_files() {
    let project = tempfile::tempdir().unwrap();
    let content: String = (1..=2500).map(|line| format!("line {line}\n")).collect();
    std::fs::write(project.path().join("long.txt"), &content).unwrap();
    let client = reqwest::Client::new();

    let ui = execute_tool_with_context(
        "read_file",
        &ui_tool_arguments("read_file", json!({ "path": "long.txt" })),
        Some(project.path()),
        &client,
        None,
        ToolAuthorization::HumanInitiated,
    )
    .await
    .unwrap();
    assert_eq!(ui, content, "界面读取必须是完整原文，不能带行号或截断");

    // 模型侧仍按分页带行号返回，二者互不影响
    let model = execute_tool_with_context(
        "read_file",
        &json!({ "path": "long.txt" }),
        Some(project.path()),
        &client,
        None,
        ToolAuthorization::Agent { mode: yachiyo_desktop_lib::types::AgentExecutionMode::Confirm, approved: true },
    )
    .await
    .unwrap();
    assert!(model.contains("   1 | line 1"));
    assert!(model.contains("已展示第 1 至 2000 行"));
}

fn rand_suffix() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64
}
