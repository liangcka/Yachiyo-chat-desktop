pub mod fs;
pub mod git;
pub mod shell;
pub mod web;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// 工具风险分级：读类自动放行，写类需用户批准
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRisk {
    Read,
    Write,
}

pub fn tool_risk(name: &str) -> Option<ToolRisk> {
    match name {
        "read_file" | "list_directory" | "git_status" | "git_diff" | "web_fetch" => Some(ToolRisk::Read),
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
fn floor_char_boundary(s: &str, mut index: usize) -> usize {
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
    root_path: RwLock<PathBuf>,
}

impl WorkspaceManager {
    pub fn new(initial_path: Option<PathBuf>) -> Self {
        let root = initial_path.unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        });
        Self {
            root_path: RwLock::new(root),
        }
    }

    pub fn get_workspace_root(&self) -> PathBuf {
        self.root_path.read().unwrap().clone()
    }

    pub fn set_workspace_root(&self, path: PathBuf) -> Result<(), String> {
        if !path.exists() || !path.is_dir() {
            return Err("Workspace path does not exist or is not a directory".to_string());
        }
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        *self.root_path.write().unwrap() = canonical;
        Ok(())
    }
}

pub fn get_agent_tools_schema() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read content of a file within the workspace boundary",
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
                "description": "Write or overwrite content of a file within the workspace boundary",
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
                "description": "List files and subdirectories within a workspace directory",
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
                "description": "Execute a terminal shell command (PowerShell / CMD) in the workspace directory",
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
                "description": "Get git status of the current workspace repository",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "git_diff",
                "description": "Get uncommitted git diff of the workspace",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "Fetch content from a web URL",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "HTTP or HTTPS URL" }
                    },
                    "required": ["url"]
                }
            }
        }),
    ]
}

pub async fn execute_tool(
    name: &str,
    args: &serde_json::Value,
    workspace_root: &Path,
    http_client: &reqwest::Client,
) -> Result<String, String> {
    match name {
        "read_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            fs::read_file(path, workspace_root)
        }
        "write_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            let content = args.get("content").and_then(|v| v.as_str()).ok_or("Missing 'content' argument")?;
            fs::write_file(path, content, workspace_root)
        }
        "list_directory" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let entries = fs::list_directory(path, workspace_root)?;
            serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
        }
        "run_command" => {
            let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing 'command' argument")?;
            let timeout_secs = args.get("timeout_secs").and_then(|v| v.as_u64());
            shell::run_command(command, workspace_root, timeout_secs).await
        }
        "git_status" => {
            git::git_status(workspace_root).await
        }
        "git_diff" => {
            git::git_diff(workspace_root).await
        }
        "web_fetch" => {
            let url = args.get("url").and_then(|v| v.as_str()).ok_or("Missing 'url' argument")?;
            web::web_fetch(url, http_client).await
        }
        unknown => Err(format!("Unknown tool: '{}'", unknown)),
    }
}
