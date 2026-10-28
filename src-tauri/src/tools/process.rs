//! 受管命令执行：结构化结果、增量输出、进程树终止与按运行登记的进程表。
//!
//! 命令以独立进程组（Unix）或作业对象（Windows）启动，超时、取消或主进程退出后
//! 统一终止整棵进程树，并如实报告是否确认全部退出；无法确认时不伪装成已停止。
use crate::tools::floor_char_boundary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub const DEFAULT_TIMEOUT_SECS: u64 = 120;
pub const MAX_TIMEOUT_SECS: u64 = 1800;
/// 内存中保留的完整输出上限；超出后写入工作区日志文件，内存只保留首尾
const CAPTURE_LIMIT: usize = 1024 * 1024;
/// 超出捕获上限后保留的末尾片段
const TAIL_LIMIT: usize = 8 * 1024;
/// 增量输出的推送周期与单次上限：限制界面刷新频率与事件体积，较早的输出以跳过标记代替
const LIVE_FLUSH_INTERVAL: Duration = Duration::from_millis(100);
const LIVE_CHUNK_LIMIT: usize = 16 * 1024;
/// 请求终止后等待主进程退出的时长，超时再强制结束
const TERMINATE_GRACE: Duration = Duration::from_secs(3);
/// 强制结束后确认整棵进程树退出的时长
const CONFIRM_GRACE: Duration = Duration::from_secs(2);
/// 主进程退出后读取剩余输出的时长：后台残留进程可能一直占着管道
const DRAIN_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandEndReason {
    /// 主进程自行退出（退出码见 exit_code）
    Exited,
    TimedOut,
    /// 运行被取消或用户单独停止了这条命令
    Cancelled,
    SpawnFailed,
    /// 安全策略拦截，未启动进程
    Blocked,
}

/// 一次命令执行的结构化记录：模型与界面都以它判断成功与否，而不是从输出文字里猜
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutcome {
    pub execution_id: String,
    pub command: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub end_reason: CommandEndReason,
    /// 结束时整棵进程树已确认退出；为 false 表示可能仍有进程在运行，结果未知
    pub exit_confirmed: bool,
    /// 主进程退出后被终止的残留后台进程
    pub orphans_terminated: bool,
    #[serde(skip)]
    pub output: String,
    pub output_bytes: u64,
    /// 输出超出内存上限，output 只含首尾
    pub truncated: bool,
    /// 完整输出日志（工作区相对路径）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
}

impl CommandOutcome {
    pub fn succeeded(&self) -> bool {
        self.end_reason == CommandEndReason::Exited && self.exit_code == Some(0) && self.exit_confirmed
    }

    fn not_started(command: &str, cwd: &Path, reason: CommandEndReason, message: String) -> Self {
        Self {
            execution_id: next_execution_id(),
            command: command.to_string(),
            cwd: crate::tools::display_path(cwd),
            exit_code: None,
            duration_ms: 0,
            end_reason: reason,
            exit_confirmed: true,
            orphans_terminated: false,
            output_bytes: message.len() as u64,
            output: message,
            truncated: false,
            log_path: None,
        }
    }
}

/// 正在执行的受管命令，供查询与单独停止
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub execution_id: String,
    /// 发起它的工具调用
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    pub command: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub started_at: u64,
}

struct ProcessEntry {
    info: ProcessInfo,
    stop: Arc<AtomicBool>,
}

/// 运行内的进程表：命令启动时登记、结束时注销，运行的取消与单条命令的停止都经由它
#[derive(Default)]
pub struct ProcessTable {
    entries: Mutex<HashMap<String, ProcessEntry>>,
}

impl std::fmt::Debug for ProcessTable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessTable").field("running", &self.list().len()).finish()
    }
}

