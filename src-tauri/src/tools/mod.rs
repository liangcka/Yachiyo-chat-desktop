pub mod fs;
pub mod git;
pub mod search;
pub mod shell;
pub mod web;

pub use fs::FsObservationTracker;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use crate::types::AgentExecutionMode;

/// 工具风险分级；无项目的本地读取还需要路径级授权。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRisk {
    Read,
    Write,
}

pub const PROJECT_REQUIRED_FOR_WRITE: &str = "当前未选择项目，无法写入。请让用户在侧栏选择项目。";

pub fn is_unbound_file_read(name: &str, workspace_root: Option<&Path>) -> bool {
    workspace_root.is_none() && matches!(name, "read_file" | "list_directory")
}

/// 工具执行的授权来源：把「谁授权了这次执行」写成类型上显式的契约，
/// 使执行边界自身成为权威判定点，而不依赖调用方自觉先问再调。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolAuthorization {
    /// 由界面中的人类操作直接发起（编辑器保存、diff 应用、终端面板手敲命令等）
    HumanInitiated,
    /// 由模型发起的工具调用；`approved` 为是否已取得用户审批放行
    ModelInitiated { approved: bool },
    Agent { mode: AgentExecutionMode, approved: bool },
}

pub fn authorize_tool(name: &str, auth: ToolAuthorization) -> Result<(), String> {
    if tool_risk(name) != Some(ToolRisk::Write) {
        return Ok(());
    }
    match auth {
        ToolAuthorization::Agent { mode: AgentExecutionMode::Readonly, .. } => {
            Err("只读模式不允许写入文件、执行命令或调用 MCP 工具。".to_string())
        }
        ToolAuthorization::ModelInitiated { approved: false }
        | ToolAuthorization::Agent { mode: AgentExecutionMode::Confirm, approved: false } => {
            Err("本次写类工具调用未获得用户授权，已拒绝执行。".to_string())
        }
        _ => Ok(()),
    }
}

pub fn tool_risk(name: &str) -> Option<ToolRisk> {
    if name.starts_with("mcp__") {
        return Some(ToolRisk::Write);
    }
    match name {
        "read_file" | "list_directory" | "glob" | "grep" | "git_status" | "git_diff" | "web_fetch"
        | "web_search" | "todo_write" | "task" | crate::gateway::prompt::READ_GUIDELINE_TOOL => {
            Some(ToolRisk::Read)
        }
        "write_file" | "edit_file" | "run_command" => Some(ToolRisk::Write),
        _ => None,
    }
}

/// 回填模型前的工具输出上限（字节）
fn tool_output_limit(name: &str) -> usize {
    match name {
        "read_file" => 64 * 1024,
        "grep" => 32 * 1024,
        "run_command" => 16 * 1024,
        "web_fetch" => 32 * 1024,
        _ => 16 * 1024,
    }
}

/// 截断到字符边界的安全切片（不产生 panic）
pub(crate) fn floor_char_boundary(s: &str, mut index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    while index > 0 && !s.is_char_boundary(index) {
        index -= 1;
    }
    index
}

pub fn truncate_tool_output(name: &str, output: &str) -> String {
    let limit = tool_output_limit(name);
    if output.len() <= limit {
        return output.to_string();
    }
    let cut = floor_char_boundary(output, limit);
    format!(
        "{}\n[输出已截断：原始 {} 字节，截断至 {} 字节]",
        &output[..cut],
        output.len(),
        cut
    )
}

