//! 端到端场景（模型由脚本替身驱动，文件、命令、账本与版本化写入走真实执行路径）：
//! 1/2. 读取项目指令 → 定位代码 → 修改 → 测试失败 → 读取失败输出 → 修复 → 重新测试通过，变更与验证证据可追溯；
//! 7.   同一文件被两个运行先后修改：先写入的运行审阅为冲突、不能直接撤销，后写入的运行可撤销回前者的版本；
//! 9.   超过 2000 行的文件进入审阅与按块撤销，写回内容完整、没有行号。
#![cfg(unix)]

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::changes::{revert_run_change, run_change_content, run_changes, ChangeLedger, ChangeState};
use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, EventSink, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::gateway::prompt::build_agent_system_prompt;
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::tools::versioned;
use yachiyo_desktop_lib::types::{AgentExecutionMode, ChatLocale, ClientStreamEvent, ToolInvocation};

struct Script {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Mutex<Vec<Vec<AgentMessage>>>,
}

impl TurnExecutor for Script {
    fn execute(&self, messages: &[AgentMessage], _sink: &EventSink) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        self.seen.lock().unwrap().push(messages.to_vec());
        let next = self.turns.lock().unwrap().remove(0);
        Box::pin(async move { Ok(next) })
    }
}

fn step(id: &str, name: &str, arguments: serde_json::Value) -> TurnOutcome {
    TurnOutcome {
        text: String::new(),
        reasoning: String::new(),
        native: Vec::new(),
        tool_calls: vec![ToolInvocation { id: id.to_string(), name: name.to_string(), arguments }],
        usage: None,
    }
}

fn finish(text: &str) -> TurnOutcome {
    TurnOutcome { text: text.to_string(), reasoning: String::new(), native: Vec::new(), tool_calls: Vec::new(), usage: None }
}

struct Workspace {
    _directory: tempfile::TempDir,
    root: std::path::PathBuf,
    storage: std::path::PathBuf,
}

fn workspace() -> Workspace {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let storage = directory.path().join("storage");
    Workspace { root: root.canonicalize().unwrap(), storage, _directory: directory }
}

async fn run(ws: &Workspace, run_id: &str, script: &Script, lock: Arc<tokio::sync::Mutex<()>>) -> (LoopOutcome, Vec<ClientStreamEvent>) {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::default();
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |emit| {
        if let LoopEmit::Event(event) = emit {
            sink_events.lock().unwrap().push(event);
        }
    });
    let mut checkpoint = Some(CheckpointStore::with_storage(&ws.root, run_id, &ws.storage));
    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "修复 add 的返回值".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig {
            execution_mode: AgentExecutionMode::FullAuto,
            run_id: Some(run_id.to_string()),
            workspace_lock: Some(lock),
            ledger: Some(Arc::new(Mutex::new(ChangeLedger::open(&ws.root, &ws.storage, run_id).unwrap()))),
            locale: ChatLocale::ZhCn,
            ..AgentLoopConfig::default()
        },
        script,
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
    (outcome, events)
}

