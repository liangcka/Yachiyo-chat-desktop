use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// MCP 传输层配置类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
}

/// 单个 MCP Server 配置实体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub transport: McpTransportConfig,
}

fn default_true() -> bool {
    true
}

/// Claude Desktop 兼容格式的外部服务项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeDesktopServerEntry {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

/// Claude Desktop 兼容配置文件格式
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClaudeDesktopConfig {
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: HashMap<String, ClaudeDesktopServerEntry>,
}

/// JSON-RPC 2.0 请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 通知（无 id）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// MCP 声明的工具定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "inputSchema", default = "default_schema")]
    pub input_schema: serde_json::Value,
}

fn default_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {}
    })
}

/// MCP 工具调用内容项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpContentItem {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    Resource {
        resource: serde_json::Value,
    },
}

/// MCP tools/call 返回的载荷
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpToolCallResult {
    #[serde(default)]
    pub content: Vec<McpContentItem>,
    #[serde(default, rename = "isError")]
    pub is_error: bool,
}

impl McpToolCallResult {
    /// 将 content 格式化为给大模型消费的纯文本
    pub fn to_plain_text(&self) -> String {
        if self.content.is_empty() {
            return if self.is_error {
                "MCP 工具执行失败（无输出）".to_string()
            } else {
                "执行完成（无输出）".to_string()
            };
        }

        let mut out = String::new();
        for item in &self.content {
            match item {
                McpContentItem::Text { text } => {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(text);
                }
                McpContentItem::Image { mime_type, .. } => {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(&format!("[二进制图片数据: {}]", mime_type));
                }
                McpContentItem::Resource { resource } => {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(&format!("[资源数据: {}]", resource));
                }
            }
        }
        out
    }
}

/// 前端展示的服务器状态汇总
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub config: McpServerConfig,
    pub is_online: bool,
    pub tool_count: usize,
    #[serde(default)]
    pub tools: Vec<McpTool>,
    #[serde(default)]
    pub last_error: Option<String>,
}
