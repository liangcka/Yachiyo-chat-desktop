use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChatLocale {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "ja-JP")]
    JaJp,
}

impl Default for ChatLocale {
    fn default() -> Self {
        Self::ZhCn
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientHistoryMessage {
    /// "user" | "assistant" | "tool"（tool 角色仅在 Agent 历史重放时出现）
    pub role: String,
    pub text: String,
    #[serde(rename = "imageDataUrl", skip_serializing_if = "Option::is_none")]
    pub image_data_url: Option<String>,
    #[serde(rename = "toolCalls", skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolInvocation>>,
    #[serde(rename = "toolCallId", skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(rename = "toolName", skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

/// Agent 循环解析出的一次工具调用（provider 原生 function calling 产物）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInvocation {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// 请求携带的 Agent 模式配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequestConfig {
    pub enabled: bool,
    #[serde(rename = "maxTurns", skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(rename = "workspace", skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(rename = "auto", skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Stepfun,
    Deepseek,
    Glm,
    Openai,
    Claude,
    Gemini,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestMode {
    Chat,
    Summary,
    Title,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientChatRequest {
    pub locale: ChatLocale,
    pub messages: Vec<ClientHistoryMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<RequestMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<ProviderId>,
    #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(rename = "webSearch", skip_serializing_if = "Option::is_none")]
    pub web_search: Option<bool>,
    #[serde(rename = "smartSearch", skip_serializing_if = "Option::is_none")]
    pub smart_search: Option<bool>,
    #[serde(rename = "currentTime", skip_serializing_if = "Option::is_none")]
    pub current_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentRequestConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    #[serde(rename = "promptTokens", skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u32>,
    #[serde(rename = "completionTokens", skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u32>,
    #[serde(rename = "totalTokens", skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSource {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientStreamEvent {
    #[serde(rename = "thought")]
    Thought { text: String },
    #[serde(rename = "delta")]
    Delta { text: String },
    #[serde(rename = "sources")]
    Sources { sources: Vec<ChatSource> },
    #[serde(rename = "done")]
    Done {
        truncated: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TokenUsage>,
    },
    #[serde(rename = "error")]
    Error { code: String },
    #[serde(rename = "tool_call")]
    ToolCall {
        id: String,
        name: String,
        arguments: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        id: String,
        name: String,
        output: String,
        #[serde(rename = "isError")]
        is_error: bool,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
    },
    #[serde(rename = "permission_request")]
    PermissionRequest {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        arguments: serde_json::Value,
    },
    #[serde(rename = "permission_resolved")]
    PermissionResolved {
        #[serde(rename = "requestId")]
        request_id: String,
        approved: bool,
    },
    #[serde(rename = "turn")]
    Turn {
        index: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TokenUsage>,
    },
}

/// provider 流式工具调用增量（跨 chunk 聚合前的原始形态）
#[derive(Debug, Clone)]
pub enum ToolCallStreamDelta {
    Openai {
        index: usize,
        id: Option<String>,
        name: Option<String>,
        arguments_fragment: Option<String>,
    },
    AnthropicStart {
        index: usize,
        block_id: String,
        name: String,
    },
    AnthropicArgs {
        index: usize,
        partial_json: String,
    },
    AnthropicStop {
        index: usize,
    },
    Gemini {
        call: ToolInvocation,
    },
}

#[derive(Debug, Clone, Default)]
pub struct ExtractedDelta {
    pub content: Option<String>,
    pub thought: Option<String>,
    pub usage: Option<TokenUsage>,
    pub sources: Option<Vec<ChatSource>>,
    pub tool_calls: Vec<ToolCallStreamDelta>,
}