/// 对齐 DSH spill-policy：
/// 当工具输出超出上限时，将完整内容落盘至 .yachiyo/spill/ 目录，
/// 返回 head/tail 预览并附带落地文件路径与检索引导，避免上下文撑爆同时保留完整信息。
pub fn process_tool_output(name: &str, output: &str, workspace_root: Option<&Path>) -> String {
    let limit = tool_output_limit(name);
    if output.len() <= limit {
        return output.to_string();
    }

    let Some(workspace_root) = workspace_root else {
        return truncate_tool_output(name, output);
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 同一秒内可能有多份超长输出落盘，序号保证文件名不重复、后写的不会覆盖先写的
    static SPILL_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SPILL_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let filename = format!("spill-{}-{}-{}.txt", timestamp, sequence, name);
    let Ok(spill_path) = fs::resolve_tool_path(&format!(".yachiyo/spill/{filename}"), workspace_root) else {
        return truncate_tool_output(name, output);
    };
    let Some(spill_dir) = spill_path.parent() else { return truncate_tool_output(name, output); };

    let written = std::fs::create_dir_all(spill_dir)
        .and_then(|_| std::fs::write(&spill_path, output));

    if written.is_ok() {
        const HEAD_LIMIT: usize = 2 * 1024;
        const TAIL_LIMIT: usize = 1024;
        let head_cut = floor_char_boundary(output, HEAD_LIMIT);
        let tail_start = if output.len() > TAIL_LIMIT {
            let mut start = output.len() - TAIL_LIMIT;
            while start < output.len() && !output.is_char_boundary(start) {
                start += 1;
            }
            start
        } else {
            output.len()
        };

        let head = &output[..head_cut];
        let tail = &output[tail_start..];
        let omitted = output.len().saturating_sub(head_cut + (output.len() - tail_start));

        format!(
            "{}\n\n[... 工具输出过长，已省略中间 {} 字节 ...]\n\n{}\n\n[提示：原始完整输出共 {} 字节，已保存至工作区: .yachiyo/spill/{}。若需查阅中间内容，请使用 read_file 查看该文件。]",
            head, omitted, tail, output.len(), filename
        )
    } else {
        truncate_tool_output(name, output)
    }
}


/// 下发给前端 ToolCard 的 2KB 预览
pub fn preview_tool_output(output: &str) -> String {
    const PREVIEW_LIMIT: usize = 2 * 1024;
    if output.len() <= PREVIEW_LIMIT {
        return output.to_string();
    }
    let cut = floor_char_boundary(output, PREVIEW_LIMIT);
    format!("{}…", &output[..cut])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub output: String,
    pub is_error: bool,
}

#[derive(Debug)]
struct LeaseEntry {
    id: u64,
    root: PathBuf,
    /// 共享租约之间互不阻塞（多个 Agent 对话可同时在同一项目中运行）；独占租约与任何重叠租约互斥
    shared: bool,
}

#[derive(Debug)]
pub struct WorkspaceManager {
    root_path: RwLock<Option<PathBuf>>,
    active: Arc<Mutex<Vec<LeaseEntry>>>,
    next_lease: AtomicU64,
}

pub struct WorkspaceLease {
    id: u64,
    active: Arc<Mutex<Vec<LeaseEntry>>>,
}

impl Drop for WorkspaceLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.retain(|entry| entry.id != self.id);
        }
    }
}

impl WorkspaceManager {
    pub fn new(initial_path: Option<PathBuf>) -> Self {
        let root = initial_path.and_then(|p| {
            if p.exists() && p.is_dir() {
                p.canonicalize().ok()
            } else {
                None
            }
        });
        Self {
            root_path: RwLock::new(root),
            active: Arc::new(Mutex::new(Vec::new())),
            next_lease: AtomicU64::new(1),
        }
    }

    /// 检查点恢复与界面写入独占工作区，避免快照和文件变化交错。
    pub fn acquire_workspace(&self, workspace: &Path) -> Result<WorkspaceLease, String> {
        self.acquire(workspace, false)
    }

    /// Agent 运行取共享租约：多个对话可以同时在同一项目中工作，但恢复与界面写入须等它们全部结束。
    pub fn acquire_shared_workspace(&self, workspace: &Path) -> Result<WorkspaceLease, String> {
        self.acquire(workspace, true)
    }

    fn acquire(&self, workspace: &Path, shared: bool) -> Result<WorkspaceLease, String> {
        let root = workspace.canonicalize().map_err(|e| e.to_string())?;
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        let conflict = active.iter().any(|entry| {
            let overlaps = root.starts_with(&entry.root) || entry.root.starts_with(&root);
            overlaps && !(shared && entry.shared)
        });
        if conflict {
            return Err("工作区正在执行任务，请停止任务后再恢复或修改文件。".to_string());
        }
        let id = self.next_lease.fetch_add(1, Ordering::Relaxed);
        active.push(LeaseEntry { id, root, shared });
        Ok(WorkspaceLease { id, active: Arc::clone(&self.active) })
    }

    pub fn get_workspace_root(&self) -> Option<PathBuf> {
        self.root_path.read().unwrap().clone()
    }

    pub fn set_workspace_root(&self, path: PathBuf) -> Result<(), String> {
        if !path.exists() || !path.is_dir() {
            return Err("Workspace path does not exist or is not a directory".to_string());
        }
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        *self.root_path.write().unwrap() = Some(canonical);
        Ok(())
    }

    pub fn clear_workspace_root(&self) {
        *self.root_path.write().unwrap() = None;
    }
}

