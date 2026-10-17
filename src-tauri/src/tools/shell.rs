use crate::tools::floor_char_boundary;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// POSIX 与 PowerShell/CMD 两侧的删除动词（`ri` 为 Remove-Item 别名，`rd`/`rmdir` 为目录删除）
const DELETE_VERBS: [&str; 7] = ["rm", "del", "erase", "rd", "rmdir", "remove-item", "ri"];

/// 把内容整体写入/清空目标文件的 cmdlet
const OVERWRITE_VERBS: [&str; 4] = ["out-file", "set-content", "clear-content", "add-content"];

/// 关键系统目录首段：删除动词与递归标志命中这些目录时按盘根对待
const SYSTEM_ROOT_SEGMENTS: [&str; 5] =
    ["windows", "system32", "sysvol", "boot", "$recycle.bin"];

/// 高危命令特征检测。
///
/// 定位是**纵深防御、非权威边界**：命令串最终交给 `powershell -Command` / `sh -c` 解释执行，
/// 字符串层面的检测理论上可被变量展开、别名、拼接等方式绕开，因此不承诺完备防护。
/// 真正的授权边界是 Write 类工具的用户审批（`tool_risk` + `ApprovalRegistry` + `ToolAuthorization`）；
/// 本函数只负责拦下形态明确无歧义的破坏性操作，避免模型误判直接落到主机上。
pub fn is_dangerous_command(command: &str) -> bool {
    let normalized = normalize_command(command);
    let tokens: Vec<&str> = normalized.split(' ').collect();

    has_indirect_execution(&tokens, &normalized)
        || has_destructive_delete(&tokens)
        || has_root_overwrite(&tokens)
        || has_host_level_destruction(&tokens)
}

