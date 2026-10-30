use std::collections::VecDeque;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::{ApprovalDecision, ApprovalRegistry};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::{execute_tool_with_context, get_agent_tools_schema, scratch_root, FsObservationTracker, ToolAuthorization};
use yachiyo_desktop_lib::types::{AgentExecutionMode, ClientStreamEvent, ToolInvocation};

struct Turns(Mutex<VecDeque<TurnOutcome>>);

impl TurnExecutor for Turns {
    fn execute(&self, _: &[AgentMessage], _: &EventSink) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let turn = self.0.lock().unwrap().pop_front().unwrap();
        Box::pin(async move { Ok(turn) })
    }
}

#[tokio::test]
async fn unbound_reads_follow_permission_mode_and_denials() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("说明.md");
    std::fs::write(&file, "中文内容").unwrap();
    for tool in ["read_file", "list_directory"] {
        for (mode, approved, expected_requests, success) in [
            (AgentExecutionMode::Confirm, true, 1, true),
            (AgentExecutionMode::Confirm, false, 1, false),
            (AgentExecutionMode::Readonly, true, 1, true),
            (AgentExecutionMode::Readonly, false, 1, false),
            (AgentExecutionMode::FullAuto, false, 0, true),
        ] {
            let path = if tool == "read_file" { file.as_path() } else { directory.path() };
            let executor = Turns(Mutex::new(VecDeque::from([
                TurnOutcome { reasoning: String::new(), native: Vec::new(), text: String::new(), tool_calls: vec![ToolInvocation {
                    id: "read-1".into(), name: tool.into(), arguments: serde_json::json!({"path": path}),
                }], usage: None },
                TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "完成".into(), tool_calls: vec![], usage: None },
            ])));
            let gate = Arc::new(ApprovalRegistry::new());
            let requests = Arc::new(Mutex::new(0));
            let results = Arc::new(Mutex::new(Vec::new()));
            let sink: EventSink = {
                let (gate, requests, results) = (gate.clone(), requests.clone(), results.clone());
                Arc::new(move |event| match event {
                    LoopEmit::Event(ClientStreamEvent::PermissionRequest { request_id, .. }) => {
                        *requests.lock().unwrap() += 1;
                        assert!(gate.resolve(&request_id, ApprovalDecision { approved, session_scope: false }));
                    }
                    LoopEmit::Event(ClientStreamEvent::ToolResult { output, is_error, .. }) => {
                        results.lock().unwrap().push((output, is_error));
                    }
                    _ => {}
                })
            };
            run_agent_loop(vec![AgentMessage::User { text: path.display().to_string(), image_data_url: None }],
                get_agent_tools_schema(), AgentLoopConfig { execution_mode: mode, ..Default::default() },
                &executor, &gate, &mut None, &AtomicBool::new(false), &sink, None, &reqwest::Client::new())
                .await.unwrap();
            assert_eq!(*requests.lock().unwrap(), expected_requests, "{tool}: {mode:?}");
            let results = results.lock().unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(!results[0].1, success, "{}", results[0].0);
            if success {
                assert!(results[0].0.contains(if tool == "read_file" { "中文内容" } else { "说明.md" }));
            }
        }
    }
}

/// 运行一轮工具调用：权限请求按 `approved` 应答，返回请求次数与各工具结果
async fn run_unbound(mode: AgentExecutionMode, approved: bool, calls: Vec<ToolInvocation>) -> (usize, Vec<(String, bool)>) {
    let executor = Turns(Mutex::new(VecDeque::from([
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: String::new(), tool_calls: calls, usage: None },
        TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "完成".into(), tool_calls: vec![], usage: None },
    ])));
    let gate = Arc::new(ApprovalRegistry::new());
    let requests = Arc::new(Mutex::new(0));
    let results = Arc::new(Mutex::new(Vec::new()));
    let sink: EventSink = {
        let (gate, requests, results) = (gate.clone(), requests.clone(), results.clone());
        Arc::new(move |event| match event {
            LoopEmit::Event(ClientStreamEvent::PermissionRequest { request_id, .. }) => {
                *requests.lock().unwrap() += 1;
                assert!(gate.resolve(&request_id, ApprovalDecision { approved, session_scope: false }));
            }
            LoopEmit::Event(ClientStreamEvent::ToolResult { output, is_error, .. }) => results.lock().unwrap().push((output, is_error)),
            _ => {}
        })
    };
    run_agent_loop(vec![], get_agent_tools_schema(), AgentLoopConfig { execution_mode: mode, ..Default::default() },
        &executor, &gate, &mut None, &AtomicBool::new(false), &sink, None, &reqwest::Client::new())
        .await.unwrap();
    let requests = *requests.lock().unwrap();
    let results = results.lock().unwrap().clone();
    (requests, results)
}

