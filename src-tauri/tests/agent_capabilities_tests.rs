use serde_json::json;
use std::fs;
use yachiyo_desktop_lib::gateway::agent::permission::approval_key;
use yachiyo_desktop_lib::gateway::prompt::build_agent_system_prompt;
use yachiyo_desktop_lib::tools::{
    execute_tool_with_context, get_agent_tools_schema, tool_risk, FsObservationTracker,
    ToolAuthorization, ToolRisk, PROJECT_REQUIRED_FOR_WRITE,
};
use yachiyo_desktop_lib::types::{AgentExecutionMode, ChatLocale};

#[tokio::test]
async fn edit_file_matching_and_line_endings() {
    let cases = [
        ("头\n旧值\n尾\n", "旧值", "新值", false, Ok("头\n新值\n尾\n")),
        ("旧值\n", "不存在", "新值", false, Err("重新读取")),
        ("旧值\n旧值\n", "旧值", "新值", false, Err("补充上下文")),
        ("aaa", "aa", "b", false, Err("补充上下文")),
        ("界界界", "界界", "新值", false, Err("补充上下文")),
        ("旧值\n旧值\n", "旧值", "新值", true, Ok("新值\n新值\n")),
        ("旧值\n", "不存在", "新值", true, Err("重新读取")),
        ("头\r\n旧值\r\n尾\r\n", "旧值\n尾", "新值\n结尾", false, Ok("头\r\n新值\r\n结尾\r\n")),
        ("头\n旧值\n", "头\r\n旧值", "新值\r\n", false, Ok("新值\n\n")),
        ("旧值\n", "", "新值", false, Err("不能为空")),
        ("旧值\n", "旧值\n", "", false, Ok("")),
    ];
    for (original, old, new, all, expected) in cases {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.txt");
        fs::write(&path, original).unwrap();
        let tracker = FsObservationTracker::new();
        let client = reqwest::Client::new();
        let auth = ToolAuthorization::Agent { mode: AgentExecutionMode::FullAuto, approved: true };
        execute_tool_with_context("read_file", &json!({"path": "test.txt"}), Some(directory.path()), &client, Some(&tracker), auth).await.unwrap();
        let result = execute_tool_with_context("edit_file", &json!({
            "path": "test.txt", "old_string": old, "new_string": new, "replace_all": all,
        }), Some(directory.path()), &client, Some(&tracker), auth).await;
        match expected {
            Ok(content) => {
                result.unwrap();
                assert_eq!(fs::read_to_string(path).unwrap(), content);
            }
            Err(message) => {
                assert!(result.unwrap_err().contains(message));
                assert_eq!(fs::read_to_string(path).unwrap(), original);
            }
        }
    }
}

#[tokio::test]
async fn edit_file_requires_read_and_current_version() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("test.txt");
    fs::write(&path, "旧值").unwrap();
    let tracker = FsObservationTracker::new();
    let client = reqwest::Client::new();
    let auth = ToolAuthorization::ModelInitiated { approved: true };
    let args = json!({"path": "test.txt", "old_string": "旧值", "new_string": "新值"});
    for observation in [None, Some(&tracker)] {
        let error = execute_tool_with_context("edit_file", &args, Some(directory.path()), &client, observation, auth).await.unwrap_err();
        assert!(error.contains("FS_NOT_OBSERVED"));
    }
    execute_tool_with_context("read_file", &json!({"path": "test.txt"}), Some(directory.path()), &client, Some(&tracker), auth).await.unwrap();
    tracker.record_read(&path.canonicalize().unwrap(), std::time::SystemTime::UNIX_EPOCH);
    let stale = execute_tool_with_context("edit_file", &args, Some(directory.path()), &client, Some(&tracker), auth).await.unwrap_err();
    assert!(stale.contains("FS_STALE_VERSION"));
    execute_tool_with_context("read_file", &json!({"path": "test.txt"}), Some(directory.path()), &client, Some(&tracker), auth).await.unwrap();
    execute_tool_with_context("edit_file", &args, Some(directory.path()), &client, Some(&tracker), auth).await.unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "新值");
}

