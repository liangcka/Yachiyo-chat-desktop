//! 受管命令执行的真实进程测试：退出码、超时、取消、单独停止、残留后台进程、增量输出与大日志
#![cfg(unix)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use yachiyo_desktop_lib::tools::process::{
    execute_command, format_for_model, CommandControl, CommandEndReason, OutputStream, ProcessTable,
};
use yachiyo_desktop_lib::tools::shell::run_command;

fn process_alive(pid: i32) -> bool {
    // 僵尸进程已退出，只是尚未被回收，不算存活
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat.rsplit(')').next().map(|rest| !rest.trim_start().starts_with('Z')).unwrap_or(false),
        Err(_) => false,
    }
}

fn read_pid(path: &std::path::Path) -> i32 {
    for _ in 0..50 {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(pid) = text.trim().parse() {
                return pid;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("后台进程未写出 pid");
}

#[tokio::test]
async fn non_zero_exit_is_a_failure_for_both_model_and_caller() {
    let dir = tempfile::tempdir().unwrap();
    let outcome = execute_command("echo 测试失败 >&2; exit 3", dir.path(), Duration::from_secs(10), CommandControl::default()).await;
    assert_eq!(outcome.end_reason, CommandEndReason::Exited);
    assert_eq!(outcome.exit_code, Some(3));
    assert!(!outcome.succeeded());
    assert!(outcome.exit_confirmed);
    assert!(outcome.output.contains("测试失败"));
    let text = format_for_model(&outcome, None);
    assert!(text.starts_with("[命令] echo 测试失败 >&2; exit 3\n"));
    assert!(text.contains("[结果] 失败：退出码 3"));

    let error = run_command("exit 2", dir.path(), Some(5)).await.expect_err("非零退出必须返回失败");
    assert!(error.contains("失败：退出码 2"));
    let ok = run_command("echo 完成", dir.path(), Some(5)).await.expect("零退出成功");
    assert!(ok.contains("[结果] 成功：退出码 0"));
}

#[tokio::test]
async fn timeout_terminates_the_whole_process_tree() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("child.pid");
    let started = Instant::now();
    let outcome = execute_command(
        &format!("sleep 30 & echo $! > '{}'; wait", pid_file.display()),
        dir.path(),
        Duration::from_secs(1),
        CommandControl::default(),
    )
    .await;
    assert_eq!(outcome.end_reason, CommandEndReason::TimedOut);
    assert!(outcome.exit_confirmed, "超时后必须确认整棵进程树退出");
    assert!(started.elapsed() < Duration::from_secs(10));
    let child = read_pid(&pid_file);
    assert!(!process_alive(child), "后台子进程 {child} 仍在运行");
    assert!(format_for_model(&outcome, Some(Duration::from_secs(1))).contains("超时：超过 1 秒未结束"));
}

#[tokio::test]
async fn run_cancellation_stops_the_command_and_confirms_exit() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("child.pid");
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let outcome = execute_command(
        &format!("sleep 30 & echo $! > '{}'; wait", pid_file.display()),
        dir.path(),
        Duration::from_secs(60),
        CommandControl { cancelled: Some(&cancelled), ..Default::default() },
    )
    .await;
    assert_eq!(outcome.end_reason, CommandEndReason::Cancelled);
    assert!(outcome.exit_confirmed);
    assert!(!outcome.succeeded());
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(!process_alive(read_pid(&pid_file)));
}

