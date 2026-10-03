use std::fs;
use yachiyo_desktop_lib::tools::fs::{
    is_path_inside_workspace, list_directory, read_file, search_workspace_files, write_file,
};
use yachiyo_desktop_lib::tools::shell::{is_dangerous_command, run_command};

#[test]
fn test_workspace_boundary_security() {
    let temp_dir = std::env::temp_dir().join("yachiyo_test_workspace");
    fs::create_dir_all(&temp_dir).unwrap();

    let inside_file = temp_dir.join("test.txt");
    fs::write(&inside_file, "hello inside").unwrap();

    assert!(is_path_inside_workspace(&inside_file, &temp_dir));

    let content = read_file("test.txt", &temp_dir).expect("Should read inside file");
    assert_eq!(content, "hello inside");

    // Write inside
    write_file("sub/output.txt", "created", &temp_dir).expect("Should write inside file");
    let written = read_file("sub/output.txt", &temp_dir).expect("Should read written file");
    assert_eq!(written, "created");

    // List directory
    let list = list_directory(".", &temp_dir).expect("Should list workspace");
    assert!(list.contains(&"test.txt".to_string()));
    assert!(list.contains(&"sub/".to_string()));

    // Test path traversal outside workspace
    let outside_path = "../outside_escape.txt";
    assert!(!is_path_inside_workspace(&temp_dir.join(outside_path), &temp_dir));
    let read_err = read_file(outside_path, &temp_dir);
    assert!(read_err.is_err());
    assert!(read_err.unwrap_err().contains("Access denied"));

    fs::remove_dir_all(&temp_dir).ok();
}

#[test]
fn test_dangerous_command_blocking() {
    assert!(is_dangerous_command("rm -rf /"));
    assert!(is_dangerous_command("rm -rf /*"));
    assert!(is_dangerous_command("format C: /fs:NTFS"));
    assert!(is_dangerous_command("del /f /s /q C:\\Windows"));
    assert!(is_dangerous_command("shutdown /s /t 0"));

    assert!(!is_dangerous_command("cargo check"));
    assert!(!is_dangerous_command("git status"));
    assert!(!is_dangerous_command("npm test"));
    assert!(!is_dangerous_command("echo hello world"));
}

#[tokio::test]
async fn test_safe_command_execution() {
    let temp_dir = std::env::temp_dir();
    let result = run_command("echo 'Yachiyo Agent'", &temp_dir, Some(5))
        .await
        .expect("Echo command should succeed");
    assert!(result.contains("Yachiyo Agent"));
}

#[tokio::test]
async fn test_run_command_fallback_cwd_without_workspace() {
    use yachiyo_desktop_lib::tools::execute_tool_with_context;

    let http = reqwest::Client::new();
    let args = serde_json::json!({
        "command": "echo 'fallback_cwd_success'"
    });
    let result = execute_tool_with_context("run_command", &args, None, &http, None)
        .await
        .expect("Command should succeed without workspace via fallback cwd");
    assert!(result.contains("fallback_cwd_success"));
}

use yachiyo_desktop_lib::tools::{preview_tool_output, tool_risk, truncate_tool_output, ToolRisk};

