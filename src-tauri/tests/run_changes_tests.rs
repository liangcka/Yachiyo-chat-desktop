//! 任务级改动审阅：运行基线、文件工具与命令改动的归属、保留/撤销、版本冲突与并发运行的写入协调。
//! 模型由脚本替身驱动，文件写入、命令执行、检查点与账本走真实执行路径。
#![cfg(unix)]

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use yachiyo_desktop_lib::gateway::agent::changes::{
    keep_run_change, restore_agent_version, revert_run_change, revert_run_changes, run_change_content, run_changes, ChangeKind,
    ChangeLedger, ChangeSource, ChangeState,
};
use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::run_registry::RunStatus;
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::versioned::{self, BackupStore, VERSION_CONFLICT};
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::types::{AgentExecutionMode, ClientStreamEvent, ToolInvocation};

struct Workspace {
    _directory: tempfile::TempDir,
    root: std::path::PathBuf,
    storage: std::path::PathBuf,
}

fn workspace() -> Workspace {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let storage = directory.path().join("checkpoint-storage");
    Workspace { root: root.canonicalize().unwrap(), storage, _directory: directory }
}

struct Script(Mutex<Vec<TurnOutcome>>);

impl TurnExecutor for Script {
    fn execute(&self, _messages: &[AgentMessage], _sink: &EventSink) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let next = self.0.lock().unwrap().remove(0);
        Box::pin(async move { Ok(next) })
    }
}

fn turn(calls: Vec<(&str, &str, serde_json::Value)>) -> TurnOutcome {
    TurnOutcome {
        text: String::new(),
        reasoning: String::new(),
        native: Vec::new(),
        tool_calls: calls
            .into_iter()
            .map(|(id, name, arguments)| ToolInvocation { id: id.to_string(), name: name.to_string(), arguments })
            .collect(),
        usage: None,
    }
}

fn done() -> TurnOutcome {
    turn(Vec::new())
}

