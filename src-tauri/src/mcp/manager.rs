use crate::computer;
use crate::mcp::client::{execute_server_tool, fetch_server_tools};
use crate::mcp::types::{
    ClaudeDesktopConfig, ClaudeDesktopServerEntry, McpServerConfig, McpServerStatus, McpTool,
    McpTransportConfig,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tracing::{error, warn};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct McpStorageData {
    pub servers: Vec<McpServerConfig>,
}

pub struct McpManager {
    storage_path: PathBuf,
    http_client: reqwest::Client,
    servers: RwLock<Vec<McpServerConfig>>,
    tools_cache: RwLock<HashMap<String, Vec<McpTool>>>,
}

impl McpManager {
    pub fn new(custom_path: Option<PathBuf>, http_client: reqwest::Client) -> Self {
        let is_custom = custom_path.is_some();
        let storage_path = custom_path.unwrap_or_else(|| {
            let mut p = default_storage_dir();
            fs::create_dir_all(&p).ok();
            p.push("mcp_servers.json");
            p
        });

        let initial_servers = if !storage_path.exists() {
            if is_custom {
                Vec::new()
            } else {
                vec![Self::default_windows_mcp_config()]
            }
        } else {
            Self::load_servers_from_disk(&storage_path)
        };

        Self {
            storage_path,
            http_client,
            servers: RwLock::new(initial_servers),
            tools_cache: RwLock::new(HashMap::new()),
        }
    }

    /// 内置桌面控制的服务条目：执行由 `computer` 模块在进程内完成，transport 仅为保持配置格式兼容
    pub fn default_windows_mcp_config() -> McpServerConfig {
        McpServerConfig {
            id: computer::BUILTIN_SERVER_ID.to_string(),
            name: "Windows 桌面控制 (Windows MCP)".to_string(),
            description: Some("内置桌面控制：启动与切换应用、模拟鼠标键盘、列出窗口与截图，无需额外安装".to_string()),
            enabled: true,
            transport: McpTransportConfig::Stdio {
                command: "npx".to_string(),
                args: vec!["-y".to_string(), "@modelcontextprotocol/server-windows".to_string()],
                env: HashMap::new(),
            },
        }
    }

    fn load_servers_from_disk(path: &PathBuf) -> Vec<McpServerConfig> {
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<McpStorageData>(&content) {
                Ok(data) => data.servers,
                Err(e) => {
                    warn!("读取 MCP 配置文件失败，尝试以兼容格式解析: {}", e);
                    // 尝试以 Claude Desktop 格式兼容加载
                    if let Ok(claude_cfg) = serde_json::from_str::<ClaudeDesktopConfig>(&content) {
                        convert_claude_config(claude_cfg)
                    } else {
                        Vec::new()
                    }
                }
            },
            Err(e) => {
                error!("无法读取 MCP 配置文件 {}: {}", path.display(), e);
                Vec::new()
            }
        }
    }

    fn save_servers_to_disk(&self) -> Result<(), String> {
        let servers = self.servers.read().map_err(|e| e.to_string())?.clone();
        let data = McpStorageData { servers };
        let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;

        if let Some(parent) = self.storage_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&self.storage_path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_servers(&self) -> Vec<McpServerConfig> {
        self.servers.read().unwrap().clone()
    }

    pub fn get_server(&self, id: &str) -> Option<McpServerConfig> {
        self.servers
            .read()
            .unwrap()
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    pub fn save_server(&self, config: McpServerConfig) -> Result<(), String> {
        if config.id.trim().is_empty() {
            return Err("服务 ID 不能为空".to_string());
        }
        // ID 格式校验（OpenAI 函数命名限制）
        if !config.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err("服务 ID 仅能包含英文字母、数字、下划线与连字符".to_string());
        }

        {
            let mut list = self.servers.write().map_err(|e| e.to_string())?;
            if let Some(pos) = list.iter().position(|s| s.id == config.id) {
                list[pos] = config.clone();
            } else {
                list.push(config.clone());
            }
        }

        self.save_servers_to_disk()?;
        // 清除旧工具缓存以促使下一次更新重新拉取
        if let Ok(mut cache) = self.tools_cache.write() {
            cache.remove(&config.id);
        }
        Ok(())
    }

    pub fn delete_server(&self, id: &str) -> Result<(), String> {
        {
            let mut list = self.servers.write().map_err(|e| e.to_string())?;
            let len_before = list.len();
            list.retain(|s| s.id != id);
            if list.len() == len_before {
                return Err(format!("未找到 ID 为 '{}' 的服务", id));
            }
        }
        self.save_servers_to_disk()?;
        if let Ok(mut cache) = self.tools_cache.write() {
            cache.remove(id);
        }
        Ok(())
    }

    pub fn toggle_server(&self, id: &str, enabled: bool) -> Result<(), String> {
        {
            let mut list = self.servers.write().map_err(|e| e.to_string())?;
            if let Some(item) = list.iter_mut().find(|s| s.id == id) {
                item.enabled = enabled;
            } else {
                return Err(format!("未找到 ID 为 '{}' 的服务", id));
            }
        }
        self.save_servers_to_disk()?;
        Ok(())
    }

    /// 电脑控制插件是否启用；条目被删除过时视为关闭
    pub fn computer_control_enabled(&self) -> bool {
        self.get_server(computer::BUILTIN_SERVER_ID).is_some_and(|server| server.enabled)
    }

    /// 电脑控制插件开关：条目缺失时按内置默认配置补回
    pub fn set_computer_control_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut config = self.get_server(computer::BUILTIN_SERVER_ID).unwrap_or_else(Self::default_windows_mcp_config);
        config.enabled = enabled;
        self.save_server(config)
    }

    /// 测试连接指定服务并返回其工具列表
    pub async fn test_server_connection(
        &self,
        config: &McpServerConfig,
    ) -> Result<Vec<McpTool>, String> {
        if config.id == computer::BUILTIN_SERVER_ID {
            computer::availability()?;
            return Ok(computer::tools());
        }
        let tools = fetch_server_tools(config, &self.http_client).await?;
        if let Ok(mut cache) = self.tools_cache.write() {
            cache.insert(config.id.clone(), tools.clone());
        }
        Ok(tools)
    }

    /// 获取单个服务的状态与已缓存工具
    pub async fn get_server_status(&self, id: &str) -> Result<McpServerStatus, String> {
        let config = self
            .get_server(id)
            .ok_or_else(|| format!("未找到服务 '{}'", id))?;

        if config.id == computer::BUILTIN_SERVER_ID {
            let tools = computer::tools();
            return Ok(McpServerStatus {
                tool_count: tools.len(),
                tools,
                is_online: computer::is_supported(),
                last_error: computer::availability().err(),
                config,
            });
        }

        // 尝试测试连接
        match fetch_server_tools(&config, &self.http_client).await {
            Ok(tools) => {
                if let Ok(mut cache) = self.tools_cache.write() {
                    cache.insert(config.id.clone(), tools.clone());
                }
                Ok(McpServerStatus {
                    tool_count: tools.len(),
                    tools,
                    is_online: true,
                    last_error: None,
                    config,
                })
            }
            Err(err) => {
                let cached_tools = self
                    .tools_cache
                    .read()
                    .ok()
                    .and_then(|c| c.get(id).cloned())
                    .unwrap_or_default();
                Ok(McpServerStatus {
                    tool_count: cached_tools.len(),
                    tools: cached_tools,
                    is_online: false,
                    last_error: Some(err),
                    config,
                })
            }
        }
    }

    /// 导出为 Claude Desktop 兼容的 JSON 配置格式
    pub fn export_claude_config(&self) -> Result<String, String> {
        let servers = self.servers.read().map_err(|e| e.to_string())?;
        let mut map = HashMap::new();

        // 内置电脑控制在进程内执行，其 transport 只为保持格式兼容，导出给其他客户端没有意义
        for s in servers.iter().filter(|s| s.id != computer::BUILTIN_SERVER_ID) {
            let entry = match &s.transport {
                McpTransportConfig::Stdio { command, args, env } => ClaudeDesktopServerEntry {
                    command: Some(command.clone()),
                    args: Some(args.clone()),
                    env: if env.is_empty() { None } else { Some(env.clone()) },
                    url: None,
                    disabled: if s.enabled { None } else { Some(true) },
                },
                McpTransportConfig::Sse { url, .. } => ClaudeDesktopServerEntry {
                    command: None,
                    args: None,
                    env: None,
                    url: Some(url.clone()),
                    disabled: if s.enabled { None } else { Some(true) },
                },
            };
            map.insert(s.id.clone(), entry);
        }

        let cfg = ClaudeDesktopConfig { mcp_servers: map };
        serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())
    }

    /// 导入 Claude Desktop 兼容的 JSON 配置
    pub fn import_claude_config(&self, json_str: &str) -> Result<usize, String> {
        let parsed = serde_json::from_str::<ClaudeDesktopConfig>(json_str)
            .map_err(|e| format!("配置 JSON 格式不合法: {}", e))?;

        let imported_servers = convert_claude_config(parsed);
        let count = imported_servers.len();

        {
            let mut list = self.servers.write().map_err(|e| e.to_string())?;
            for item in imported_servers {
                if let Some(pos) = list.iter().position(|s| s.id == item.id) {
                    list[pos] = item;
                } else {
                    list.push(item);
                }
            }
        }

        self.save_servers_to_disk()?;
        Ok(count)
    }

    /// 获取所有启用服务的工具 Schema，用于 Agent 循环
    pub async fn get_agent_tools_schema(&self) -> Vec<serde_json::Value> {
        let active_servers: Vec<McpServerConfig> = self
            .servers
            .read()
            .map(|list| list.iter().filter(|s| s.enabled).cloned().collect())
            .unwrap_or_default();

        let mut all_schemas = Vec::new();

        for server in active_servers {
            // 内置桌面控制不经外部进程；其余服务优先查缓存，无缓存再拉取
            let tools = if server.id == computer::BUILTIN_SERVER_ID {
                computer::tools()
            } else {
                let cache_opt = self
                    .tools_cache
                    .read()
                    .ok()
                    .and_then(|c| c.get(&server.id).cloned());
                match cache_opt {
                    Some(t) => t,
                    None => match fetch_server_tools(&server, &self.http_client).await {
                        Ok(t) if !t.is_empty() => {
                            if let Ok(mut c) = self.tools_cache.write() {
                                c.insert(server.id.clone(), t.clone());
                            }
                            t
                        }
                        _ => Vec::new(),
                    },
                }
            };

            for tool in tools {
                let func_name = format!("mcp__{}__{}", server.id, tool.name);
                let desc = format!(
                    "[MCP: {}] {}",
                    server.name,
                    tool.description.as_deref().unwrap_or(&tool.name)
                );

                all_schemas.push(serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": func_name,
                        "description": desc,
                        "parameters": tool.input_schema
                    }
                }));
            }
        }

        all_schemas
    }

    /// 判断工具名称是否为 MCP 工具
    pub fn is_mcp_tool(name: &str) -> bool {
        name.starts_with("mcp__")
    }

    /// 执行 MCP 工具调用并返回纯文本结果
    pub async fn execute_tool(
        &self,
        full_name: &str,
        args: &serde_json::Value,
    ) -> Result<String, String> {
        let parts: Vec<&str> = full_name.splitn(3, "__").collect();
        if parts.len() < 3 || parts[0] != "mcp" {
            return Err(format!("非法的 MCP 工具名称: {}", full_name));
        }

        let server_id = parts[1];
        let tool_name = parts[2];

        let server = self
            .get_server(server_id)
            .ok_or_else(|| format!("未找到 MCP 服务 '{}'", server_id))?;

        if !server.enabled {
            return Err(format!("MCP 服务 '{}' 当前已被禁用", server.name));
        }

        if server_id == computer::BUILTIN_SERVER_ID {
            return computer::execute(tool_name, args).await;
        }

        let result = execute_server_tool(&server, tool_name, args, &self.http_client).await?;

        if result.is_error {
            Err(result.to_plain_text())
        } else {
            Ok(result.to_plain_text())
        }
    }
}

fn convert_claude_config(cfg: ClaudeDesktopConfig) -> Vec<McpServerConfig> {
    let mut list = Vec::new();
    for (id, entry) in cfg.mcp_servers {
        let enabled = !entry.disabled.unwrap_or(false);
        if let Some(cmd) = entry.command {
            list.push(McpServerConfig {
                id: id.clone(),
                name: id.clone(),
                description: None,
                enabled,
                transport: McpTransportConfig::Stdio {
                    command: cmd,
                    args: entry.args.unwrap_or_default(),
                    env: entry.env.unwrap_or_default(),
                },
            });
        } else if let Some(url) = entry.url {
            list.push(McpServerConfig {
                id: id.clone(),
                name: id.clone(),
                description: None,
                enabled,
                transport: McpTransportConfig::Sse {
                    url,
                    headers: HashMap::new(),
                },
            });
        }
    }
    list
}

fn default_storage_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let mut p = PathBuf::from(app_data);
            p.push("cn.amtale.yachiyo.desktop");
            return p;
        }
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let mut p = PathBuf::from(home);
        p.push(".yachiyo-desktop");
        return p;
    }

    PathBuf::from(".yachiyo-desktop")
}
