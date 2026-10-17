use serde_json::json;
use std::collections::VecDeque;

struct TestWorkspace {
    _directory: tempfile::TempDir,
    root: std::path::PathBuf,
}
impl TestWorkspace {
    fn path(&self) -> &std::path::Path {
        &self.root
    }
}
fn temp_workspace() -> TestWorkspace {
    let directory = tempfile::Builder::new().tempdir().unwrap();
    let root = directory.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    TestWorkspace {
        _directory: directory,
        root,
    }
}
fn storage_base(root: &std::path::Path) -> std::path::PathBuf {
    root.parent().unwrap().join("checkpoint-storage")
}
fn checkpoint_store(root: &std::path::Path, run: &str) -> CheckpointStore {
    CheckpointStore::with_storage(root, run, &storage_base(root))
}
fn list_checkpoints(
    root: &std::path::Path,
) -> Result<Vec<yachiyo_desktop_lib::gateway::agent::checkpoint::Checkpoint>, String> {
    CheckpointStore::list_with_storage(root, &storage_base(root))
}
fn restore_checkpoint(root: &std::path::Path, id: &str) -> Result<(), String> {
    CheckpointStore::restore_with_storage(root, id, &storage_base(root))
}
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;
use yachiyo_desktop_lib::gateway::agent::permission::{
    approval_key, ApprovalDecision, ApprovalRegistry,
};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::fs::write_file;
use yachiyo_desktop_lib::tools::{
    authorize_tool, execute_tool_with_context, ToolAuthorization, WorkspaceManager,
};
use yachiyo_desktop_lib::types::AgentExecutionMode;
use yachiyo_desktop_lib::types::AgentRequestConfig;
use yachiyo_desktop_lib::types::{ClientStreamEvent, ToolInvocation};

#[test]
fn execution_mode_survives_request_deserialization() {
    let config: AgentRequestConfig = serde_json::from_value(json!({
        "enabled": true,
        "executionMode": "readonly"
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(config).unwrap()["executionMode"],
        "readonly"
    );
}

#[test]
fn checkpoint_rollback_removes_files_created_after_capture() {
    let dir = temp_workspace();
    let mut store = checkpoint_store(dir.path(), "new-file");
    store.backup_before_write("created.txt").unwrap();
    std::fs::write(dir.path().join("created.txt"), "新文件").unwrap();
    store.rollback_all().unwrap();
    assert!(!dir.path().join("created.txt").exists());
}

#[test]
fn file_tools_cannot_modify_checkpoint_storage() {
    let dir = temp_workspace();
    let result = write_file(
        ".yachiyo/checkpoints/run/manifest.json",
        "破坏备份",
        dir.path(),
    );
    assert!(result.is_err());
    assert!(!dir
        .path()
        .join(".yachiyo/checkpoints/run/manifest.json")
        .exists());
}

#[test]
fn file_writes_do_not_modify_hard_link_targets_outside_workspace() {
    let dir = temp_workspace();
    let outside = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(outside.path(), "outside").unwrap();
    std::fs::hard_link(outside.path(), dir.path().join("linked.txt")).unwrap();
    write_file("linked.txt", "inside", dir.path()).unwrap();
    assert_eq!(std::fs::read_to_string(outside.path()).unwrap(), "outside");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("linked.txt")).unwrap(),
        "inside"
    );
}

#[test]
fn legacy_auto_does_not_grant_full_automation() {
    let config: AgentRequestConfig =
        serde_json::from_value(json!({ "enabled": true, "auto": true })).unwrap();
    assert_eq!(config.execution_mode, AgentExecutionMode::Confirm);
    assert!(serde_json::from_value::<AgentRequestConfig>(
        json!({ "enabled": true, "executionMode": "unexpected" })
    )
    .is_err());
}

#[tokio::test]
async fn readonly_is_enforced_at_execution_boundary_even_with_approval() {
    let dir = temp_workspace();
    let client = reqwest::Client::new();
    let auth = ToolAuthorization::Agent {
        mode: AgentExecutionMode::Readonly,
        approved: true,
    };
    for (name, args) in [
        (
            "write_file",
            json!({"path":"blocked.txt","content":"禁止写入"}),
        ),
        (
            "run_command",
            json!({"command":"echo blocked > blocked.txt"}),
        ),
        ("mcp__server__mutate", json!({})),
    ] {
        assert!(authorize_tool(name, auth).is_err());
        assert!(
            execute_tool_with_context(name, &args, Some(dir.path()), &client, None, auth)
                .await
                .unwrap_err()
                .contains("只读")
        );
    }
    assert!(!dir.path().join("blocked.txt").exists());
    assert!(!dir.path().join(".yachiyo").exists());
}