#[tokio::test]
async fn edit_file_uses_write_permissions_and_scope() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("test.txt"), "旧值").unwrap();
    let args = json!({"path": "test.txt", "old_string": "旧值", "new_string": "新值"});
    let client = reqwest::Client::new();
    assert_eq!(tool_risk("edit_file"), Some(ToolRisk::Write));
    assert_eq!(approval_key("edit_file", &args, Some(directory.path())).unwrap(), approval_key("write_file", &args, Some(directory.path())).unwrap());
    for auth in [ToolAuthorization::ModelInitiated { approved: false }, ToolAuthorization::Agent { mode: AgentExecutionMode::Readonly, approved: true }] {
        assert!(execute_tool_with_context("edit_file", &args, Some(directory.path()), &client, None, auth).await.is_err());
    }
    let error = execute_tool_with_context("edit_file", &args, None, &client, None, ToolAuthorization::Agent { mode: AgentExecutionMode::FullAuto, approved: true }).await.unwrap_err();
    assert_eq!(error, PROJECT_REQUIRED_FOR_WRITE);
    assert_eq!(fs::read_to_string(directory.path().join("test.txt")).unwrap(), "旧值");
    let schemas = get_agent_tools_schema();
    let schema = schemas.iter().find(|s| s["function"]["name"] == "edit_file").unwrap();
    assert_eq!(schema["function"]["parameters"]["required"], json!(["path", "old_string", "new_string"]));
    assert_eq!(schema["function"]["parameters"]["properties"]["replace_all"]["default"], false);
}

#[test]
fn project_instructions_are_optional() {
    let directory = tempfile::tempdir().unwrap();
    let prompt = build_agent_system_prompt(ChatLocale::ZhCn, None, Some(directory.path()));
    assert!(!prompt.contains("【项目指令】"));
    assert!(!build_agent_system_prompt(ChatLocale::ZhCn, None, None).contains("【项目指令】"));
}

#[test]
fn project_instructions_include_both_files_and_refresh_each_request() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("AGENTS.md"), "使用项目约定甲").unwrap();
    fs::write(directory.path().join("CLAUDE.md"), "使用项目约定乙").unwrap();
    for locale in [ChatLocale::ZhCn, ChatLocale::JaJp] {
        let prompt = build_agent_system_prompt(locale, None, Some(directory.path()));
        let section = if matches!(locale, ChatLocale::ZhCn) { "【项目指令】" } else { "【プロジェクト指示】" };
        assert!(prompt.contains(section));
        assert!(prompt.contains("使用项目约定甲"));
        assert!(prompt.contains("使用项目约定乙"));
        assert!(prompt.find("Workspace Context").unwrap() < prompt.find(section).unwrap());
    }
    fs::write(directory.path().join("AGENTS.md"), "更新后的约定").unwrap();
    let prompt = build_agent_system_prompt(ChatLocale::ZhCn, None, Some(directory.path()));
    assert!(prompt.contains("更新后的约定"));
    assert!(!prompt.contains("使用项目约定甲"));
}

#[test]
fn project_instructions_limit_each_file_to_8kib_on_char_boundary() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("AGENTS.md"), format!("{}尾部甲", "界".repeat(3000))).unwrap();
    fs::write(directory.path().join("CLAUDE.md"), format!("{}尾部乙", "a".repeat(8192))).unwrap();
    let prompt = build_agent_system_prompt(ChatLocale::ZhCn, None, Some(directory.path()));
    assert_eq!(prompt.matches("[已截断]").count(), 2);
    assert!(prompt.contains(&"界".repeat(2730)));
    assert!(!prompt.contains(&"界".repeat(2731)));
    assert!(!prompt.contains("尾部甲"));
    assert!(!prompt.contains("尾部乙"));
    assert!(!prompt.contains('\u{fffd}'));
}

struct FileEditExecutor(std::sync::Mutex<std::collections::VecDeque<yachiyo_desktop_lib::gateway::agent::runtime::TurnOutcome>>);

