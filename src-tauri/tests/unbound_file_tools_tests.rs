use std::collections::VecDeque;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::{ApprovalDecision, ApprovalRegistry};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::{execute_tool_with_context, get_agent_tools_schema, ToolAuthorization};
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
                TurnOutcome { text: String::new(), tool_calls: vec![ToolInvocation {
                    id: "read-1".into(), name: tool.into(), arguments: serde_json::json!({"path": path}),
                }], usage: None },
                TurnOutcome { text: "完成".into(), tool_calls: vec![], usage: None },
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

#[tokio::test]
async fn invalid_unbound_paths_and_writes_return_errors_without_permission_wait() {
    for mode in [AgentExecutionMode::Confirm, AgentExecutionMode::Readonly, AgentExecutionMode::FullAuto] {
        let executor = Turns(Mutex::new(VecDeque::from([
            TurnOutcome { text: String::new(), tool_calls: vec![
                ToolInvocation { id: "read".into(), name: "read_file".into(), arguments: serde_json::json!({"path": "README.md"}) },
                ToolInvocation { id: "list".into(), name: "list_directory".into(), arguments: serde_json::json!({"path": "."}) },
                ToolInvocation { id: "write".into(), name: "write_file".into(), arguments: serde_json::json!({"path": "new.md", "content": "内容"}) },
            ], usage: None },
            TurnOutcome { text: "完成".into(), tool_calls: vec![], usage: None },
        ])));
        let results = Arc::new(Mutex::new(Vec::new()));
        let sink: EventSink = {
            let results = results.clone();
            Arc::new(move |event| match event {
                LoopEmit::Event(ClientStreamEvent::PermissionRequest { .. }) => panic!("无效路径或无项目写入不应等待批准"),
                LoopEmit::Event(ClientStreamEvent::ToolResult { output, is_error, .. }) => {
                    assert!(is_error);
                    results.lock().unwrap().push(output);
                }
                _ => {}
            })
        };
        run_agent_loop(vec![], get_agent_tools_schema(), AgentLoopConfig { execution_mode: mode, ..Default::default() },
            &executor, &ApprovalRegistry::new(), &mut None, &AtomicBool::new(false), &sink, None, &reqwest::Client::new())
            .await.unwrap();
        let results = results.lock().unwrap();
        assert_eq!(results.len(), 3);
        assert!(results[0].contains("绝对路径"));
        assert!(results[1].contains("绝对路径"));
        assert_eq!(results[2], "当前未选择项目，无法写入。请让用户在侧栏选择项目。");
    }
}

#[tokio::test]
async fn unbound_execution_boundary_requires_absolute_path_and_approval() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("README.md");
    std::fs::write(&file, "正文").unwrap();
    let client = reqwest::Client::new();
    for tool in ["read_file", "list_directory"] {
        let path = if tool == "read_file" { file.as_path() } else { directory.path() };
        let denied = execute_tool_with_context(tool, &serde_json::json!({"path": path}), None,
            &client, None, ToolAuthorization::ModelInitiated { approved: false }).await.unwrap_err();
        assert!(denied.contains("授权"), "{denied}");
        let relative = execute_tool_with_context(tool, &serde_json::json!({"path": "."}), None,
            &client, None, ToolAuthorization::HumanInitiated).await.unwrap_err();
        assert!(relative.contains("绝对路径"), "{relative}");
    }
    let error = execute_tool_with_context("write_file", &serde_json::json!({"path": file, "content": "覆盖"}),
        None, &client, None, ToolAuthorization::Agent { mode: AgentExecutionMode::FullAuto, approved: true })
        .await.unwrap_err();
    assert_eq!(error, "当前未选择项目，无法写入。请让用户在侧栏选择项目。");
    assert_eq!(std::fs::read_to_string(file).unwrap(), "正文");
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
        let prompt = build_agent_system_prompt(locale, None, None);
        for required in ["read_file", "write_file", "Get-Content", "Set-Content", "cat", "echo >", "git"] {
            assert!(prompt.contains(required), "缺少 {required}");
        }
    }
}