#[test]
fn remembered_approvals_are_scoped_to_workspace_and_arguments() {
    let first = temp_workspace();
    let second = temp_workspace();
    let key = approval_key(
        "run_command",
        &json!({"command":"npm test"}),
        Some(first.path()),
    )
    .unwrap();
    let gate = ApprovalRegistry::new();
    gate.remember(key.clone()).unwrap();
    assert!(gate.is_allowed(&key));
    for other in [
        approval_key(
            "run_command",
            &json!({"command":"npm test; echo other"}),
            Some(first.path()),
        )
        .unwrap(),
        approval_key(
            "run_command",
            &json!({"command":"npm test"}),
            Some(second.path()),
        )
        .unwrap(),
        approval_key(
            "run_command",
            &json!({"command":"Remove-Item . -Recurse"}),
            Some(first.path()),
        )
        .unwrap(),
    ] {
        assert!(!gate.is_allowed(&other));
    }
    assert_ne!(
        approval_key(
            "write_file",
            &json!({"path":"first.txt"}),
            Some(first.path())
        )
        .unwrap(),
        approval_key(
            "write_file",
            &json!({"path":"second.txt"}),
            Some(first.path())
        )
        .unwrap(),
    );
}

#[test]
fn remembered_approvals_persist_without_storing_command_text() {
    let dir = temp_workspace();
    let path = dir.path().join("config/agent-approvals.json");
    let key = approval_key(
        "run_command",
        &json!({"command":"echo private-parameter"}),
        Some(dir.path()),
    )
    .unwrap();
    let registry = ApprovalRegistry::with_storage(path.clone());
    registry.remember(key.clone()).unwrap();
    drop(registry);
    assert!(ApprovalRegistry::with_storage(path.clone()).is_allowed(&key));
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("private-parameter"));
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        1
    );
}

#[test]
fn failed_persistence_does_not_upgrade_this_or_future_calls() {
    let dir = temp_workspace();
    let parent = dir.path().join("ordinary-file");
    std::fs::write(&parent, "not a directory").unwrap();
    let registry = ApprovalRegistry::with_storage(parent.join("approvals.json"));
    let key = approval_key(
        "run_command",
        &json!({"command":"echo once"}),
        Some(dir.path()),
    )
    .unwrap();
    assert!(registry.remember(key.clone()).is_err());
    assert!(!registry.is_allowed(&key));
}

#[test]
fn invalid_persistent_approval_file_fails_closed() {
    let dir = temp_workspace();
    let path = dir.path().join("approvals.json");
    std::fs::write(&path, r#"{"version":1,"scopes":["all_commands"]}"#).unwrap();
    let registry = ApprovalRegistry::with_storage(path);
    assert!(!registry.is_allowed("all_commands"));
}

#[test]
fn persistent_snapshots_restore_modified_deleted_and_created_files_in_turn_order() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("changed.txt"), "原始内容").unwrap();
    std::fs::create_dir(dir.path().join("removed")).unwrap();
    std::fs::write(dir.path().join("removed/deleted.txt"), "需要恢复").unwrap();
    let mut store = checkpoint_store(dir.path(), "run-order");
    let first = store.capture_turn(1).unwrap();
    std::fs::write(dir.path().join("changed.txt"), "第一轮").unwrap();
    std::fs::remove_file(dir.path().join("removed/deleted.txt")).unwrap();
    std::fs::remove_dir(dir.path().join("removed")).unwrap();
    std::fs::write(dir.path().join("new.txt"), "第一轮新建").unwrap();
    let second = store.capture_turn(2).unwrap();
    drop(store);
    std::fs::write(dir.path().join("changed.txt"), "第二轮").unwrap();
    let listed = list_checkpoints(dir.path()).unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, second.id);
    assert_eq!(listed[0].turn, 2);
    restore_checkpoint(dir.path(), &second.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("changed.txt")).unwrap(),
        "第一轮"
    );
    assert!(dir.path().join("new.txt").exists());
    restore_checkpoint(dir.path(), &first.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("changed.txt")).unwrap(),
        "原始内容"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("removed/deleted.txt")).unwrap(),
        "需要恢复"
    );
    assert!(!dir.path().join("new.txt").exists());
}

