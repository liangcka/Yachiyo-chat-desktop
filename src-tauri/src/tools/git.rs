use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

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