impl ProcessTable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn list(&self) -> Vec<ProcessInfo> {
        let mut list: Vec<ProcessInfo> = self
            .entries
            .lock()
            .map(|entries| entries.values().map(|entry| entry.info.clone()).collect())
            .unwrap_or_default();
        list.sort_by_key(|info| info.started_at);
        list
    }

    /// 请求停止单条命令；返回 false 表示该命令已结束或不存在
    pub fn stop(&self, execution_id: &str) -> bool {
        match self.entries.lock() {
            Ok(entries) => entries.get(execution_id).map(|entry| entry.stop.store(true, Ordering::SeqCst)).is_some(),
            Err(_) => false,
        }
    }

    /// 按发起它的工具调用停止命令：界面在命令输出前就能停止，不必先拿到执行编号
    pub fn stop_call(&self, call_id: &str) -> bool {
        match self.entries.lock() {
            Ok(entries) => {
                let mut stopped = false;
                for entry in entries.values().filter(|entry| entry.info.call_id.as_deref() == Some(call_id)) {
                    entry.stop.store(true, Ordering::SeqCst);
                    stopped = true;
                }
                stopped
            }
            Err(_) => false,
        }
    }

    fn register(&self, info: ProcessInfo, stop: Arc<AtomicBool>) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(info.execution_id.clone(), ProcessEntry { info, stop });
        }
    }

    fn set_pid(&self, execution_id: &str, pid: Option<u32>) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(entry) = entries.get_mut(execution_id) {
                entry.info.pid = pid;
            }
        }
    }

    fn remove(&self, execution_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(execution_id);
        }
    }
}

struct Registration<'a> {
    table: Option<&'a ProcessTable>,
    execution_id: String,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        if let Some(table) = self.table {
            table.remove(&self.execution_id);
        }
    }
}

pub type OutputObserver<'a> = &'a (dyn Fn(OutputStream, &str) + Send + Sync);

/// 命令执行的外部控制：运行级取消标志、进程表与增量输出回调均可缺省（界面终端只需结果）
#[derive(Default, Clone, Copy)]
pub struct CommandControl<'a> {
    pub cancelled: Option<&'a AtomicBool>,
    pub processes: Option<&'a ProcessTable>,
    pub call_id: Option<&'a str>,
    pub observer: Option<OutputObserver<'a>>,
    /// 超出内存上限的完整日志写到该工作区的 `.yachiyo/spill/` 下
    pub log_root: Option<&'a Path>,
}

fn next_execution_id() -> String {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    format!(
        "exec-{}-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

pub fn clamp_timeout(timeout_secs: Option<u64>) -> Duration {
    Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, MAX_TIMEOUT_SECS))
}

fn shell_command(command: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = Command::new("powershell");
        // 同时设置管道输入和控制台输出编码，让原生命令与 PowerShell 共用 UTF-8。
        let script = format!(
            "[Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding = [System.Text.UTF8Encoding]::new($false);\n{}",
            command
        );
        c.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        // 独立进程组：终止时整组发送信号，覆盖 shell 派生的全部子进程
        c.process_group(0);
        c
    }
}

/// 增量 UTF-8 解码：网络与管道分块可能切在多字节字符中间
#[derive(Default)]
struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut text = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    text.push_str(valid);
                    self.pending.clear();
                    return text;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    text.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match error.error_len() {
                        Some(invalid) => {
                            text.push('\u{fffd}');
                            self.pending.drain(..valid + invalid);
                        }
                        None => {
                            self.pending.drain(..valid);
                            return text;
                        }
                    }
                }
            }
        }
    }

    fn finish(&mut self) -> String {
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        rest
    }
}

/// 输出捕获：上限内全部保存在内存，超出后完整内容写入日志文件，内存只保留开头与末尾
struct OutputCapture {
    head: String,
    tail: String,
    total_bytes: u64,
    overflowed: bool,
    log: Option<(std::fs::File, String)>,
    log_root: Option<PathBuf>,
}

impl OutputCapture {
    fn new(log_root: Option<&Path>) -> Self {
        Self { head: String::new(), tail: String::new(), total_bytes: 0, overflowed: false, log: None, log_root: log_root.map(Path::to_path_buf) }
    }