pub fn get_fallback_cwd() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(profile);
            if p.exists() && p.is_dir() {
                return p;
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home);
            if p.exists() && p.is_dir() {
                return p;
            }
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn get_agent_tools_schema() -> Vec<serde_json::Value> {
    let mut tools = vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "读取文件内容。已选择项目时限于工作区；未选择项目时可读取用户消息中给出的绝对路径，需权限批准，完全访问模式直接放行。查看 README.md、配置或源代码时使用，禁止改用 run_command 读取。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "工作区内的相对或绝对文件路径；未选择项目时必须为用户提供的绝对路径" }
                    },
                    "required": ["path"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "新建文件或整体重写工作区中的文件（需彩叶批准），生成检查点和代码审阅记录。修改已有文件的局部内容请使用 edit_file；整体重写前必须先用 read_file 读取。必须先选择项目，不得改用 run_command 写入。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative or absolute file path within workspace" },
                        "content": { "type": "string", "description": "Content to write into the file" }
                    },
                    "required": ["path", "content"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "按片段替换已有文件（需彩叶批准）。修改已有文件优先使用此工具；write_file 只用于新建文件或整体重写。必须先选择项目并用 read_file 读取目标文件，写前校验版本，保留原有换行符。old_string 默认必须唯一匹配；找不到时重新读取，多处匹配时补充上下文或使用 replace_all。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "工作区内的相对或绝对文件路径" },
                        "old_string": { "type": "string", "minLength": 1, "description": "待替换的原文片段，包含足够上下文以唯一定位" },
                        "new_string": { "type": "string", "description": "替换后的片段，可为空以删除原文" },
                        "replace_all": { "type": "boolean", "default": false, "description": "是否替换所有匹配，默认 false" }
                    },
                    "required": ["path", "old_string", "new_string"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "list_directory",
                "description": "列出目录中的文件与子目录。已选择项目时限于工作区，path 为空或 '.' 表示工作区根目录；未选择项目时必须使用用户消息给出的绝对路径，需权限批准，完全访问模式直接放行。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "目录路径（空值或 . 表示工作区根目录）；未选择项目时必须为用户提供的绝对路径" }
                    }
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "glob",
                "description": "按文件名模式查找工作区文件，结果按修改时间倒序。支持 **、*、?、[...]、{a,b}，不含 / 的模式匹配任意层级（如 \"*.tsx\"、\"src/**/*.rs\"）。按名称找文件时使用，禁止改用 run_command 执行 dir、ls、find、Get-ChildItem。需先选择项目。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "glob 模式" },
                        "path": { "type": "string", "description": "搜索起点目录（工作区内），默认工作区根目录" }
                    },
                    "required": ["pattern"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "grep",
                "description": "按正则表达式检索工作区文件内容（Rust regex 语法），自动跳过二进制、依赖与构建目录。查找符号定义、引用、报错文案时使用，禁止改用 run_command 执行 grep、rg、findstr、Select-String。默认只返回匹配文件列表，需要看匹配行时设 output_mode 为 content。需先选择项目。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "正则表达式" },
                        "path": { "type": "string", "description": "搜索起点目录或文件（工作区内），默认工作区根目录" },
                        "glob": { "type": "string", "description": "只检索文件名匹配该 glob 的文件，如 \"*.ts\"" },
                        "output_mode": {
                            "type": "string",
                            "enum": ["files_with_matches", "content", "count"],
                            "description": "files_with_matches 列出文件（默认）；content 列出匹配行（文件:行号:内容）；count 统计每个文件的匹配行数"
                        },
                        "case_insensitive": { "type": "boolean", "default": false, "description": "是否忽略大小写" },
                        "context": { "type": "integer", "minimum": 0, "maximum": 10, "description": "content 模式下每处匹配前后附带的行数" },
                        "head_limit": { "type": "integer", "minimum": 1, "description": "最多返回的输出行数，默认 250" }
                    },
                    "required": ["pattern"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "在终端执行命令（Windows 使用 PowerShell，Unix 使用 sh，需彩叶批准）。只用于构建、测试、git 和查询系统信息；禁止用 Get-Content、Set-Content、cat、echo > 等命令读写文件，读取使用 read_file，局部修改使用 edit_file，新建或整体重写使用 write_file。未选择项目时在默认用户环境中执行。（宿主探查准则：遇到存疑、溢出或冲突数据必须多步交叉求证；Windows 下查询显存请使用 nvidia-smi 或注册表 HardwareInformation.qwMemorySize，避免使用有 4GB 截断限制的 Win32_VideoController.AdapterRAM）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Command string to execute" },
                        "timeout_secs": { "type": "integer", "description": "Timeout in seconds (default 30)" }
                    },
                    "required": ["command"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "git_status",
                "description": "Get git status of the current workspace repository. 获取当前工作区 Git 仓库的状态（已修改、未暂存、未跟踪文件等）。",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "git_diff",
                "description": "Get uncommitted git diff of the workspace. 获取工作区未提交的代码差异。",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "Fetch content from a web URL. 抓取网络链接内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "HTTP or HTTPS URL" }
                    },
                    "required": ["url"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web for up-to-date information and return titles, URLs and snippets. 联网搜索，返回网页标题、链接与摘要；需要正文时再用 web_fetch 抓取。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "精炼的检索词（1~6 个词）" }
                    },
                    "required": ["query"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "task",
                "description": "Delegate a self-contained investigation to a sub-agent with its own isolated context (broad code search, reading many files, multi-step system diagnosis, web research). Only the sub-agent's final report comes back, so its intermediate reads never bloat your context. The sub-agent cannot modify files and cannot see this conversation: the prompt must state the goal, scope and what the report should contain. For a single read or search, call that tool directly instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "description": { "type": "string", "description": "Short label (3-10 words) shown to the user" },
                        "prompt": { "type": "string", "description": "Complete, self-contained instructions for the sub-agent" }
                    },
                    "required": ["description", "prompt"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "todo_write",
                "description": "Update the agent's task checklist for this session. Pass the ENTIRE updated list every time (replace wholesale).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "description": "The complete current list of tasks",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "content": { "type": "string", "description": "Description of the task step" },
                                    "status": {
                                        "type": "string",
                                        "enum": ["pending", "in_progress", "completed"],
                                        "description": "Task status: pending, in_progress, or completed"
                                    }
                                },
                                "required": ["content", "status"]
                            }
                        }
                    },
                    "required": ["todos"]
                }
            }
        }),
    ];
    tools.extend(crate::gateway::prompt::read_guideline_schema());
    tools
}