#[test]
fn corrupted_backup_fails_before_changing_workspace() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("source.txt"), "before").unwrap();
    let mut store = checkpoint_store(dir.path(), "integrity");
    let checkpoint = store.capture_turn(1).unwrap();
    std::fs::write(dir.path().join("source.txt"), "after").unwrap();
    std::fs::write(dir.path().join("created.txt"), "keep").unwrap();
    std::fs::write(
        store
            .storage_directory()
            .unwrap()
            .join(&checkpoint.id)
            .join("0"),
        "tamper",
    )
    .unwrap();
    assert!(restore_checkpoint(dir.path(), &checkpoint.id).is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("source.txt")).unwrap(),
        "after"
    );
    assert!(dir.path().join("created.txt").exists());
}

#[test]
fn workspace_activity_blocks_concurrent_restore_and_releases_on_drop() {
    let dir = temp_workspace();
    let manager = WorkspaceManager::new(Some(dir.path().to_path_buf()));
    let lease = manager.acquire_workspace(dir.path()).unwrap();
    assert!(manager.acquire_workspace(dir.path()).is_err());
    drop(lease);
    assert!(manager.acquire_workspace(dir.path()).is_ok());
}

#[test]
fn overlapping_workspaces_cannot_execute_or_restore_concurrently() {
    let dir = temp_workspace();
    let nested = dir.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let manager = WorkspaceManager::new(Some(dir.path().to_path_buf()));
    let outer = manager.acquire_workspace(dir.path()).unwrap();
    assert!(manager.acquire_workspace(&nested).is_err());
    drop(outer);
    let inner = manager.acquire_workspace(&nested).unwrap();
    assert!(manager.acquire_workspace(dir.path()).is_err());
    drop(inner);
    assert!(manager.acquire_workspace(dir.path()).is_ok());
}

#[test]
fn checkpoints_reject_parent_traversal_and_external_files() {
    let dir = temp_workspace();
    let outside = tempfile::NamedTempFile::new().unwrap();
    let mut store = checkpoint_store(dir.path(), "boundary");
    assert!(store
        .backup_before_write(&outside.path().to_string_lossy())
        .is_err());
    assert!(restore_checkpoint(dir.path(), "../escape").is_err());
    assert!(!dir.path().join(".yachiyo").exists());
}

struct QueueExecutor(Mutex<VecDeque<TurnOutcome>>);
impl TurnExecutor for QueueExecutor {
    fn execute(
        &self,
        _: &[yachiyo_desktop_lib::gateway::agent::messages::AgentMessage],
        _: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let outcome = self.0.lock().unwrap().pop_front().unwrap();
        Box::pin(async move { Ok(outcome) })
    }
}

#[tokio::test]
async fn readonly_loop_does_not_create_checkpoints_or_spill_large_read_output() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("large.txt"), "a".repeat(70 * 1024)).unwrap();
    let executor = QueueExecutor(Mutex::new(VecDeque::from([
        TurnOutcome {
            text: String::new(),
            usage: None,
            tool_calls: vec![
                ToolInvocation {
                    id: "read".into(),
                    name: "read_file".into(),
                    arguments: json!({"path":"large.txt"}),
                },
                ToolInvocation {
                    id: "write".into(),
                    name: "write_file".into(),
                    arguments: json!({"path":"blocked.txt","content":"x"}),
                },
                ToolInvocation {
                    id: "mcp".into(),
                    name: "mcp__server__change".into(),
                    arguments: json!({}),
                },
            ],
        },
        TurnOutcome {
            text: String::new(),
            usage: None,
            tool_calls: vec![],
        },
    ])));
    let permissions = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&permissions);
    let sink: EventSink = Arc::new(move |event| {
        if matches!(
            event,
            LoopEmit::Event(ClientStreamEvent::PermissionRequest { .. })
        ) {
            count.fetch_add(1, Ordering::Relaxed);
        }
    });
    let mut store = Some(checkpoint_store(dir.path(), "readonly"));
    run_agent_loop(
        vec![],
        vec![],
        AgentLoopConfig {
            execution_mode: AgentExecutionMode::Readonly,
            ..Default::default()
        },
        &executor,
        &ApprovalRegistry::new(),
        &mut store,
        &AtomicBool::new(false),
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    assert_eq!(permissions.load(Ordering::Relaxed), 0);
    assert!(!dir.path().join(".yachiyo").exists());
    assert!(!dir.path().join(".gitignore").exists());
    assert!(!dir.path().join("blocked.txt").exists());
}