impl yachiyo_desktop_lib::gateway::agent::runtime::TurnExecutor for FileEditExecutor {
    fn execute(
        &self,
        _messages: &[yachiyo_desktop_lib::gateway::agent::messages::AgentMessage],
        _sink: &yachiyo_desktop_lib::gateway::agent::runtime::EventSink,
    ) -> futures::future::BoxFuture<'_, Result<yachiyo_desktop_lib::gateway::agent::runtime::TurnOutcome, String>> {
        let outcome = self.0.lock().unwrap().pop_front().unwrap();
        Box::pin(async move { Ok(outcome) })
    }
}

#[tokio::test]
async fn edit_file_loop_shares_approval_and_checkpoint_protection() {
    use std::sync::{atomic::AtomicBool, Arc, Mutex};
    use yachiyo_desktop_lib::gateway::agent::{
        checkpoint::CheckpointStore,
        permission::{ApprovalDecision, ApprovalRegistry},
        runtime::{run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnOutcome},
    };
    use yachiyo_desktop_lib::types::{ClientStreamEvent, ToolInvocation};

    // None 表示已有 write_file 的路径授权，验证 edit_file 直接复用。
    for decision in [Some(true), Some(false), None] {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("project");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("test.txt"), "旧值\r\n").unwrap();
        let args = json!({"path": "test.txt", "old_string": "旧值", "new_string": "新值"});
        let gate = Arc::new(ApprovalRegistry::new());
        if decision.is_none() {
            gate.remember(approval_key("write_file", &args, Some(&root)).unwrap()).unwrap();
        }
        let events = Arc::new(Mutex::new(Vec::new()));
        let collected = Arc::clone(&events);
        let approval = Arc::clone(&gate);
        let sink: EventSink = Arc::new(move |emitted| {
            if let LoopEmit::Event(event) = emitted {
                if let ClientStreamEvent::PermissionRequest { ref request_id, .. } = event {
                    assert!(approval.resolve(request_id, ApprovalDecision { approved: decision.unwrap(), session_scope: false }));
                }
                collected.lock().unwrap().push(event);
            }
        });
        let executor = FileEditExecutor(Mutex::new(std::collections::VecDeque::from([
            TurnOutcome { reasoning: String::new(), native: Vec::new(), text: String::new(), usage: None, tool_calls: vec![
                ToolInvocation { id: "read".into(), name: "read_file".into(), arguments: json!({"path": "test.txt"}) },
                ToolInvocation { id: "edit".into(), name: "edit_file".into(), arguments: args },
            ] },
            TurnOutcome { reasoning: String::new(), native: Vec::new(), text: "完成".into(), usage: None, tool_calls: vec![] },
        ])));
        let mut checkpoint = Some(CheckpointStore::with_storage(&root, "edit-run", &temporary.path().join("checkpoints")));
        let outcome = run_agent_loop(vec![], get_agent_tools_schema(), AgentLoopConfig::default(), &executor, &gate,
            &mut checkpoint, &AtomicBool::new(false), &sink, Some(&root), &reqwest::Client::new()).await.unwrap();
        assert!(matches!(outcome, LoopOutcome::Completed { .. }));
        let events = events.lock().unwrap();
        assert_eq!(events.iter().filter(|event| matches!(event, ClientStreamEvent::PermissionRequest { tool_name, .. } if tool_name == "edit_file")).count(), usize::from(decision.is_some()));
        let approved = decision != Some(false);
        assert!(events.iter().any(|event| matches!(event, ClientStreamEvent::ToolResult { name, is_error, .. } if name == "edit_file" && *is_error != approved)));
        assert_eq!(fs::read_to_string(root.join("test.txt")).unwrap(), if approved { "新值\r\n" } else { "旧值\r\n" });
        let checkpoint = checkpoint.unwrap();
        assert_eq!(checkpoint.entries().len(), usize::from(approved));
        if approved {
            checkpoint.rollback_all().unwrap();
            assert_eq!(fs::read_to_string(root.join("test.txt")).unwrap(), "旧值\r\n");
        }
    }
}