pub async fn execute_tool_with_context(
    name: &str,
    args: &serde_json::Value,
    workspace_root: Option<&Path>,
    http_client: &reqwest::Client,
    fs_tracker: Option<&FsObservationTracker>,
    auth: ToolAuthorization,
) -> Result<String, String> {
    // 执行边界自带授权判定：写类工具须有人类发起凭据或模型侧的获批标记，
    // 调用方漏判也不会落地破坏性动作
    if matches!(name, "write_file" | "edit_file") && workspace_root.is_none() {
        return Err(PROJECT_REQUIRED_FOR_WRITE.to_string());
    }
    authorize_tool(name, auth)?;
    if is_unbound_file_read(name, workspace_root) {
        let approved = matches!(auth, ToolAuthorization::HumanInitiated
            | ToolAuthorization::ModelInitiated { approved: true }
            | ToolAuthorization::Agent { mode: AgentExecutionMode::FullAuto, .. }
            | ToolAuthorization::Agent { approved: true, .. });
        if !approved {
            return Err("本次无项目文件读取未获得用户授权，已拒绝执行。".to_string());
        }
    }

    match name {
        "read_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            if let Some(root) = workspace_root {
                fs::read_file_guarded(path, root, fs_tracker)
            } else {
                let target = fs::resolve_unbound_read_path(path)?;
                let root = target.parent().ok_or("无效文件路径")?;
                fs::read_file_guarded(&target.to_string_lossy(), root, fs_tracker)
            }
        }
        "write_file" => {
            let root = workspace_root.ok_or(PROJECT_REQUIRED_FOR_WRITE)?;
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing 'content' argument")?;
            fs::write_file_guarded(path, content, root, fs_tracker)
        }
        "edit_file" => {
            let root = workspace_root.ok_or(PROJECT_REQUIRED_FOR_WRITE)?;
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("缺少 path 参数")?;
            let old = args.get("old_string").and_then(|v| v.as_str()).ok_or("缺少 old_string 参数")?;
            let new = args.get("new_string").and_then(|v| v.as_str()).ok_or("缺少 new_string 参数")?;
            let replace_all = match args.get("replace_all") {
                None => false,
                Some(value) => value.as_bool().ok_or("replace_all 必须为布尔值")?,
            };
            let tracker = fs_tracker.ok_or("FS_NOT_OBSERVED: 请先用 read_file 读取目标文件后重试。")?;
            fs::edit_file_guarded(path, old, new, replace_all, root, tracker)
        }
        "list_directory" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let entries = if let Some(root) = workspace_root {
                fs::list_directory(path, root)?
            } else {
                let target = fs::resolve_unbound_read_path(path)?;
                fs::list_directory(".", &target)?
            };
            serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
        }
        "glob" => {
            let root = workspace_root.ok_or(search::PROJECT_REQUIRED_FOR_SEARCH)?;
            let pattern = args.get("pattern").and_then(|v| v.as_str()).ok_or("缺少 pattern 参数")?;
            let path = args.get("path").and_then(|v| v.as_str());
            search::glob_files(pattern, path, root)
        }
        "grep" => {
            let root = workspace_root.ok_or(search::PROJECT_REQUIRED_FOR_SEARCH)?;
            let pattern = args.get("pattern").and_then(|v| v.as_str()).ok_or("缺少 pattern 参数")?;
            let usize_arg = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
            let options = search::GrepOptions {
                pattern,
                path: args.get("path").and_then(|v| v.as_str()),
                glob: args.get("glob").and_then(|v| v.as_str()).filter(|g| !g.trim().is_empty()),
                output_mode: search::GrepOutputMode::parse(args.get("output_mode").and_then(|v| v.as_str()))?,
                case_insensitive: args.get("case_insensitive").and_then(|v| v.as_bool()).unwrap_or(false),
                context: usize_arg("context").unwrap_or(0),
                head_limit: usize_arg("head_limit"),
            };
            search::grep_files(&options, root)
        }
        "run_command" => {
            let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing 'command' argument")?;
            let timeout_secs = args.get("timeout_secs").and_then(|v| v.as_u64());
            let fallback_buf;
            let root = match workspace_root {
                Some(ws) => ws,
                None => {
                    fallback_buf = get_fallback_cwd();
                    &fallback_buf
                }
            };
            shell::run_command(command, root, timeout_secs).await
        }
        "git_status" => {
            let root = workspace_root.ok_or("当前未打开项目工作区，无法获取 Git 状态。若彩叶需要查看仓库差异，请提醒彩叶在界面上方选择或打开工作区文件夹。")?;
            git::git_status(root).await
        }
        "git_diff" => {
            let root = workspace_root.ok_or("当前未打开项目工作区，无法获取 Git diff。若彩叶需要查看未提交修改，请提醒彩叶在界面上方选择或打开工作区文件夹。")?;
            git::git_diff(root).await
        }
        "web_fetch" => {
            let url = args.get("url").and_then(|v| v.as_str()).ok_or("Missing 'url' argument")?;
            web::web_fetch(url, http_client).await
        }
        "web_search" => {
            let query = args.get("query").and_then(|v| v.as_str()).ok_or("缺少 query 参数")?;
            web::web_search(query, http_client).await
        }
        "todo_write" => {
            let todos = args
                .get("todos")
                .and_then(|v| v.as_array())
                .ok_or("Missing or invalid 'todos' argument (must be an array)")?;
            let mut pending = 0;
            let mut in_progress = 0;
            let mut completed = 0;
            for (idx, item) in todos.iter().enumerate() {
                let content = item
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("Item #{}: missing 'content'", idx))?;
                if content.trim().is_empty() {
                    return Err(format!("Item #{}: 'content' cannot be empty", idx));
                }
                let status = item
                    .get("status")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("Item #{}: missing 'status'", idx))?;
                match status {
                    "pending" => pending += 1,
                    "in_progress" => in_progress += 1,
                    "completed" => completed += 1,
                    unknown => {
                        return Err(format!(
                            "Item #{}: invalid status '{}', must be pending, in_progress, or completed",
                            idx, unknown
                        ))
                    }
                }
            }
            Ok(format!(
                "Updated todo list: {} pending, {} in progress, {} completed.",
                pending, in_progress, completed
            ))
        }
        crate::gateway::prompt::READ_GUIDELINE_TOOL => {
            let guideline = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            crate::gateway::prompt::read_guideline(guideline)
        }
        unknown => Err(format!("Unknown tool: '{}'", unknown)),
    }
}

pub async fn execute_tool(
    name: &str,
    args: &serde_json::Value,
    workspace_root: &Path,
    http_client: &reqwest::Client,
    auth: ToolAuthorization,
) -> Result<String, String> {
    execute_tool_with_context(name, args, Some(workspace_root), http_client, None, auth).await
}

