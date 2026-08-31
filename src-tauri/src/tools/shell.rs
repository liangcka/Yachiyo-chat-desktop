use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 30;

pub fn is_dangerous_command(command: &str) -> bool {
    let lower = command.to_lowercase();
    let dangerous_patterns = [
        "rmdir /s",
        "rm -rf /",
        "rm -rf /*",
        "del /f /s /q c:",
        "format ",
        "diskpart",
        "drop database",
        "shutdown",
        "mkfs",
    ];

    dangerous_patterns.iter().any(|pat| lower.contains(pat))
}

pub async fn run_command(
    command_str: &str,
    cwd: &Path,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    if is_dangerous_command(command_str) {
        return Err(format!(
            "Command '{}' contains potentially destructive operations and was blocked by safety policy",
            command_str
        ));
    }

    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS));

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command_str]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", command_str]);
        c
    };

    cmd.current_dir(cwd);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn command: {}", e))?;

    let output_future = child.wait_with_output();
    let output = match timeout(timeout_duration, output_future).await {
        Ok(res) => res.map_err(|e| format!("Command execution failed: {}", e))?,
        Err(_) => return Err(format!("Command execution timed out after {}s", timeout_duration.as_secs())),
    };

    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stdout.len() > MAX_OUTPUT_BYTES {
        stdout.truncate(MAX_OUTPUT_BYTES);
        stdout.push_str("\n... [Output truncated at 32KB]");
    }

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("STDERR:\n");
        result.push_str(&stderr);
    }

    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        result.push_str(&format!("\n[Process exited with code {}]", code));
    }

    Ok(result)
}