    fn push(&mut self, text: &str) {
        self.total_bytes += text.len() as u64;
        if !self.overflowed && self.head.len() + text.len() <= CAPTURE_LIMIT {
            self.head.push_str(text);
            return;
        }
        if !self.overflowed {
            self.overflowed = true;
            self.log = self.open_log();
            if let Some((file, _)) = self.log.as_mut() {
                use std::io::Write;
                let _ = file.write_all(self.head.as_bytes());
            }
        }
        if let Some((file, _)) = self.log.as_mut() {
            use std::io::Write;
            let _ = file.write_all(text.as_bytes());
        }
        self.tail.push_str(text);
        if self.tail.len() > TAIL_LIMIT * 2 {
            let mut start = self.tail.len() - TAIL_LIMIT;
            while !self.tail.is_char_boundary(start) {
                start += 1;
            }
            self.tail.drain(..start);
        }
    }

    fn open_log(&self) -> Option<(std::fs::File, String)> {
        let root = self.log_root.as_deref()?;
        let relative = format!(".yachiyo/spill/command-{}.log", next_execution_id());
        let path = crate::tools::fs::resolve_tool_path(&relative, root).ok()?;
        std::fs::create_dir_all(path.parent()?).ok()?;
        let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).ok()?;
        Some((file, relative))
    }

    /// 返回（输出文本，是否截断，日志路径）
    fn finish(mut self) -> (String, bool, Option<String>) {
        if !self.overflowed {
            return (self.head, false, None);
        }
        let log_path = self.log.take().map(|(_, path)| path);
        let head_cut = floor_char_boundary(&self.head, TAIL_LIMIT);
        let mut tail_start = self.tail.len().saturating_sub(TAIL_LIMIT);
        while !self.tail.is_char_boundary(tail_start) {
            tail_start += 1;
        }
        let shown = (head_cut + self.tail.len() - tail_start) as u64;
        let note = match log_path.as_deref() {
            Some(path) => format!("\n[... 输出共 {} 字节，中间省略 {} 字节；完整日志：{} ...]\n", self.total_bytes, self.total_bytes.saturating_sub(shown), path),
            None => format!("\n[... 输出共 {} 字节，中间省略 {} 字节（未绑定项目，完整日志未保存） ...]\n", self.total_bytes, self.total_bytes.saturating_sub(shown)),
        };
        (format!("{}{}{}", &self.head[..head_cut], note, &self.tail[tail_start..]), true, log_path)
    }
}

/// 增量输出节流：周期内的输出合并推送，单次超过上限只推送末尾并标注跳过的字节数
struct LiveBuffer {
    pending: [String; 2],
}

impl LiveBuffer {
    fn new() -> Self {
        Self { pending: [String::new(), String::new()] }
    }

    fn push(&mut self, stream: OutputStream, text: &str) {
        self.pending[stream as usize].push_str(text);
    }

    fn flush(&mut self, observer: Option<OutputObserver<'_>>) {
        let Some(observer) = observer else {
            self.pending.iter_mut().for_each(String::clear);
            return;
        };
        for (index, stream) in [OutputStream::Stdout, OutputStream::Stderr].into_iter().enumerate() {
            let pending = std::mem::take(&mut self.pending[index]);
            if pending.is_empty() {
                continue;
            }
            if pending.len() <= LIVE_CHUNK_LIMIT {
                observer(stream, &pending);
            } else {
                let mut start = pending.len() - LIVE_CHUNK_LIMIT;
                while !pending.is_char_boundary(start) {
                    start += 1;
                }
                observer(stream, &format!("[… 跳过 {} 字节 …]\n{}", start, &pending[start..]));
            }
        }
    }
}

/// 进程树句柄：Unix 为进程组，Windows 为作业对象（附带 taskkill 兜底）
struct ProcessTree {
    pid: Option<u32>,
    #[cfg(target_os = "windows")]
    job: Option<windows_job::Job>,
}

