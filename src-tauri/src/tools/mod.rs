pub mod fs;
pub mod git;
pub mod shell;
pub mod web;

pub use fs::FsObservationTracker;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::{Arc, Mutex, RwLock};
use crate::types::AgentExecutionMode;

/// 工具风险分级：读类自动放行，写类需用户批准
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRisk {
    Read,
    Write,
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
        "read_file" | "list_directory" | "git_status" | "git_diff" | "web_fetch" | "todo_write" => {
            Some(ToolRisk::Read)
        }
        "write_file" | "run_command" => Some(ToolRisk::Write),
        _ => None,
    }
}

/// 回填模型前的工具输出上限（字节）
fn tool_output_limit(name: &str) -> usize {
    match name {
        "read_file" => 64 * 1024,
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
    let filename = format!("spill-{}-{}.txt", timestamp, name);
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
            "{}\n\n[... 工具输出过长，已省略中间 {} 字节 ...]\n\n{}\n\n[提示：原始完整输出共 {} 字节，已保存至工作区: .yachiyo/spill/{}。若需查阅中间内容，请使用 read_file 查看该文件，或使用 run_command 针对该文件执行 grep。]",
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
pub struct WorkspaceManager {
    root_path: RwLock<Option<PathBuf>>,
    active: Arc<Mutex<HashSet<PathBuf>>>,
}

pub struct WorkspaceLease {
    root: PathBuf,
    active: Arc<Mutex<HashSet<PathBuf>>>,
}

impl Drop for WorkspaceLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.root);
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
            active: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Agent 运行、恢复与界面写入共用工作区互斥，避免快照和文件变化交错。
    pub fn acquire_workspace(&self, workspace: &Path) -> Result<WorkspaceLease, String> {
        let root = workspace.canonicalize().map_err(|e| e.to_string())?;
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        if active.iter().any(|running| root.starts_with(running) || running.starts_with(&root)) {
            return Err("工作区正在执行任务，请停止任务后再恢复或修改文件。".to_string());
        }
        active.insert(root.clone());
        Ok(WorkspaceLease { root, active: Arc::clone(&self.active) })
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
    vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read content of a file within the workspace boundary. 读取工作区中的文件内容。在了解项目概况（如读取 README.md、package.json、Cargo.toml、配置文件）、查看源代码或分析代码逻辑时使用。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative or absolute file path within workspace" }
                    },
                    "required": ["path"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write or overwrite content of a file within the workspace boundary (requires user approval). 写入或覆盖工作区中的文件内容（需彩叶批准）。创建新文件或修改现有代码时使用。",
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
                "name": "list_directory",
                "description": "List files and subdirectories within a workspace directory. 列出工作区目录中的文件与子目录。查看项目结构、探索工作区文件布局、寻找特定文件或初次感知项目时使用。path 为空或 '.' 表示工作区根目录。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory path to list (empty or . for workspace root)" }
                    }
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Execute a terminal shell command (PowerShell on Windows, sh on Unix) (requires user approval). 在终端执行命令（需彩叶批准）。用于运行构建、测试、包安装、系统环境检测、磁盘查询（如通过 PowerShell 获取盘符与文件信息）或执行诊断脚本。若未打开特定工作区，将在默认用户环境中执行。（宿主探查准则：遇到存疑、溢出或冲突数据必须多步交叉求证；Windows 下查询显存请使用 nvidia-smi 或注册表 HardwareInformation.qwMemorySize，避免使用有 4GB 截断限制的 Win32_VideoController.AdapterRAM）。",
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
    ]
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
    authorize_tool(name, auth)?;

    match name {
        "read_file" => {
            let root = workspace_root.ok_or("当前未打开项目工作区，无法读取文件。若彩叶需要查看本地代码，请提醒彩叶在界面上方选择或打开工作区文件夹。")?;
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            fs::read_file_guarded(path, root, fs_tracker)
        }
        "write_file" => {
            let root = workspace_root.ok_or("当前未打开项目工作区，无法写入文件。若彩叶需要修改或创建代码，请提醒彩叶在界面上方选择或打开工作区文件夹。")?;
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing 'content' argument")?;
            fs::write_file_guarded(path, content, root, fs_tracker)
        }
        "list_directory" => {
            let root = workspace_root.ok_or("当前未打开项目工作区，无法查看工程目录结构。若彩叶需要探索项目代码，请提醒彩叶在界面上方选择或打开工作区文件夹。")?;
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let entries = fs::list_directory(path, root)?;
            serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
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