/// 归一化：小写、剥离引号字符、把 shell 与 PowerShell 的结构标点视作分隔符并折叠连续空白。
/// 使 `rm   -r  -f "/"`、`[Convert]::FromBase64String(...)`、`iex(...)` 都收敛成可逐词比对的形态。
fn normalize_command(command: &str) -> String {
    let stripped: String = command
        .to_lowercase()
        .chars()
        .filter(|c| !matches!(c, '"' | '\'' | '`'))
        .map(|c| {
            if matches!(
                c,
                '[' | ']' | '(' | ')' | '{' | '}' | ';' | '|' | '&' | ',' | '\n' | '\r' | '\t'
            ) {
                ' '
            } else {
                c
            }
        })
        .collect();
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 取命令词干：剥离路径前缀与可执行扩展名，使 `/bin/rm`、`shutdown.exe` 归约为 `rm`、`shutdown`
fn command_name(token: &str) -> &str {
    let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
    for ext in [".exe", ".com", ".bat", ".cmd"] {
        if let Some(stem) = base.strip_suffix(ext) {
            return stem;
        }
    }
    base
}

/// 目标是否指向文件系统根或盘根：`/`、`/*`、`\`、`c:`、`c:\`、`c:\*`
fn is_filesystem_root(target: &str) -> bool {
    let unified = target.replace('\\', "/");
    let core = unified.trim_end_matches(['*', '/']);
    if core.is_empty() {
        // 只有以分隔符起始的形态才算根，`*` 这类当前目录通配不在本检测范围内
        return unified.starts_with('/');
    }
    let mut chars = core.chars();
    match (chars.next(), chars.next(), chars.next()) {
        (Some(drive), Some(':'), None) => drive.is_ascii_alphabetic(),
        _ => false,
    }
}

/// 目标是否为绝对形态的关键系统目录（`c:\windows`、`/system32`、`c:\$recycle.bin`）
fn is_system_path_root(target: &str) -> bool {
    let unified = target.replace('\\', "/");
    let rest = match unified.split_once(':') {
        Some((drive, remainder)) if drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic() => {
            remainder
        }
        Some(_) => return false,
        None => &unified,
    };
    // 仅认定绝对路径形态，避免把同名的工作区相对目录误判为系统关键路径
    let Some(absolute) = rest.strip_prefix('/') else {
        return false;
    };
    let first_segment = absolute.split('/').next().unwrap_or("");
    SYSTEM_ROOT_SEGMENTS.contains(&first_segment)
}

fn has_root_target(tokens: &[&str]) -> bool {
    tokens
        .iter()
        .any(|token| is_filesystem_root(token) || is_system_path_root(token))
}

/// 递归删除标志：POSIX 的 `-r`/`--recursive` 与 `-rf`/`-fr` 组合短选项簇，
/// PowerShell 的 `-Recurse`，CMD 的 `/s`
fn has_recursive_flag(tokens: &[&str]) -> bool {
    tokens.iter().any(|token| {
        let Some(flag) = token
            .strip_prefix("--")
            .or_else(|| token.strip_prefix(['-', '/']))
        else {
            return false;
        };
        match flag {
            "recursive" | "recurse" => true,
            // 短选项簇按字符判定；长度上界避免把长选项与路径误当作选项
            other => other.len() <= 3 && other.contains(['r', 's']),
        }
    })
}

/// 删除族：递归删除动词命中盘根或关键系统路径
fn has_destructive_delete(tokens: &[&str]) -> bool {
    let has_delete_verb = tokens
        .iter()
        .any(|token| DELETE_VERBS.contains(&command_name(token)));
    has_delete_verb && has_recursive_flag(tokens) && has_root_target(tokens)
}

fn is_root_target(token: &str) -> bool {
    !token.is_empty() && (is_filesystem_root(token) || is_system_path_root(token))
}

/// 重定向符号词元：`>`、`>>` 以及带句柄前缀的 `2>`、`*>`、`&>` 形态
fn is_redirect_token(token: &str) -> bool {
    token.contains('>')
        && token
            .chars()
            .all(|c| matches!(c, '>' | '<' | '&' | '*' | '1' | '2'))
}

/// 内容重写族：`Out-File`/`Clear-Content` 等 cmdlet 或重定向符号**紧邻**盘根/系统路径时才判定。
/// 只认紧邻目标、不看命令中是否另有裸 `/`，避免 `find / -name '*.log' > out.txt`
/// 这类正常探查命令因两个无关词元被聚合而误拦。
fn has_root_overwrite(tokens: &[&str]) -> bool {
    // `>C:\Windows\x` 这类符号与目标粘连在同一词元内的形态
    if tokens.iter().any(|token| {
        let redirected = token.trim_start_matches('>');
        redirected != *token && is_root_target(redirected)
    }) {
        return true;
    }

    let overwrote_via_parameter = tokens
        .iter()
        .any(|token| OVERWRITE_VERBS.contains(&command_name(token)));

    tokens.windows(2).any(|pair| {
        let (marker, target) = (pair[0], pair[1]);
        if !is_root_target(target) {
            return false;
        }
        is_redirect_token(marker)
            || OVERWRITE_VERBS.contains(&command_name(marker))
            // cmdlet 的 `-Path C:\Windows\x` 形态：参数名与目标相邻，写入动词在命令中另处出现
            || (matches!(marker, "-path" | "-literalpath" | "-filepath") && overwrote_via_parameter)
    })
}

/// 主机级破坏：格式化磁盘、分区、建文件系统、关机、整库删除
fn has_host_level_destruction(tokens: &[&str]) -> bool {
    if tokens.iter().any(|token| {
        matches!(
            command_name(token),
            "diskpart" | "shutdown" | "stop-computer" | "restart-computer" | "logoff"
            | "format-volume" | "clear-disk" | "remove-partition"
        ) || command_name(token).starts_with("mkfs")
    }) {
        return true;
    }
    // `format` 需要伴随盘根目标，避免误伤 `dotnet format`、`--format csv` 之类正常用法
    if tokens.iter().any(|token| command_name(token) == "format") && has_root_target(tokens) {
        return true;
    }
    tokens
        .windows(2)
        .any(|pair| pair[0] == "drop" && pair[1] == "database")
}

/// 编码与间接执行族：载荷不可读，无法判定其真实语义，一律拒绝。
/// 这是有意的保守取舍——放行的收益远低于不可见命令执行的代价。
fn has_indirect_execution(tokens: &[&str], normalized: &str) -> bool {
    if normalized.contains("frombase64string")
        || normalized.contains("invoke-expression")
        || tokens.iter().any(|token| command_name(token) == "iex")
    {
        return true;
    }
    if tokens
        .iter()
        .any(|token| command_name(token) == "certutil")
        && tokens.iter().any(|token| token.starts_with("-decode"))
    {
        return true;
    }
    let powershell_present = tokens
        .iter()
        .any(|token| matches!(command_name(token), "powershell" | "pwsh"));
    tokens.windows(2).any(|pair| {
        let flag = pair[0].trim_start_matches('-');
        match flag {
            "encodedcommand" | "enc" => true,
            // 单独的 `-e` 也是 Node 等解释器的常规内联参数，只在与 PowerShell 同现时才判定
            "e" => powershell_present && looks_like_base64(pair[1]),
            _ => false,
        }
    })
}

fn looks_like_base64(token: &str) -> bool {
    token.len() >= 24
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
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
    // 超时分支会丢弃 wait future，若不留杀手机制则子进程会成为挂活进程继续占资源
    cmd.kill_on_drop(true);

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn command: {}", e))?;

    let output_future = child.wait_with_output();
    let output = match timeout(timeout_duration, output_future).await {
        Ok(res) => res.map_err(|e| format!("Command execution failed: {}", e))?,
        Err(_) => return Err(format!("Command execution timed out after {}s", timeout_duration.as_secs())),
    };

    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stdout.len() > MAX_OUTPUT_BYTES {
        stdout.truncate(floor_char_boundary(&stdout, MAX_OUTPUT_BYTES));
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