impl ProcessTree {
    fn attach(child: &tokio::process::Child) -> Self {
        Self {
            pid: child.id(),
            #[cfg(target_os = "windows")]
            job: windows_job::Job::assign(child),
        }
    }

    /// 是否仍有属于这棵树的进程存活（主进程已回收后用于检查残留后台进程）
    fn has_live_members(&self) -> bool {
        #[cfg(unix)]
        {
            match self.pid {
                // SAFETY: killpg 的信号 0 只做存在性检查，不影响任何进程
                Some(pid) => unsafe { libc::killpg(pid as libc::pid_t, 0) == 0 },
                None => false,
            }
        }
        #[cfg(target_os = "windows")]
        {
            self.job.as_ref().map(windows_job::Job::active_processes).unwrap_or(0) > 0
        }
        #[cfg(not(any(unix, target_os = "windows")))]
        {
            false
        }
    }

    fn terminate(&self) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            // SAFETY: 向本次启动的独立进程组发送终止信号
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGTERM);
            }
        }
        #[cfg(target_os = "windows")]
        self.kill();
    }

    fn kill(&self) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            // SAFETY: 同上，强制结束整组
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGKILL);
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(job) = &self.job {
                job.terminate();
            }
            // 作业分配之前派生的进程不在作业内，再按进程树兜底结束
            if let Some(pid) = self.pid {
                let mut taskkill = std::process::Command::new("taskkill");
                taskkill.args(["/T", "/F", "/PID", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
                {
                    use std::os::windows::process::CommandExt;
                    taskkill.creation_flags(0x0800_0000);
                }
                let _ = taskkill.status();
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_job {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
        QueryInformationJobObject, SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// 带“关闭即终止”限制的作业对象：句柄关闭时作业内残留进程一并结束
    pub struct Job(HANDLE);

    // SAFETY: 作业句柄是内核对象句柄，可跨线程使用
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn assign(child: &tokio::process::Child) -> Option<Self> {
            let process = child.raw_handle()? as HANDLE;
            // SAFETY: 参数均为有效指针或空指针，失败时返回空句柄
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return None;
                }
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let configured = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) != 0;
                if !configured || AssignProcessToJobObject(job, process) == 0 {
                    CloseHandle(job);
                    return None;
                }
                Some(Self(job))
            }
        }

        pub fn terminate(&self) {
            // SAFETY: 句柄在 Job 生命周期内有效
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }

        pub fn active_processes(&self) -> u32 {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            // SAFETY: 输出缓冲区大小与结构体一致
            let ok = unsafe {
                QueryInformationJobObject(
                    self.0,
                    JobObjectBasicAccountingInformation,
                    &mut info as *mut _ as *mut core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                )
            } != 0;
            if ok { info.ActiveProcesses } else { 0 }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: 句柄只在此处关闭一次
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

enum Stop {
    Timeout,
    Cancelled,
}

/// 执行一条命令直至结束。超时、运行取消或单独停止都会终止整棵进程树并等待确认，
/// 不会在进程仍可能运行时提前返回“已停止”。
pub async fn execute_command(command: &str, cwd: &Path, timeout: Duration, control: CommandControl<'_>) -> CommandOutcome {
    if crate::tools::shell::is_dangerous_command(command) {
        return CommandOutcome::not_started(
            command,
            cwd,
            CommandEndReason::Blocked,
            format!("命令 '{}' 包含潜在的破坏性操作，已被安全策略拦截，未执行。", command),
        );
    }

    let execution_id = next_execution_id();
    let stop_requested = Arc::new(AtomicBool::new(false));
    if let Some(table) = control.processes {
        table.register(
            ProcessInfo {
                execution_id: execution_id.clone(),
                call_id: control.call_id.map(str::to_string),
                command: command.to_string(),
                cwd: crate::tools::display_path(cwd),
                pid: None,
                started_at: now_ms(),
            },
            Arc::clone(&stop_requested),
        );
    }
    let _registration = Registration { table: control.processes, execution_id: execution_id.clone() };

    let started = Instant::now();
    let mut cmd = shell_command(command);
    cmd.current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            let mut outcome = CommandOutcome::not_started(command, cwd, CommandEndReason::SpawnFailed, format!("无法启动命令: {error}"));
            outcome.execution_id = execution_id;
            return outcome;
        }
    };
    let tree = ProcessTree::attach(&child);
    if let Some(table) = control.processes {
        table.set_pid(&execution_id, tree.pid);
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(OutputStream, Vec<u8>)>();
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(spawn_reader(stdout, OutputStream::Stdout, tx.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(spawn_reader(stderr, OutputStream::Stderr, tx.clone()));
    }
    drop(tx);

    let mut capture = OutputCapture::new(control.log_root);
    let mut live = LiveBuffer::new();
    let mut decoders = [Utf8Decoder::default(), Utf8Decoder::default()];
    let mut ingest = |stream: OutputStream, bytes: &[u8], capture: &mut OutputCapture, live: &mut LiveBuffer| {
        let text = decoders[stream as usize].push(bytes);
        if !text.is_empty() {
            capture.push(&text);
            live.push(stream, &text);
        }
    };

    let deadline = tokio::time::Instant::now() + timeout;
    let mut ticker = tokio::time::interval(LIVE_FLUSH_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut channel_open = true;
    let mut stop: Option<Stop> = None;
    let mut status: Option<std::process::ExitStatus> = None;

    while status.is_none() && stop.is_none() {
        tokio::select! {
            biased;
            chunk = rx.recv(), if channel_open => match chunk {
                Some((stream, bytes)) => ingest(stream, &bytes, &mut capture, &mut live),
                None => channel_open = false,
            },
            exited = child.wait() => {
                status = Some(exited.unwrap_or_else(|_| failed_status()));
            }
            _ = tokio::time::sleep_until(deadline) => stop = Some(Stop::Timeout),
            _ = ticker.tick() => {
                live.flush(control.observer);
                let run_cancelled = control.cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed));
                if run_cancelled || stop_requested.load(Ordering::SeqCst) {
                    stop = Some(Stop::Cancelled);
                }
            }
        }
    }

    let mut exit_confirmed = true;
    let mut orphans_terminated = false;
    if stop.is_some() {
        // 先请求结束，宽限期后强制结束，再确认整棵树退出
        tree.terminate();
        status = tokio::time::timeout(TERMINATE_GRACE, child.wait()).await.ok().and_then(Result::ok);
        if status.is_none() || tree.has_live_members() {
            tree.kill();
            if status.is_none() {
                status = tokio::time::timeout(CONFIRM_GRACE, child.wait()).await.ok().and_then(Result::ok);
            }
        }
        exit_confirmed = status.is_some() && wait_tree_gone(&tree).await;
    } else if tree.has_live_members() {
        // 主进程已退出但仍有后台进程：它们属于这次命令，随命令结束一并终止
        orphans_terminated = true;
        tree.terminate();
        if !wait_tree_gone(&tree).await {
            tree.kill();
            exit_confirmed = wait_tree_gone(&tree).await;
        }
    }

    // 读取剩余输出；进程树已结束时管道随之关闭，残留写端只会等到宽限期结束
    let drain_deadline = tokio::time::Instant::now() + DRAIN_GRACE;
    while channel_open {
        match tokio::time::timeout_at(drain_deadline, rx.recv()).await {
            Ok(Some((stream, bytes))) => ingest(stream, &bytes, &mut capture, &mut live),
            Ok(None) | Err(_) => channel_open = false,
        }
    }
    for reader in readers {
        reader.abort();
    }
    for (index, stream) in [OutputStream::Stdout, OutputStream::Stderr].into_iter().enumerate() {
        let rest = decoders[index].finish();
        if !rest.is_empty() {
            capture.push(&rest);
            live.push(stream, &rest);
        }
    }
    live.flush(control.observer);

    let end_reason = match stop {
        Some(Stop::Timeout) => CommandEndReason::TimedOut,
        Some(Stop::Cancelled) => CommandEndReason::Cancelled,
        None => CommandEndReason::Exited,
    };
    let output_bytes = capture.total_bytes;
    let (output, truncated, log_path) = capture.finish();
    CommandOutcome {
        execution_id,
        command: command.to_string(),
        cwd: crate::tools::display_path(cwd),
        exit_code: status.and_then(|status| status.code()),
        duration_ms: started.elapsed().as_millis() as u64,
        end_reason,
        exit_confirmed,
        orphans_terminated,
        output,
        output_bytes,
        truncated,
        log_path,
    }
}

async fn wait_tree_gone(tree: &ProcessTree) -> bool {
    let deadline = Instant::now() + CONFIRM_GRACE;
    loop {
        if !tree.has_live_members() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn failed_status() -> std::process::ExitStatus {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(1 << 8)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(1)
    }
}

fn spawn_reader<R>(mut reader: R, stream: OutputStream, tx: tokio::sync::mpsc::UnboundedSender<(OutputStream, Vec<u8>)>) -> tokio::task::JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buffer = vec![0u8; 8 * 1024];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if tx.send((stream, buffer[..read].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    })
}

fn format_duration(ms: u64) -> String {
    if ms < 1000 {
        format!("{ms} 毫秒")
    } else {
        format!("{:.1} 秒", ms as f64 / 1000.0)
    }
}

/// 命令结论的一行说明，同时用于模型与界面
pub fn describe_outcome(outcome: &CommandOutcome, timeout: Option<Duration>) -> String {
    let duration = format_duration(outcome.duration_ms);
    let confirmation = if outcome.exit_confirmed { "进程树已确认退出" } else { "未能确认进程树全部退出，可能仍有进程在运行，结果未知" };
    match outcome.end_reason {
        CommandEndReason::Exited if outcome.exit_code == Some(0) && outcome.exit_confirmed => format!("成功：退出码 0，耗时 {duration}"),
        CommandEndReason::Exited if outcome.exit_code == Some(0) => format!("主进程退出码 0，但{confirmation}，耗时 {duration}"),
        CommandEndReason::Exited => match outcome.exit_code {
            Some(code) => format!("失败：退出码 {code}，耗时 {duration}"),
            None => format!("失败：进程被信号终止，耗时 {duration}"),
        },
        CommandEndReason::TimedOut => format!(
            "超时：超过 {} 秒未结束，已终止，{confirmation}",
            timeout.map(|t| t.as_secs()).unwrap_or(DEFAULT_TIMEOUT_SECS)
        ),
        CommandEndReason::Cancelled => format!("已取消：命令在运行 {duration} 后被停止，{confirmation}"),
        CommandEndReason::SpawnFailed => "未启动：无法创建进程".to_string(),
        CommandEndReason::Blocked => "未执行：被安全策略拦截".to_string(),
    }
}

/// 回填给模型的命令记录：命令、工作目录、结论与输出，结论放在开头，避免被长输出淹没
pub fn format_for_model(outcome: &CommandOutcome, timeout: Option<Duration>) -> String {
    let mut text = format!(
        "[命令] {}\n[工作目录] {}\n[结果] {}\n",
        outcome.command,
        outcome.cwd,
        describe_outcome(outcome, timeout)
    );
    if outcome.orphans_terminated {
        text.push_str("[说明] 主进程退出后仍有后台进程，已随命令一并终止；需要常驻的服务不要用 run_command 启动。\n");
    }
    if outcome.output.is_empty() {
        text.push_str("[输出] （无）");
    } else {
        text.push_str("[输出]\n");
        text.push_str(&outcome.output);
    }
    crate::tools::shell::detect_and_append_host_environment_hints(&outcome.command, &mut text);
    text
}
