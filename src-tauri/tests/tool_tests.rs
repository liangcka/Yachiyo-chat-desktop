use std::fs;
use yachiyo_desktop_lib::tools::fs::{is_path_inside_workspace, list_directory, read_file, write_file};
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