async fn run(ws: &Workspace, run_id: &str, turns: Vec<TurnOutcome>, lock: Arc<tokio::sync::Mutex<()>>) -> Vec<ClientStreamEvent> {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::default();
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(event) = emit {
            sink_events.lock().unwrap().push(event);
        }
    });
    let ledger = ChangeLedger::open(&ws.root, &ws.storage, run_id).unwrap();
    let mut checkpoint = Some(CheckpointStore::with_storage(&ws.root, run_id, &ws.storage));
    run_agent_loop(
        vec![AgentMessage::User { text: "改代码".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig {
            execution_mode: AgentExecutionMode::FullAuto,
            run_id: Some(run_id.to_string()),
            workspace_lock: Some(lock),
            ledger: Some(Arc::new(Mutex::new(ledger))),
            ..AgentLoopConfig::default()
        },
        &Script(Mutex::new(turns)),
        &ApprovalRegistry::new(),
        &mut checkpoint,
        &AtomicBool::new(false),
        &sink,
        Some(&ws.root),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    let events = events.lock().unwrap().clone();
    events
}

fn write(ws: &Workspace, path: &str, content: &str) {
    std::fs::write(ws.root.join(path), content).unwrap();
}

fn read(ws: &Workspace, path: &str) -> String {
    std::fs::read_to_string(ws.root.join(path)).unwrap()
}

fn digest_of(ws: &Workspace, path: &str) -> Option<String> {
    versioned::read_snapshot(&ws.root, path).unwrap().digest()
}

#[tokio::test]
async fn task_review_keeps_user_edits_and_reverts_only_selected_agent_changes() {
    let ws = workspace();
    // 任务开始前：已提交内容之上还有用户未提交的修改，以及一个未跟踪文件
    let original = (1..=40).map(|line| format!("line {line}\n")).collect::<String>();
    let user_edited = original.replace("line 20\n", "line 20 用户的修改\n");
    write(&ws, "app.ts", &user_edited);
    write(&ws, "notes.md", "用户的未跟踪笔记\n");
    write(&ws, "obsolete.txt", "旧文件\n");

    let events = run(&ws, "run-review", vec![
        turn(vec![("r1", "read_file", serde_json::json!({ "path": "app.ts" }))]),
        turn(vec![("e1", "edit_file", serde_json::json!({ "path": "app.ts", "old_string": "line 2\n", "new_string": "line 2 Agent 改动一\n" }))]),
        turn(vec![("r2", "read_file", serde_json::json!({ "path": "app.ts" }))]),
        turn(vec![("e2", "edit_file", serde_json::json!({ "path": "app.ts", "old_string": "line 38\n", "new_string": "line 38 Agent 改动二\n" }))]),
        turn(vec![("c1", "run_command", serde_json::json!({ "command": "echo generated > generated.txt && rm obsolete.txt" }))]),
        // 改了代码却没运行验证：交付前提醒一次，模型随后给出最终回复
        done(),
        done(),
    ], Arc::new(tokio::sync::Mutex::new(()))).await;
    assert!(events.iter().all(|event| !matches!(event, ClientStreamEvent::ToolResult { output, .. } if output.contains("改动跟踪失败"))));

    let mut changes = run_changes(&ws.root, &ws.storage, "run-review").unwrap();
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    let summary: Vec<(&str, ChangeKind, ChangeState, ChangeSource)> =
        changes.iter().map(|change| (change.path.as_str(), change.kind, change.state, change.source)).collect();
    assert_eq!(summary, vec![
        ("app.ts", ChangeKind::Modified, ChangeState::Agent, ChangeSource::FileTool),
        ("generated.txt", ChangeKind::Added, ChangeState::Agent, ChangeSource::Command),
        ("obsolete.txt", ChangeKind::Deleted, ChangeState::Agent, ChangeSource::Command),
    ], "用户任务开始前的改动与未跟踪文件不属于本次任务");

    // 基线是运行开始前的状态（包含用户未提交的修改），不是 Git HEAD
    let content = run_change_content(&ws.root, &ws.storage, "run-review", "app.ts").unwrap();
    assert_eq!(content.baseline.content, user_edited);
    assert!(content.current.content.contains("Agent 改动一") && content.current.content.contains("Agent 改动二"));

    // 只撤销改动一：界面按所选块合并出的文本，其余块保持现状
    let merged = content.current.content.replace("line 2 Agent 改动一\n", "line 2\n");
    let stale = revert_run_change(&ws.root, &ws.storage, "run-review", "app.ts", Some(&merged), Some("0".repeat(64).as_str()));
    assert!(stale.unwrap_err().starts_with(VERSION_CONFLICT), "版本不一致时拒绝覆盖");
    let reverted = revert_run_change(&ws.root, &ws.storage, "run-review", "app.ts", Some(&merged), content.current.digest.as_deref()).unwrap();
    assert_eq!(reverted.state, ChangeState::Reviewed);
    let after = read(&ws, "app.ts");
    assert!(after.contains("line 20 用户的修改"), "用户已有的修改必须保留");
    assert!(after.contains("Agent 改动二"), "未选择的改动保持现状");
    assert!(!after.contains("Agent 改动一"));
    assert_eq!(read(&ws, "notes.md"), "用户的未跟踪笔记\n");

    // 撤销后反悔：恢复为运行写入的版本
    let restored = restore_agent_version(&ws.root, &ws.storage, "run-review", "app.ts", digest_of(&ws, "app.ts").as_deref()).unwrap();
    assert_eq!(restored.state, ChangeState::Agent);
    assert!(read(&ws, "app.ts").contains("Agent 改动一"));

    // 删除的文件整体撤销后恢复原内容
    let recreated = revert_run_change(&ws.root, &ws.storage, "run-review", "obsolete.txt", None, None).unwrap();
    assert_eq!(recreated.state, ChangeState::Reverted);
    assert_eq!(read(&ws, "obsolete.txt"), "旧文件\n");

    // 审阅期间文件被外部修改：标记冲突并拒绝撤销
    write(&ws, "generated.txt", "外部编辑器的修改\n");
    let changes = run_changes(&ws.root, &ws.storage, "run-review").unwrap();
    assert_eq!(changes.iter().find(|change| change.path == "generated.txt").unwrap().state, ChangeState::Conflict);
    let refused = revert_run_change(&ws.root, &ws.storage, "run-review", "generated.txt", None, digest_of(&ws, "generated.txt").as_deref());
    assert!(refused.unwrap_err().starts_with(VERSION_CONFLICT));
    assert_eq!(read(&ws, "generated.txt"), "外部编辑器的修改\n");

    // 保留：记录已处理；之后再被修改会重新以冲突呈现
    let kept = keep_run_change(&ws.root, &ws.storage, "run-review", "app.ts", digest_of(&ws, "app.ts").as_deref()).unwrap();
    assert_eq!(kept.state, ChangeState::Agent);
}

#[tokio::test]
async fn new_file_revert_deletes_it_and_backup_allows_recovery() {
    let ws = workspace();
    run(&ws, "run-new", vec![
        turn(vec![("w1", "write_file", serde_json::json!({ "path": "src/new.ts", "content": "export const a = 1;\n" }))]),
        // 改了代码却没运行验证：交付前提醒一次，模型随后给出最终回复
        done(),
        done(),
    ], Arc::new(tokio::sync::Mutex::new(()))).await;
    let changes = run_changes(&ws.root, &ws.storage, "run-new").unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!((changes[0].kind, changes[0].state), (ChangeKind::Added, ChangeState::Agent));

    let digest = digest_of(&ws, "src/new.ts");
    let reverted = revert_run_change(&ws.root, &ws.storage, "run-new", "src/new.ts", None, digest.as_deref()).unwrap();
    assert_eq!(reverted.state, ChangeState::Reverted);
    assert!(!ws.root.join("src/new.ts").exists());

    // 覆盖或删除前的内容进入备份，可以恢复
    let backups = BackupStore::open(&ws.root, &ws.storage).unwrap();
    let entry = backups.list("src/new.ts").first().cloned().expect("删除前已备份");
    assert_eq!(backups.read(&entry.id).unwrap().1, b"export const a = 1;\n");
}

#[tokio::test]
async fn concurrent_runs_in_one_workspace_take_turns_and_attribute_their_own_changes() {
    let ws = workspace();
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    let first = run(&ws, "run-a", vec![
        turn(vec![("a1", "run_command", serde_json::json!({ "command": "sleep 0.6; echo a > a.txt" }))]),
        done(),
    ], Arc::clone(&lock));
    let second = async {
        tokio::time::sleep(Duration::from_millis(150)).await;
        run(&ws, "run-b", vec![
            turn(vec![("b1", "run_command", serde_json::json!({ "command": "echo b > b.txt" }))]),
            done(),
        ], Arc::clone(&lock))
        .await
    };
    let (_, second_events) = tokio::join!(first, second);

    assert!(second_events.iter().any(|event| matches!(event, ClientStreamEvent::RunStatus { status: RunStatus::WaitingForWorkspace, .. })),
        "第二个运行应等待第一个运行的写入窗口结束");
    let paths = |run_id: &str| run_changes(&ws.root, &ws.storage, run_id).unwrap().into_iter().map(|change| change.path).collect::<Vec<_>>();
    assert_eq!(paths("run-a"), vec!["a.txt"]);
    assert_eq!(paths("run-b"), vec!["b.txt"], "并发运行的改动不会互相计入");
}

#[test]
fn versioned_writes_protect_against_blind_overwrites_and_keep_encoding() {
    let ws = workspace();
    let bom_text = [&[0xef, 0xbb, 0xbf][..], "第一行\r\n第二行\r\n".as_bytes()].concat();
    std::fs::write(ws.root.join("bom.txt"), &bom_text).unwrap();
    let view = versioned::text_view(&versioned::read_snapshot(&ws.root, "bom.txt").unwrap());
    assert!(view.bom && view.lossless);
    assert_eq!(view.content, "第一行\r\n第二行\r\n");

    let new_bytes = versioned::encode_text(&view.content.replace("第二行", "第二行（已改）"), view.bom);
    let digest = versioned::write_checked(&ws.root, &ws.storage, "bom.txt", Some(&new_bytes), view.digest.as_deref()).unwrap();
    let written = std::fs::read(ws.root.join("bom.txt")).unwrap();
    assert!(written.starts_with(&[0xef, 0xbb, 0xbf]), "保留 BOM");
    assert!(String::from_utf8_lossy(&written).contains("第二行（已改）\r\n"), "保留换行符");
    assert_eq!(digest.as_deref(), Some(versioned::read_snapshot(&ws.root, "bom.txt").unwrap().digest().unwrap().as_str()));

    // 用旧版本摘要写入：拒绝覆盖
    let refused = versioned::write_checked(&ws.root, &ws.storage, "bom.txt", Some(b"x"), view.digest.as_deref());
    assert!(refused.unwrap_err().starts_with(VERSION_CONFLICT));
    // 新建文件时期望文件不存在
    assert!(versioned::write_checked(&ws.root, &ws.storage, "bom.txt", Some(b"x"), None).is_err());
    assert!(versioned::write_checked(&ws.root, &ws.storage, "fresh.txt", Some(b"x"), None).is_ok());

    std::fs::write(ws.root.join("gbk.txt"), [0xc4, 0xe3, 0xba, 0xc3]).unwrap();
    let gbk = versioned::text_view(&versioned::read_snapshot(&ws.root, "gbk.txt").unwrap());
    assert!(!gbk.lossless, "非 UTF-8 文本标记为不可无损编辑");
    assert_eq!(gbk.content, "你好");
}

#[tokio::test]
async fn batch_revert_checks_every_version_first_then_restores_renames_without_touching_user_files() {
    let ws = workspace();
    write(&ws, "config.json", "{\"name\":\"old\"}\n");
    write(&ws, "service.ts", "export const value = 1;\n");
    write(&ws, "user.md", "用户自己的未提交修改\n");

    run(&ws, "run-batch", vec![
        turn(vec![("r1", "read_file", serde_json::json!({ "path": "service.ts" }))]),
        turn(vec![("e1", "edit_file", serde_json::json!({ "path": "service.ts", "old_string": "1", "new_string": "2" }))]),
        turn(vec![("c1", "run_command", serde_json::json!({ "command": "mv config.json settings.json" }))]),
        // 改了代码却没运行验证：交付前提醒一次，模型随后给出最终回复
        done(),
        done(),
    ], Arc::new(tokio::sync::Mutex::new(()))).await;

    let mut changes = run_changes(&ws.root, &ws.storage, "run-batch").unwrap();
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    let kinds: Vec<(&str, ChangeKind)> = changes.iter().map(|change| (change.path.as_str(), change.kind)).collect();
    assert_eq!(kinds, vec![
        ("config.json", ChangeKind::Deleted),
        ("service.ts", ChangeKind::Modified),
        ("settings.json", ChangeKind::Added),
    ], "重命名表现为删除旧路径与新建新路径");
    let items: Vec<(String, Option<String>)> = changes.iter().map(|change| (change.path.clone(), change.current.digest.clone())).collect();

    // 审阅期间 service.ts 被外部修改：先整体核对，一个文件都不写
    write(&ws, "service.ts", "export const value = 3;\n");
    let error = revert_run_changes(&ws.root, &ws.storage, "run-batch", &items).unwrap_err();
    assert!(error.starts_with(VERSION_CONFLICT) && error.contains("没有撤销任何文件"), "{error}");
    assert!(!ws.root.join("config.json").exists(), "核对失败时不得恢复任何文件");
    assert!(ws.root.join("settings.json").exists());

    // 外部修改撤回后重新撤销：旧路径恢复、新路径删除、修改还原，用户文件不受影响
    write(&ws, "service.ts", "export const value = 2;\n");
    let reverted = revert_run_changes(&ws.root, &ws.storage, "run-batch", &items).unwrap();
    assert_eq!(reverted.iter().map(|change| change.path.as_str()).collect::<Vec<_>>(), vec!["service.ts", "config.json", "settings.json"],
        "先恢复修改，再恢复删除的文件，最后删除新建的文件");
    assert!(reverted.iter().all(|change| change.state == ChangeState::Reverted));
    assert_eq!(read(&ws, "config.json"), "{\"name\":\"old\"}\n");
    assert!(!ws.root.join("settings.json").exists());
    assert_eq!(read(&ws, "service.ts"), "export const value = 1;\n");
    assert_eq!(read(&ws, "user.md"), "用户自己的未提交修改\n");
}
