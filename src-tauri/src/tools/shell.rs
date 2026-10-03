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

    detect_and_append_host_environment_hints(command_str, &mut result);

    Ok(result)
}

/// 针对宿主环境探查中的常见系统陷阱（如 Windows WMI 32 位显存截断）追加纠偏提示，
/// 引导 Agent 触发次轮工具调用进行交叉验证，避免草率结案或向用户推诿。
pub fn detect_and_append_host_environment_hints(command_str: &str, output: &mut String) {
    let lower_cmd = command_str.to_lowercase();
    let lower_out = output.to_lowercase();

    // 检查 Windows 下 Win32_VideoController 显存 32 位溢出截断陷阱
    let is_video_controller_query = lower_cmd.contains("win32_videocontroller")
        || lower_cmd.contains("video_controller")
        || lower_out.contains("win32_videocontroller");
    let has_vram_overflow_signature = lower_cmd.contains("adapterram")
        || lower_out.contains("adapterram")
        || lower_out.contains("4293918720")
        || lower_out.contains("4294967295")
        || lower_out.contains("4294901760");

    if is_video_controller_query && has_vram_overflow_signature {
        output.push_str(
            "\n\n[系统环境纠偏提示：Win32_VideoController.AdapterRAM 在 Windows 下为 32 位 uint32 字段，物理上限仅为 4GB (4294967295/4293918720 bytes)。现代 6G/8G/12G/16G/24G 等显卡显存均会被溢出截断为此数值，不可作为真实显存依据！请勿直接结束工具调用或向用户猜测规格，请在下一轮工具调用中执行准确命令验证：\n1) 若系统含 NVIDIA 显卡，执行：nvidia-smi；\n2) 通用显卡通过注册表查询 64 位 QWORD：Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | Select-Object DriverDesc, @{N='VRAM_GB';E={[math]::Round($_.'HardwareInformation.qwMemorySize'/1GB, 2)}}, DriverVersion]"
        );
    }
}

