use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

/// diff 审阅的 HEAD 基线内容：present=false 表示无 HEAD 或文件不在 HEAD（新文件/空仓库）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadFile {
    pub present: bool,
    pub content: String,
}

pub async fn read_head_file(path_str: &str, cwd: &Path) -> Result<HeadFile, String> {
    // git 内部路径分隔符固定为 `/`，Windows 下需转换
    let git_path = path_str.replace('\\', "/");
    let mut cmd = Command::new("git");
    cmd.args(["show", &format!("HEAD:{}", git_path)]);
    cmd.current_dir(cwd);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run git show: {}", e))?;

    if !output.status.success() {
        // 空仓库 / 文件不在 HEAD 属正常业务态，统一降级为 absent
        return Ok(HeadFile { present: false, content: String::new() });
    }

    Ok(HeadFile {
        present: true,
        content: String::from_utf8_lossy(&output.stdout).to_string(),
    })
}

pub async fn git_status(cwd: &Path) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["status", "--short"]);
    cmd.current_dir(cwd);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd.output().await.map_err(|e| format!("Failed to run git status: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("git status error: {}", stderr));
    }

    if stdout.trim().is_empty() {
        Ok("Working tree clean (no changes)".to_string())
    } else {
        Ok(stdout)
    }
}

pub async fn git_diff(cwd: &Path) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["diff"]);
    cmd.current_dir(cwd);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd.output().await.map_err(|e| format!("Failed to run git diff: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("git diff error: {}", stderr));
    }

    if stdout.trim().is_empty() {
        Ok("No uncommitted diffs".to_string())
    } else {
        Ok(stdout)
    }
}