#[tokio::test]
async fn single_command_can_be_listed_and_stopped_through_the_process_table() {
    let dir = tempfile::tempdir().unwrap();
    let table = Arc::new(ProcessTable::new());
    let watcher = Arc::clone(&table);
    let stopper = tokio::spawn(async move {
        for _ in 0..100 {
            if let Some(info) = watcher.list().first().cloned() {
                assert_eq!(info.command, "sleep 30");
                assert_eq!(info.call_id.as_deref(), Some("call-1"));
                assert!(info.pid.is_some());
                return watcher.stop(&info.execution_id);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    });
    let outcome = execute_command(
        "sleep 30",
        dir.path(),
        Duration::from_secs(60),
        CommandControl { processes: Some(&table), call_id: Some("call-1"), ..Default::default() },
    )
    .await;
    assert!(stopper.await.unwrap(), "运行中的命令应出现在进程表中");
    assert_eq!(outcome.end_reason, CommandEndReason::Cancelled);
    assert!(table.list().is_empty(), "命令结束后注销");
    assert!(!table.stop(&outcome.execution_id));
}

#[tokio::test]
async fn background_processes_left_after_exit_are_terminated() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("server.pid");
    let started = Instant::now();
    let outcome = execute_command(
        &format!("sleep 30 & echo $! > '{}'; echo 已启动", pid_file.display()),
        dir.path(),
        Duration::from_secs(60),
        CommandControl::default(),
    )
    .await;
    assert_eq!(outcome.end_reason, CommandEndReason::Exited);
    assert_eq!(outcome.exit_code, Some(0));
    assert!(outcome.orphans_terminated);
    assert!(outcome.exit_confirmed);
    assert!(started.elapsed() < Duration::from_secs(10), "不能等后台进程跑满 30 秒");
    assert!(!process_alive(read_pid(&pid_file)));
    assert!(format_for_model(&outcome, None).contains("已随命令一并终止"));
}

#[tokio::test]
async fn output_is_streamed_while_the_command_runs() {
    let dir = tempfile::tempdir().unwrap();
    let chunks: Arc<Mutex<Vec<(Instant, OutputStream, String)>>> = Arc::default();
    let sink = Arc::clone(&chunks);
    let observer = move |stream: OutputStream, text: &str| sink.lock().unwrap().push((Instant::now(), stream, text.to_string()));
    let outcome = execute_command(
        "echo 第一行; sleep 0.6; echo 错误 >&2; sleep 0.6; echo 最后一行",
        dir.path(),
        Duration::from_secs(10),
        CommandControl { observer: Some(&observer), ..Default::default() },
    )
    .await;
    let finished = Instant::now();
    let chunks = chunks.lock().unwrap();
    let first = chunks.iter().find(|(_, _, text)| text.contains("第一行")).expect("收到第一行");
    assert!(finished.duration_since(first.0) > Duration::from_millis(800), "第一行应在命令结束前推送");
    assert!(chunks.iter().any(|(_, stream, text)| *stream == OutputStream::Stderr && text.contains("错误")));
    assert!(outcome.output.contains("第一行") && outcome.output.contains("最后一行"));
}

#[tokio::test]
async fn huge_output_keeps_head_and_tail_and_writes_the_full_log() {
    let dir = tempfile::tempdir().unwrap();
    let outcome = execute_command(
        "i=0; while [ $i -lt 30000 ]; do echo \"line $i 输出内容填充填充填充填充填充填充填充\"; i=$((i+1)); done",
        dir.path(),
        Duration::from_secs(60),
        CommandControl { log_root: Some(dir.path()), ..Default::default() },
    )
    .await;
    assert!(outcome.succeeded());
    assert!(outcome.truncated);
    assert!(outcome.output_bytes > 1024 * 1024);
    assert!(outcome.output.len() < 20 * 1024, "模型侧只收首尾");
    assert!(outcome.output.contains("line 0 ") && outcome.output.contains("line 29999 "));
    let log = outcome.log_path.as_deref().expect("完整日志落盘");
    assert!(log.starts_with(".yachiyo/spill/command-"));
    let full = std::fs::read_to_string(dir.path().join(log)).unwrap();
    assert_eq!(full.len() as u64, outcome.output_bytes);
    assert_eq!(full.lines().count(), 30000);
}

#[tokio::test]
async fn blocked_and_unspawnable_commands_are_reported_without_running() {
    let dir = tempfile::tempdir().unwrap();
    let blocked = execute_command("rm -rf /", dir.path(), Duration::from_secs(5), CommandControl::default()).await;
    assert_eq!(blocked.end_reason, CommandEndReason::Blocked);
    assert!(!blocked.succeeded());
    let missing = dir.path().join("missing");
    let unspawnable = execute_command("echo hi", &missing, Duration::from_secs(5), CommandControl::default()).await;
    assert_eq!(unspawnable.end_reason, CommandEndReason::SpawnFailed);
}

#[tokio::test]
async fn command_can_be_stopped_by_its_tool_call_before_any_output() {
    let dir = tempfile::tempdir().unwrap();
    let table = Arc::new(ProcessTable::new());
    let stopper = Arc::clone(&table);
    tokio::spawn(async move {
        for _ in 0..100 {
            if stopper.stop_call("call-quiet") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    });
    let outcome = execute_command(
        "sleep 30",
        dir.path(),
        Duration::from_secs(60),
        CommandControl { processes: Some(&table), call_id: Some("call-quiet"), ..Default::default() },
    )
    .await;
    assert_eq!(outcome.end_reason, CommandEndReason::Cancelled);
    assert!(outcome.exit_confirmed);
    assert!(!table.stop_call("call-quiet"));
}
