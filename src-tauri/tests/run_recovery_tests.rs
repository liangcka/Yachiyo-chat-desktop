//! 断线重连与运行记录：SSE 断开不取消运行，按事件序号回填剩余事件；运行结束后记录结局，
//! 重启后仍为“运行中”的记录报告为被中断。经由本地网关的真实 HTTP 接口。
use std::sync::Arc;
use std::time::Duration;
use yachiyo_desktop_lib::gateway::agent::run_records::{RunEndStatus, RunRecord, RunRecordStore};
use yachiyo_desktop_lib::gateway::agent::run_registry::{RunRegistry, RunState};

struct SseReader {
    body: std::pin::Pin<Box<dyn futures::Stream<Item = reqwest::Result<axum::body::Bytes>> + Send>>,
    buffer: String,
}

impl SseReader {
    /// 下一个具名事件：(序号, 事件名, 数据)；流结束时返回 None
    async fn next(&mut self) -> Option<(Option<u64>, String, serde_json::Value)> {
        use futures_util::StreamExt;
        loop {
            if let Some(end) = self.buffer.find("\n\n") {
                let record: String = self.buffer.drain(..end + 2).collect();
                let id = record.lines().find_map(|line| line.strip_prefix("id: ")).map(|id| id.parse().unwrap());
                let name = record.lines().find_map(|line| line.strip_prefix("event: ")).map(str::to_string);
                let data = record.lines().find_map(|line| line.strip_prefix("data: ")).map(|d| serde_json::from_str(d).unwrap());
                if let (Some(name), Some(data)) = (name, data) {
                    return Some((id, name, data));
                }
                continue;
            }
            let chunk = tokio::time::timeout(Duration::from_secs(20), self.body.next()).await.expect("事件超时")?;
            self.buffer.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap());
        }
    }
}

#[tokio::test]
async fn disconnecting_keeps_the_run_and_reconnecting_backfills_from_the_last_sequence() {
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
        39408,
    )
    .await
    .expect("local gateway should start");
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let get = |path: String| client.get(format!("{base}{path}")).header(GATEWAY_TOKEN_HEADER, token.as_str()).send();

    // 上游不可连接：运行会重试后以上游错误结束，期间的事件足以验证断线与回填
    let response = client
        .post(format!("{base}/api/chat"))
        .header(GATEWAY_TOKEN_HEADER, token.as_str())
        .json(&serde_json::json!({
            "locale": "zh-CN",
            "messages": [{ "role": "user", "text": "检查" }],
            "provider": "openai",
            "apiKey": "sk-test",
            "model": "test-model",
            "baseUrl": "https://127.0.0.1:9/v1",
            "agent": { "enabled": true, "executionMode": "confirm", "runId": "run-recover", "workspace": project.path().to_string_lossy() },
        }))
        .send()
        .await
        .unwrap();
    let mut first = SseReader { body: Box::pin(response.bytes_stream()), buffer: String::new() };
    let (seq, name, _) = first.next().await.unwrap();
    assert_eq!((seq, name.as_str()), (Some(1), "run_started"));
    // 连接断开（窗口刷新、网络抖动）：运行继续
    drop(first);

    let state: serde_json::Value = get("/api/agent/runs/run-recover".to_string()).await.unwrap().json().await.unwrap();
    assert_eq!(state["state"]["kind"], "active", "SSE 断开不得取消运行：{state}");
    assert_eq!(state["state"]["run"]["status"], "running");

    // 从最后收到的序号之后重新连接：序号连续、不重复，直到终止事件
    let resumed = get("/api/agent/runs/run-recover/events?after=1".to_string()).await.unwrap();
    assert_eq!(resumed.status(), reqwest::StatusCode::OK);
    let mut reader = SseReader { body: Box::pin(resumed.bytes_stream()), buffer: String::new() };
    let mut expected = 2;
    let mut last = (String::new(), serde_json::Value::Null);
    while let Some((seq, name, data)) = reader.next().await {
        assert_eq!(seq, Some(expected), "事件序号必须连续");
        expected += 1;
        last = (name, data);
    }
    assert_eq!(last.0, "error");
    assert_eq!(last.1["code"], "PROVIDER_STREAM_ERROR", "终止事件是上游错误");

    // 运行结束后：事件日志仍可回填，运行记录写入结局
    let mut state = serde_json::Value::Null;
    for _ in 0..50 {
        state = get("/api/agent/runs/run-recover".to_string()).await.unwrap().json().await.unwrap();
        if state["state"]["kind"] == "finished" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(state["state"]["status"], "failed");
    assert_eq!(state["state"]["retained"], true);
    assert_eq!(state["state"]["lastSeq"], expected - 1);
    let record = RunRecordStore::new(storage.path().join("run-records")).read("run-recover").expect("运行记录已写入");
    assert_eq!(record.status, RunEndStatus::Failed);
    assert_eq!(record.last_seq, expected - 1);

    let replay = get("/api/agent/runs/run-recover/events?after=0".to_string()).await.unwrap();
    let mut reader = SseReader { body: Box::pin(replay.bytes_stream()), buffer: String::new() };
    assert_eq!(reader.next().await.unwrap().1, "run_started", "结束后仍可从头回填");

    let unknown = get("/api/agent/runs/run-never/events?after=0".to_string()).await.unwrap();
    assert_eq!(unknown.status(), reqwest::StatusCode::NOT_FOUND);
}

#[test]
fn records_left_running_by_a_previous_process_are_reported_as_interrupted() {
    let storage = tempfile::tempdir().unwrap();
    let dir = storage.path().join("run-records");
    let store = RunRecordStore::new(&dir);
    let record = |run_id: &str, status: RunEndStatus| RunRecord {
        run_id: run_id.to_string(),
        conversation_id: Some("c1".to_string()),
        workspace: None,
        started_at: 1,
        status,
        ended_at: None,
        reason: None,
        last_seq: 7,
    };
    // 上一个进程在运行结束前退出：记录停留在运行中
    store.write(&record("run-crashed", RunEndStatus::Running)).unwrap();
    store.write(&record("run-done", RunEndStatus::Completed)).unwrap();
    store.write(&record("run-cancelled", RunEndStatus::Cancelled)).unwrap();

    let registry = RunRegistry::with_records(&dir);
    let status = |run_id: &str| match registry.state(run_id) {
        Some(RunState::Finished { status, retained, last_seq, .. }) => {
            assert!(!retained, "重启后没有可回填的事件日志");
            assert_eq!(last_seq, 7);
            serde_json::to_value(status).unwrap()
        }
        other => panic!("{run_id}: {other:?}"),
    };
    assert_eq!(status("run-crashed"), "interrupted");
    assert_eq!(status("run-done"), "completed");
    assert_eq!(status("run-cancelled"), "cancelled");
    assert!(registry.state("run-unknown").is_none(), "没有记录的运行为未知");
}