#[tokio::test]
async fn shell_side_effects_are_snapshotted_once_per_turn() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("old.txt"), "保留内容").unwrap();
    #[cfg(windows)]
    let command =
        "Remove-Item -LiteralPath old.txt; Set-Content -LiteralPath new.txt -Value created";
    #[cfg(not(windows))]
    let command = "rm old.txt; printf created > new.txt";
    let executor = QueueExecutor(Mutex::new(VecDeque::from([
        TurnOutcome {
            text: String::new(),
            usage: None,
            tool_calls: vec![
                ToolInvocation {
                    id: "command".into(),
                    name: "run_command".into(),
                    arguments: json!({"command":command}),
                },
                ToolInvocation {
                    id: "write".into(),
                    name: "write_file".into(),
                    arguments: json!({"path":"another.txt","content":"x"}),
                },
            ],
        },
        TurnOutcome {
            text: String::new(),
            usage: None,
            tool_calls: vec![],
        },
    ])));
    let gate = Arc::new(ApprovalRegistry::new());
    let callback_gate = Arc::clone(&gate);
    let sink: EventSink = Arc::new(move |event| {
        if let LoopEmit::Event(ClientStreamEvent::PermissionRequest { request_id, .. }) = event {
            callback_gate.resolve(
                &request_id,
                ApprovalDecision {
                    approved: true,
                    session_scope: false,
                },
            );
        }
    });
    let mut store = Some(checkpoint_store(dir.path(), "shell"));
    run_agent_loop(
        vec![],
        vec![],
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut store,
        &AtomicBool::new(false),
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    assert!(!dir.path().join("old.txt").exists());
    assert!(dir.path().join("new.txt").exists());
    let checkpoints = list_checkpoints(dir.path()).unwrap();
    assert_eq!(checkpoints.len(), 1);
    restore_checkpoint(dir.path(), &checkpoints[0].id).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old.txt")).unwrap(),
        "保留内容"
    );
    assert!(!dir.path().join("new.txt").exists());
    assert!(!dir.path().join("another.txt").exists());
}

#[tokio::test]
async fn explicit_full_auto_executes_without_permission_and_still_captures() {
    let dir = temp_workspace();
    let executor = QueueExecutor(Mutex::new(VecDeque::from([
        TurnOutcome {
            text: String::new(),
            usage: None,
            tool_calls: vec![ToolInvocation {
                id: "write".into(),
                name: "write_file".into(),
                arguments: json!({"path":"created.txt","content":"auto"}),
            }],
        },
        TurnOutcome {
            text: String::new(),
            usage: None,
            tool_calls: vec![],
        },
    ])));
    let sink: EventSink = Arc::new(move |event| {
        assert!(!matches!(
            event,
            LoopEmit::Event(ClientStreamEvent::PermissionRequest { .. })
        ));
    });
    let mut store = Some(checkpoint_store(dir.path(), "auto"));
    run_agent_loop(
        vec![],
        vec![],
        AgentLoopConfig {
            execution_mode: AgentExecutionMode::FullAuto,
            ..Default::default()
        },
        &executor,
        &ApprovalRegistry::new(),
        &mut store,
        &AtomicBool::new(false),
        &sink,
        Some(dir.path()),
        &reqwest::Client::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("created.txt")).unwrap(),
        "auto"
    );
    assert_eq!(list_checkpoints(dir.path()).unwrap().len(), 1);
}

#[tokio::test]
async fn remembered_command_permission_matches_across_runs_but_once_does_not() {
    for remember in [false, true] {
        let dir = temp_workspace();
        let gate = Arc::new(ApprovalRegistry::new());
        let count = Arc::new(AtomicUsize::new(0));
        let callback_gate = Arc::clone(&gate);
        let callback_count = Arc::clone(&count);
        let sink: EventSink = Arc::new(move |event| {
            if let LoopEmit::Event(ClientStreamEvent::PermissionRequest { request_id, .. }) = event
            {
                callback_count.fetch_add(1, Ordering::Relaxed);
                callback_gate.resolve(
                    &request_id,
                    ApprovalDecision {
                        approved: true,
                        session_scope: remember,
                    },
                );
            }
        });
        for command in ["echo first", "echo first", "echo second"] {
            let executor = QueueExecutor(Mutex::new(VecDeque::from([
                TurnOutcome {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![ToolInvocation {
                        id: "reused-call-id".into(),
                        name: "run_command".into(),
                        arguments: json!({"command":command}),
                    }],
                },
                TurnOutcome {
                    text: String::new(),
                    usage: None,
                    tool_calls: vec![],
                },
            ])));
            let mut store = Some(checkpoint_store(dir.path(), "approval"));
            run_agent_loop(
                vec![],
                vec![],
                AgentLoopConfig::default(),
                &executor,
                &gate,
                &mut store,
                &AtomicBool::new(false),
                &sink,
                Some(dir.path()),
                &reqwest::Client::new(),
            )
            .await
            .unwrap();
        }
        assert_eq!(count.load(Ordering::Relaxed), if remember { 2 } else { 3 });
    }
}