fn command_results(events: &[ClientStreamEvent]) -> Vec<(bool, serde_json::Value)> {
    events
        .iter()
        .filter_map(|event| match event {
            ClientStreamEvent::ToolResult { name, is_error, command: Some(command), .. } if name == "run_command" => Some((*is_error, command.clone())),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn task_reads_instructions_fixes_code_handles_a_failing_test_and_delivers_with_evidence() {
    let ws = workspace();
    std::fs::write(ws.root.join("AGENTS.md"), "测试命令：sh test.sh\n修改前先阅读 src/math.ts。\n").unwrap();
    std::fs::create_dir(ws.root.join("src")).unwrap();
    std::fs::write(ws.root.join("src/math.ts"), "export function add(a: number, b: number) {\n  return a - b;\n}\n").unwrap();
    std::fs::write(
        ws.root.join("test.sh"),
        "if grep -q 'return a + b' src/math.ts; then echo PASS; else echo 'FAIL: add(1, 2) 期望 3' >&2; exit 1; fi\n",
    )
    .unwrap();

    // 项目指令取自运行所属的工作区
    let prompt = build_agent_system_prompt(ChatLocale::ZhCn, Some(&ws.root), false, false);
    assert!(prompt.contains("测试命令：sh test.sh"));

    let script = Script {
        turns: Mutex::new(vec![
            step("g1", "grep", serde_json::json!({ "pattern": "function add", "path": "src" })),
            step("r1", "read_file", serde_json::json!({ "path": "src/math.ts" })),
            step("e1", "edit_file", serde_json::json!({ "path": "src/math.ts", "old_string": "a - b", "new_string": "a * b" })),
            step("t1", "run_command", serde_json::json!({ "command": "sh test.sh" })),
            step("r2", "read_file", serde_json::json!({ "path": "src/math.ts" })),
            step("e2", "edit_file", serde_json::json!({ "path": "src/math.ts", "old_string": "a * b", "new_string": "a + b" })),
            step("t2", "run_command", serde_json::json!({ "command": "sh test.sh" })),
            finish("已修复 add，sh test.sh 通过。"),
        ]),
        seen: Mutex::new(Vec::new()),
    };
    let (outcome, events) = run(&ws, "run-fix", &script, Arc::new(tokio::sync::Mutex::new(()))).await;
    assert!(matches!(outcome, LoopOutcome::Completed { .. }));

    // 第一次测试失败：界面与模型都看到退出码 1 与失败输出
    let results = command_results(&events);
    assert_eq!(results.len(), 2);
    assert!(results[0].0);
    assert_eq!(results[0].1["exitCode"], 1);
    assert_eq!(results[0].1["endReason"], "exited");
    let seen = script.seen.lock().unwrap();
    let failure = seen[4].iter().rev().find_map(|message| match message {
        AgentMessage::ToolResult { tool_call_id, content, .. } if tool_call_id == "t1" => Some(content.clone()),
        _ => None,
    });
    let failure = failure.expect("模型拿到了失败的测试结果");
    assert!(failure.contains("FAIL: add(1, 2) 期望 3") && failure.contains("退出码 1"), "{failure}");
    // 修复后重新测试通过：最近一次验证是通过的，交付前没有执行反馈
    assert!(!results[1].0);
    assert_eq!(results[1].1["exitCode"], 0);
    assert!(!events.iter().any(|event| matches!(event, ClientStreamEvent::RunNote { .. })));

    // 变更可追溯：基线是运行开始前的内容，当前是修复后的内容
    let changes = run_changes(&ws.root, &ws.storage, "run-fix").unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "src/math.ts");
    assert_eq!(changes[0].state, ChangeState::Agent);
    let content = run_change_content(&ws.root, &ws.storage, "run-fix", "src/math.ts").unwrap();
    assert!(content.baseline.content.contains("return a - b"));
    assert!(content.current.content.contains("return a + b"));
}

#[tokio::test]
async fn two_runs_editing_the_same_file_in_turn_keep_attribution_and_refuse_blind_reverts() {
    let ws = workspace();
    std::fs::write(ws.root.join("config.ts"), "export const level = \"info\";\nexport const color = false;\n").unwrap();
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    let first = Script {
        turns: Mutex::new(vec![
            step("a1", "read_file", serde_json::json!({ "path": "config.ts" })),
            step("a2", "edit_file", serde_json::json!({ "path": "config.ts", "old_string": "\"info\"", "new_string": "\"debug\"" })),
            finish("A 完成"),
            finish("A 已说明未验证的原因"),
        ]),
        seen: Mutex::new(Vec::new()),
    };
    run(&ws, "run-a", &first, Arc::clone(&lock)).await;
    let second = Script {
        turns: Mutex::new(vec![
            step("b1", "read_file", serde_json::json!({ "path": "config.ts" })),
            step("b2", "edit_file", serde_json::json!({ "path": "config.ts", "old_string": "false", "new_string": "true" })),
            finish("B 完成"),
            finish("B 已说明未验证的原因"),
        ]),
        seen: Mutex::new(Vec::new()),
    };
    run(&ws, "run-b", &second, Arc::clone(&lock)).await;

    // A 写入之后文件又被 B 改过：A 的审阅为冲突，不能直接撤销（否则会抹掉 B 的改动）
    let a = run_changes(&ws.root, &ws.storage, "run-a").unwrap();
    assert_eq!(a[0].state, ChangeState::Conflict);
    let digest = versioned::read_snapshot(&ws.root, "config.ts").unwrap().digest();
    assert!(revert_run_change(&ws.root, &ws.storage, "run-a", "config.ts", None, digest.as_deref()).is_err());

    // B 的基线是 A 改完之后的内容：撤销 B 只回到 A 的版本
    let b = run_changes(&ws.root, &ws.storage, "run-b").unwrap();
    assert_eq!(b[0].state, ChangeState::Agent);
    revert_run_change(&ws.root, &ws.storage, "run-b", "config.ts", None, digest.as_deref()).unwrap();
    assert_eq!(std::fs::read_to_string(ws.root.join("config.ts")).unwrap(), "export const level = \"debug\";\nexport const color = false;\n");
    // B 撤销后 A 的改动重新成为当前版本，A 的审阅恢复为可处理
    assert_eq!(run_changes(&ws.root, &ws.storage, "run-a").unwrap()[0].state, ChangeState::Agent);
}

#[tokio::test]
async fn files_over_two_thousand_lines_are_reviewed_and_partially_reverted_without_line_numbers_or_truncation() {
    let ws = workspace();
    let original: String = (1..=3000).map(|line| format!("const value{line} = {line};\n")).collect();
    std::fs::write(ws.root.join("big.ts"), &original).unwrap();
    let script = Script {
        turns: Mutex::new(vec![
            step("r1", "read_file", serde_json::json!({ "path": "big.ts" })),
            step("e1", "edit_file", serde_json::json!({ "path": "big.ts", "old_string": "const value10 = 10;", "new_string": "const value10 = 100;" })),
            step("e2", "edit_file", serde_json::json!({ "path": "big.ts", "old_string": "const value2990 = 2990;", "new_string": "const value2990 = 29900;" })),
            step("t1", "run_command", serde_json::json!({ "command": "echo tsc --noEmit" })),
            finish("完成"),
        ]),
        seen: Mutex::new(Vec::new()),
    };
    run(&ws, "run-big", &script, Arc::new(tokio::sync::Mutex::new(()))).await;

    // 审阅读取完整原文：3000 行、没有行号前缀
    let content = run_change_content(&ws.root, &ws.storage, "run-big", "big.ts").unwrap();
    assert_eq!(content.baseline.content, original);
    assert_eq!(content.current.content.lines().count(), 3000);
    assert!(!content.current.content.contains("2999\t") && content.current.content.starts_with("const value1 = 1;\n"));

    // 只撤销第一处改动（界面按块合并出的内容），第二处保留；写回完整、版本核对
    let merged = content.current.content.replace("const value10 = 100;", "const value10 = 10;");
    revert_run_change(&ws.root, &ws.storage, "run-big", "big.ts", Some(&merged), content.current.digest.as_deref()).unwrap();
    let after = std::fs::read_to_string(ws.root.join("big.ts")).unwrap();
    assert_eq!(after, original.replace("const value2990 = 2990;", "const value2990 = 29900;"));
    assert_eq!(after.lines().count(), 3000);
}