fn call(id: &str, name: &str, arguments: serde_json::Value) -> ToolInvocation {
    ToolInvocation { id: id.into(), name: name.into(), arguments }
}

#[tokio::test]
async fn invalid_unbound_paths_return_errors_without_permission_wait() {
    let outside = tempfile::tempdir().unwrap();
    let escaped = outside.path().join("a").join("..").join("new.md");
    for mode in [AgentExecutionMode::Confirm, AgentExecutionMode::Readonly, AgentExecutionMode::FullAuto] {
        let (requests, results) = run_unbound(mode, true, vec![
            call("read", "read_file", serde_json::json!({"path": "../outside.md"})),
            call("write", "write_file", serde_json::json!({"path": "../new.md", "content": "内容"})),
            call("escape", "write_file", serde_json::json!({"path": escaped, "content": "内容"})),
        ]).await;
        assert_eq!(requests, 0, "{mode:?}");
        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|(_, is_error)| *is_error), "{results:?}");
        assert!(!outside.path().join("new.md").exists());
    }
}

#[tokio::test]
async fn unbound_external_writes_follow_permission_mode() {
    for (mode, approved, expected_requests, success) in [
        (AgentExecutionMode::Confirm, false, 1, false),
        (AgentExecutionMode::Confirm, true, 1, true),
        (AgentExecutionMode::Readonly, true, 0, false),
        (AgentExecutionMode::FullAuto, false, 0, true),
    ] {
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("自我介绍").join("index.html");
        let (requests, results) = run_unbound(mode, approved, vec![
            call("write", "write_file", serde_json::json!({"path": target, "content": "<h1>你好</h1>"})),
        ]).await;
        assert_eq!(requests, expected_requests, "{mode:?}");
        assert_eq!(!results[0].1, success, "{}", results[0].0);
        assert_eq!(target.exists(), success);
    }
}

#[tokio::test]
async fn unbound_relative_paths_use_scratch_project() {
    let scratch = scratch_root().unwrap();
    let folder = format!("yachiyo-test-{}", std::process::id());
    let note = format!("{folder}/笔记.md");
    let (requests, results) = run_unbound(AgentExecutionMode::Confirm, true, vec![
        call("write", "write_file", serde_json::json!({"path": note, "content": "临时内容"})),
        call("read", "read_file", serde_json::json!({"path": note})),
        call("list", "list_directory", serde_json::json!({"path": folder})),
        call("glob", "glob", serde_json::json!({"pattern": format!("{folder}/*.md")})),
    ]).await;
    let written = std::fs::read_to_string(scratch.join(&folder).join("笔记.md"));
    std::fs::remove_dir_all(scratch.join(&folder)).unwrap();
    // 只有写入需要确认；临时项目内的读取、列目录与检索如同项目内直接执行
    assert_eq!(requests, 1);
    assert!(results.iter().all(|(_, is_error)| !*is_error), "{results:?}");
    assert_eq!(written.unwrap(), "临时内容");
    assert!(results[1].0.contains("临时内容"));
    assert!(results[2].0.contains("笔记.md"));
    assert!(results[3].0.contains("笔记.md"));
}

#[tokio::test]
async fn unbound_execution_boundary_requires_approval() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("README.md");
    std::fs::write(&file, "正文").unwrap();
    let client = reqwest::Client::new();
    for tool in ["read_file", "list_directory"] {
        let path = if tool == "read_file" { file.as_path() } else { directory.path() };
        let denied = execute_tool_with_context(tool, &serde_json::json!({"path": path}), None,
            &client, None, ToolAuthorization::ModelInitiated { approved: false }).await.unwrap_err();
        assert!(denied.contains("授权"), "{denied}");
    }
    let args = serde_json::json!({"path": file, "content": "覆盖"});
    execute_tool_with_context("write_file", &args, None, &client, None, ToolAuthorization::ModelInitiated { approved: false })
        .await.unwrap_err();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "正文");
    // 已存在的文件须先读取再覆盖
    let tracker = FsObservationTracker::new();
    let auth = ToolAuthorization::Agent { mode: AgentExecutionMode::FullAuto, approved: true };
    execute_tool_with_context("read_file", &serde_json::json!({"path": file}), None, &client, Some(&tracker), auth).await.unwrap();
    execute_tool_with_context("write_file", &args, None, &client, Some(&tracker), auth).await.unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "覆盖");
}