#[test]
fn invalid_manifest_paths_fail_before_changing_workspace() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("file.txt"), "before").unwrap();
    let checkpoint = checkpoint_store(dir.path(), "manifest")
        .capture_turn(1)
        .unwrap();
    std::fs::write(dir.path().join("new.txt"), "keep").unwrap();
    let manifest_path = checkpoint_store(dir.path(), "manifest")
        .storage_directory()
        .unwrap()
        .join(checkpoint.id.as_str())
        .join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["files"][0]["path"] = json!("../outside.txt");
    std::fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(restore_checkpoint(dir.path(), &checkpoint.id).is_err());
    assert!(dir.path().join("new.txt").exists());
}

#[test]
fn snapshots_restore_file_directory_replacements() {
    let dir = temp_workspace();
    std::fs::write(dir.path().join("old-file"), "file").unwrap();
    std::fs::create_dir(dir.path().join("old-dir")).unwrap();
    std::fs::write(dir.path().join("old-dir/nested"), "nested").unwrap();
    let checkpoint = checkpoint_store(dir.path(), "topology")
        .capture_turn(1)
        .unwrap();
    std::fs::remove_file(dir.path().join("old-file")).unwrap();
    std::fs::create_dir(dir.path().join("old-file")).unwrap();
    std::fs::write(dir.path().join("old-file/new"), "new").unwrap();
    std::fs::remove_file(dir.path().join("old-dir/nested")).unwrap();
    std::fs::remove_dir(dir.path().join("old-dir")).unwrap();
    std::fs::write(dir.path().join("old-dir"), "replacement").unwrap();
    restore_checkpoint(dir.path(), &checkpoint.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old-file")).unwrap(),
        "file"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("old-dir/nested")).unwrap(),
        "nested"
    );
}

#[test]
fn workspace_git_clean_cannot_delete_checkpoints() {
    let dir = temp_workspace();
    assert!(std::process::Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(dir.path())
        .status()
        .unwrap()
        .success());
    std::fs::write(dir.path().join("untracked.txt"), "restore me").unwrap();
    let mut store = checkpoint_store(dir.path(), "git-clean");
    let checkpoint = store.capture_turn(1).unwrap();
    assert!(!store
        .storage_directory()
        .unwrap()
        .starts_with(dir.path().canonicalize().unwrap()));
    assert!(std::process::Command::new("git")
        .args(["clean", "-fdx", "--quiet"])
        .current_dir(dir.path())
        .status()
        .unwrap()
        .success());
    assert!(!dir.path().join("untracked.txt").exists());
    assert_eq!(list_checkpoints(dir.path()).unwrap().len(), 1);
    restore_checkpoint(dir.path(), &checkpoint.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("untracked.txt")).unwrap(),
        "restore me"
    );
}

#[test]
fn checkpoints_refuse_storage_overlapping_workspace() {
    let dir = temp_workspace();
    let mut store =
        CheckpointStore::with_storage(dir.path(), "overlap", &dir.path().join("metadata"));
    assert!(store.capture_turn(1).unwrap_err().contains("重叠"));
    assert!(!dir.path().join("metadata").exists());
}

#[cfg(windows)]
#[test]
fn checkpoints_reject_junctions_in_workspace_and_storage() {
    for storage in [false, true] {
        let dir = temp_workspace();
        let outside = temp_workspace();
        let link = if storage {
            storage_base(dir.path())
        } else {
            dir.path().join("linked")
        };
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let mut checkpoint = checkpoint_store(dir.path(), "junction");
        assert!(checkpoint.capture_turn(1).is_err());
        assert!(write_file(
            if storage {
                ".yachiyo/checkpoints/forbidden"
            } else {
                "linked/forbidden"
            },
            "x",
            dir.path()
        )
        .is_err());
        assert!(!outside.path().join("forbidden").exists());
        std::fs::remove_dir(link).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn checkpoints_reject_symlinks_in_workspace_and_storage() {
    for storage in [false, true] {
        let dir = temp_workspace();
        let outside = temp_workspace();
        let link = if storage {
            storage_base(dir.path())
        } else {
            dir.path().join("linked")
        };
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(checkpoint_store(dir.path(), "symlink")
            .capture_turn(1)
            .is_err());
        assert!(write_file(
            if storage {
                ".yachiyo/checkpoints/forbidden"
            } else {
                "linked/forbidden"
            },
            "x",
            dir.path()
        )
        .is_err());
        assert!(!outside.path().join("forbidden").exists());
    }
}