#[test]
fn test_tool_risk_classification() {
    assert_eq!(tool_risk("read_file"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("list_directory"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("git_status"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("git_diff"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("web_fetch"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("write_file"), Some(ToolRisk::Write));
    assert_eq!(tool_risk("run_command"), Some(ToolRisk::Write));
    assert_eq!(tool_risk("unknown_tool"), None);
}

#[test]
fn test_truncate_tool_output() {
    let small = "hello";
    assert_eq!(truncate_tool_output("read_file", small), "hello");

    let big = "x".repeat(70 * 1024);
    let truncated = truncate_tool_output("read_file", &big);
    assert!(truncated.len() < big.len());
    assert!(truncated.contains("输出已截断"));

    // 多字节字符不产生 panic 且截断在字符边界
    let cjk = "八".repeat(40 * 1024);
    let truncated_cjk = truncate_tool_output("read_file", &cjk);
    let _ = truncated_cjk.chars().count();
}

#[test]
fn test_preview_tool_output() {
    let short = "abc".to_string();
    assert_eq!(preview_tool_output(&short), "abc");
    let long = "y".repeat(3000);
    let preview = preview_tool_output(&long);
    assert!(preview.len() <= 2 * 1024 + 64);
    assert!(preview.contains("…"));
}

#[test]
fn test_resolve_in_workspace() {
    use yachiyo_desktop_lib::tools::fs::resolve_in_workspace;
    let root = std::env::temp_dir();
    let resolved = resolve_in_workspace("sub/a.txt", &root).expect("relative path resolves");
    assert!(resolved.starts_with(&root));
    assert!(resolved.ends_with("sub\\a.txt") || resolved.ends_with("sub/a.txt"));
}

#[test]
fn test_list_workspace_entries_structured() {
    use yachiyo_desktop_lib::tools::fs::list_workspace_entries;

    let temp_dir = std::env::temp_dir().join("yachiyo_entries_test");
    fs::remove_dir_all(&temp_dir).ok();
    fs::create_dir_all(temp_dir.join("sub")).unwrap();
    fs::write(temp_dir.join("zeta.txt"), "z").unwrap();
    fs::write(temp_dir.join("alpha.txt"), "a").unwrap();

    let entries = list_workspace_entries(".", &temp_dir).expect("entries listed");
    let names: Vec<(&str, bool)> = entries.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();

    // 目录优先 + 名称升序，结构化字段替代 `/` 后缀协议
    assert_eq!(names, vec![("sub", true), ("alpha.txt", false), ("zeta.txt", false)]);

    // 越界路径拒绝
    let err = list_workspace_entries("..", &temp_dir).expect_err("escape rejected");
    assert!(err.contains("Access denied"));

    fs::remove_dir_all(&temp_dir).ok();
}

#[tokio::test]
async fn test_read_head_file_lifecycle() {
    use yachiyo_desktop_lib::tools::git::read_head_file;

    let temp_dir = std::env::temp_dir().join("yachiyo_head_test");
    fs::remove_dir_all(&temp_dir).ok();
    fs::create_dir_all(&temp_dir).unwrap();

    // 无 git 仓库：git show 失败 → absent（而非 Err）
    let outside = read_head_file("a.txt", &temp_dir).await.expect("no repo degrades");
    assert!(!outside.present);

    // 空仓库（有 .git 无 HEAD）→ absent
    let git_init = std::process::Command::new("git")
        .args(["init"])
        .current_dir(&temp_dir)
        .output()
        .expect("git init");
    assert!(git_init.status.success());
    let empty = read_head_file("a.txt", &temp_dir).await.expect("empty repo degrades");
    assert!(!empty.present);

    // 提交文件后 → present 且内容一致；未提交路径 → absent
    fs::write(temp_dir.join("a.txt"), "head content").unwrap();
    let add = std::process::Command::new("git")
        .args(["-c", "user.email=t@t", "-c", "user.name=t", "add", "."])
        .current_dir(&temp_dir)
        .output()
        .expect("git add");
    assert!(add.status.success());
    let commit = std::process::Command::new("git")
        .args(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"])
        .current_dir(&temp_dir)
        .output()
        .expect("git commit");
    assert!(commit.status.success());

    let present = read_head_file("a.txt", &temp_dir).await.expect("head read");
    assert!(present.present);
    assert_eq!(present.content, "head content");

    let missing = read_head_file("not_in_head.txt", &temp_dir).await.expect("missing degrades");
    assert!(!missing.present);

    // Windows 反斜杠路径归一化为 git 的 `/`
    let nested = read_head_file("sub\\a.txt", &temp_dir).await.expect("nested degrades");
    assert!(!nested.present);

    fs::remove_dir_all(&temp_dir).ok();
}

#[test]
fn test_fs_observation_policy() {
    use yachiyo_desktop_lib::tools::fs::{read_file_guarded, write_file_guarded, FsObservationTracker};

    let temp_dir = std::env::temp_dir().join("yachiyo_obs_test");
    fs::remove_dir_all(&temp_dir).ok();
    fs::create_dir_all(&temp_dir).unwrap();

    let tracker = FsObservationTracker::new();

    // 1. 新建文件（不存在）：允许直接写入 (createIfAbsent)
    let res = write_file_guarded("new_file.txt", "initial content", &temp_dir, Some(&tracker));
    assert!(res.is_ok(), "Writing new file should succeed");

    // 2. 已有文件、且在会话中没有 read 过：必须被拦截并报 FS_NOT_OBSERVED
    let unobserved_tracker = FsObservationTracker::new();
    let res_blocked = write_file_guarded("new_file.txt", "blind rewrite", &temp_dir, Some(&unobserved_tracker));
    assert!(res_blocked.is_err());
    let err_msg = res_blocked.unwrap_err();
    assert!(err_msg.contains("FS_NOT_OBSERVED"), "Expected FS_NOT_OBSERVED, got: {}", err_msg);

    // 3. 先 read 文件：记录版本
    let read_res = read_file_guarded("new_file.txt", &temp_dir, Some(&unobserved_tracker));
    assert!(read_res.is_ok());

    // 4. read 之后正常 write：应该放行
    let res_allowed = write_file_guarded("new_file.txt", "valid edit", &temp_dir, Some(&unobserved_tracker));
    assert!(res_allowed.is_ok(), "Observed write should succeed");

    // 5. 外部修改文件使 mtime 推进：再次写应报 FS_STALE_VERSION
    std::thread::sleep(std::time::Duration::from_millis(50));
    fs::write(temp_dir.join("new_file.txt"), "external modify").unwrap();
    let res_stale = write_file_guarded("new_file.txt", "stale edit", &temp_dir, Some(&unobserved_tracker));
    assert!(res_stale.is_err());
    let stale_msg = res_stale.unwrap_err();
    assert!(stale_msg.contains("FS_STALE_VERSION"), "Expected FS_STALE_VERSION, got: {}", stale_msg);

    fs::remove_dir_all(&temp_dir).ok();
}

#[tokio::test]
async fn test_todo_write_execution() {
    use yachiyo_desktop_lib::tools::execute_tool;

    let temp_dir = std::env::temp_dir();
    let http = reqwest::Client::new();

    let args = serde_json::json!({
        "todos": [
            { "content": "Step 1: Check code", "status": "completed" },
            { "content": "Step 2: Refactor loop", "status": "in_progress" },
            { "content": "Step 3: Add tests", "status": "pending" }
        ]
    });

    let res = execute_tool("todo_write", &args, &temp_dir, &http).await.expect("todo_write should succeed");
    assert_eq!(res, "Updated todo list: 1 pending, 1 in progress, 1 completed.");

    // 状态非法时报错
    let bad_status_args = serde_json::json!({
        "todos": [
            { "content": "Bad task", "status": "unknown_status" }
        ]
    });
    let err = execute_tool("todo_write", &bad_status_args, &temp_dir, &http).await.unwrap_err();
    assert!(err.contains("invalid status"));

    // 内容为空时报错
    let empty_content_args = serde_json::json!({
        "todos": [
            { "content": "   ", "status": "pending" }
        ]
    });
    let err_empty = execute_tool("todo_write", &empty_content_args, &temp_dir, &http).await.unwrap_err();
    assert!(err_empty.contains("cannot be empty"));
}

#[test]
fn test_process_tool_output_spill() {
    use yachiyo_desktop_lib::tools::process_tool_output;

    let temp_dir = std::env::temp_dir().join("yachiyo_spill_test");
    fs::remove_dir_all(&temp_dir).ok();
    fs::create_dir_all(&temp_dir).unwrap();

    // 1. 小于 limit: 原样返回
    let small = "small output";
    assert_eq!(process_tool_output("run_command", small, Some(&temp_dir)), "small output");

    // 2. 超过 limit (>16KB): 自动落盘到 .yachiyo/spill/ 并返回预览与引导
    let big = "LINE OF OUTPUT\n".repeat(2000); // ~30KB
    let processed = process_tool_output("run_command", &big, Some(&temp_dir));

    assert!(processed.contains("[... 工具输出过长，已省略中间"));
    assert!(processed.contains(".yachiyo/spill/"));
    assert!(processed.contains("若需查阅中间内容，请使用 read_file 查看该文件"));

    // 3. 无工作区时：安全降级为内存截断，不 panic 也不落盘
    let processed_no_ws = process_tool_output("run_command", &big, None);
    assert!(processed_no_ws.contains("[输出已截断"));

    // 检查落盘文件确实存在且内容完整
    let spill_dir = temp_dir.join(".yachiyo").join("spill");
    assert!(spill_dir.exists());
    let mut files = fs::read_dir(&spill_dir).unwrap();
    let entry = files.next().expect("Spill file should exist").unwrap();
    let saved_content = fs::read_to_string(entry.path()).unwrap();
    assert_eq!(saved_content.len(), big.len());

    fs::remove_dir_all(&temp_dir).ok();
}

#[test]
fn test_read_file_encodings_utf16_gbk_bom() {
    let temp_dir = std::env::temp_dir().join("yachiyo_test_encodings");
    fs::create_dir_all(&temp_dir).unwrap();

    // 1. UTF-8 with BOM
    let mut utf8_bom = vec![0xEF, 0xBB, 0xBF];
    utf8_bom.extend_from_slice("Write-Host 'Hello UTF8 BOM'".as_bytes());
    fs::write(temp_dir.join("utf8_bom.ps1"), &utf8_bom).unwrap();
    let read_utf8 = read_file("utf8_bom.ps1", &temp_dir).expect("Should decode UTF-8 BOM");
    assert_eq!(read_utf8, "Write-Host 'Hello UTF8 BOM'");

    // 2. UTF-16 LE with BOM (典型 Windows PowerShell 默认编码)
    let mut utf16_le = vec![0xFF, 0xFE];
    for ch in "Get-Content run.ps1".encode_utf16() {
        utf16_le.extend_from_slice(&ch.to_le_bytes());
    }
    fs::write(temp_dir.join("run.ps1"), &utf16_le).unwrap();
    let read_utf16 = read_file("run.ps1", &temp_dir).expect("Should decode UTF-16 LE BOM");
    assert_eq!(read_utf16, "Get-Content run.ps1");

    // 3. GBK / GB18030 中文脚本
    let (gbk_bytes, _, _) = encoding_rs::GB18030.encode("echo '你好世界'");
    fs::write(temp_dir.join("gbk_script.bat"), &gbk_bytes).unwrap();
    let read_gbk = read_file("gbk_script.bat", &temp_dir).expect("Should decode GBK");
    assert_eq!(read_gbk, "echo '你好世界'");

    fs::remove_dir_all(&temp_dir).ok();
}

#[test]
fn test_search_workspace_files_fuzzy() {
    let temp_dir = std::env::temp_dir().join("yachiyo_search_test_ws");
    fs::create_dir_all(temp_dir.join("src/components/editor")).unwrap();
    fs::create_dir_all(temp_dir.join("node_modules/fake_pkg")).unwrap();
    fs::create_dir_all(temp_dir.join(".git/objects")).unwrap();

    fs::write(temp_dir.join("src/components/editor/EditorView.tsx"), "").unwrap();
    fs::write(temp_dir.join("src/App.tsx"), "").unwrap();
    fs::write(temp_dir.join("README.md"), "").unwrap();
    fs::write(temp_dir.join("node_modules/fake_pkg/index.js"), "").unwrap();
    fs::write(temp_dir.join(".git/objects/dummy"), "").unwrap();

    // 1. 搜索 "editor" 应命中 EditorView.tsx，不命中 node_modules
    let res = search_workspace_files(Some("editor"), Some(10), &temp_dir)
        .expect("Should search successfully");
    assert_eq!(res.len(), 1);
    assert_eq!(res[0], "src/components/editor/EditorView.tsx");

    // 2. 搜索为空应列出常规文件并过滤黑名单目录
    let all = search_workspace_files(None, Some(10), &temp_dir)
        .expect("Should list files");
    assert!(all.contains(&"src/App.tsx".to_string()));
    assert!(all.contains(&"README.md".to_string()));
    assert!(!all.iter().any(|p| p.contains("node_modules")));
    assert!(!all.iter().any(|p| p.contains(".git")));

    // 3. 子序列匹配，例如 "app" 匹配 "src/App.tsx"
    let app_match = search_workspace_files(Some("app"), Some(10), &temp_dir)
        .expect("Should match app");
    assert!(app_match.contains(&"src/App.tsx".to_string()));

    fs::remove_dir_all(&temp_dir).ok();
}

#[test]
fn test_detect_and_append_host_environment_hints_video_controller() {
    use yachiyo_desktop_lib::tools::shell::detect_and_append_host_environment_hints;

    let cmd = "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM";
    let mut output = "Name: NVIDIA GeForce RTX 3060 Laptop GPU\nAdapterRAM: 4293918720".to_string();

    detect_and_append_host_environment_hints(cmd, &mut output);

    assert!(output.contains("系统环境纠偏提示"));
    assert!(output.contains("32 位 uint32 字段"));
    assert!(output.contains("nvidia-smi"));
    assert!(output.contains("HardwareInformation.qwMemorySize"));
}

#[test]
fn test_detect_and_append_host_environment_hints_ignored_for_other_commands() {
    use yachiyo_desktop_lib::tools::shell::detect_and_append_host_environment_hints;

    let cmd = "Get-PSDrive -PSProvider FileSystem";
    let mut output = "Name Used Free\nC 50GB 100GB".to_string();

    detect_and_append_host_environment_hints(cmd, &mut output);

    assert!(!output.contains("系统环境纠偏提示"));
}

#[test]
fn test_run_command_schema_includes_vram_and_verification_hints() {
    use yachiyo_desktop_lib::tools::get_agent_tools_schema;

    let schemas = get_agent_tools_schema();
    let run_cmd = schemas
        .iter()
        .find(|s| s["function"]["name"] == "run_command")
        .expect("run_command tool must exist");

    let desc = run_cmd["function"]["description"].as_str().unwrap();
    assert!(desc.contains("交叉求证"));
    assert!(desc.contains("HardwareInformation.qwMemorySize"));
}