#[tokio::test]
async fn unbound_reads_keep_checkpoint_storage_private() {
    let directory = tempfile::tempdir().unwrap();
    let private = directory.path().join(".yachiyo/checkpoints");
    std::fs::create_dir_all(&private).unwrap();
    let file = private.join("snapshot.json");
    std::fs::write(&file, "私有元数据").unwrap();
    for (tool, path) in [("read_file", file.as_path()), ("list_directory", private.as_path())] {
        let error = execute_tool_with_context(tool, &serde_json::json!({"path": path}), None,
            &reqwest::Client::new(), None, ToolAuthorization::HumanInitiated).await.unwrap_err();
        assert!(error.contains("检查点"), "{error}");
    }
}

#[cfg(windows)]
#[tokio::test]
async fn windows_shell_preserves_chinese_stdout_stderr_and_native_pipeline() {
    let directory = tempfile::tempdir().unwrap();
    let output = yachiyo_desktop_lib::tools::shell::run_command(
        "[Console]::WriteLine('中文标准输出'); [Console]::Error.WriteLine('中文错误输出'); '中文管道' | findstr.exe .",
        directory.path(), Some(15)).await.unwrap();
    for expected in ["中文标准输出", "中文错误输出", "中文管道"] {
        assert!(output.contains(expected), "{output}");
    }
    assert!(!output.contains('\u{fffd}'));
}

#[test]
fn agent_prompts_keep_file_io_in_native_tools_in_both_locales() {
    use yachiyo_desktop_lib::gateway::prompt::build_agent_system_prompt;
    use yachiyo_desktop_lib::types::ChatLocale;
    for locale in [ChatLocale::ZhCn, ChatLocale::JaJp] {
        let prompt = build_agent_system_prompt(locale, None, false, false);
        for required in ["read_file", "write_file", "Get-Content", "Set-Content", "cat", "echo >", "git"] {
            assert!(prompt.contains(required), "缺少 {required}");
        }
    }
}

#[test]
fn unbound_approval_key_scopes_to_directory_for_read_and_list() {
    use yachiyo_desktop_lib::gateway::agent::permission::approval_key;
    let directory = tempfile::tempdir().unwrap();
    let file_a = directory.path().join("a.txt");
    let file_b = directory.path().join("b.txt");
    std::fs::write(&file_a, "A").unwrap();
    std::fs::write(&file_b, "B").unwrap();

    let key_read_a = approval_key(
        "read_file",
        &serde_json::json!({"path": file_a}),
        None,
    ).unwrap();

    let key_read_b = approval_key(
        "read_file",
        &serde_json::json!({"path": file_b}),
        None,
    ).unwrap();

    let key_list = approval_key(
        "list_directory",
        &serde_json::json!({"path": directory.path()}),
        None,
    ).unwrap();

    assert_eq!(key_read_a, key_read_b);
    assert_eq!(key_read_a, key_list);

    let other_dir = tempfile::tempdir().unwrap();
    let other_file = other_dir.path().join("other.txt");
    std::fs::write(&other_file, "O").unwrap();
    let key_other = approval_key(
        "read_file",
        &serde_json::json!({"path": other_file}),
        None,
    ).unwrap();
    assert_ne!(key_read_a, key_other);
}

#[test]
fn unbound_write_approval_key_follows_resolved_target() {
    use yachiyo_desktop_lib::gateway::agent::permission::approval_key;
    let scratch = scratch_root().unwrap();
    let relative = approval_key("write_file", &serde_json::json!({"path": "笔记.md"}), None).unwrap();
    let absolute = approval_key("edit_file", &serde_json::json!({"path": scratch.join("笔记.md")}), None).unwrap();
    assert_eq!(relative, absolute);
    let outside = tempfile::tempdir().unwrap();
    let external = approval_key("write_file", &serde_json::json!({"path": outside.path().join("a.md")}), None).unwrap();
    assert_ne!(external, relative);
    assert!(approval_key("write_file", &serde_json::json!({"path": "../a.md"}), None).is_err());
}
