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
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentExecutionMode {
    #[serde(rename = "readonly")]
    Readonly,
    #[default]
    #[serde(rename = "confirm")]
    Confirm,
    #[serde(rename = "full_auto")]
    FullAuto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequestConfig {
    pub enabled: bool,
    #[serde(rename = "maxTurns", skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(rename = "workspace", skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(rename = "auto", skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    /// 旧 auto 仅控制工具选择，不构成跳过审批的授权。
    #[serde(rename = "executionMode", default)]
    pub execution_mode: AgentExecutionMode,
    /// 当前模型能接收图片；为真时才下发 look 截图工具，否则截图会让上游直接报错
    #[serde(default)]
    pub vision: bool,
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

impl ProviderId {
    /// 与序列化名一致的小写标识，同时是系统加密存储里 Key 的索引
    pub fn slug(self) -> &'static str {
        match self {
            Self::Stepfun => "stepfun",
            Self::Deepseek => "deepseek",
            Self::Glm => "glm",
            Self::Openai => "openai",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }
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
    /// 自定义 OpenAI 兼容端点（与 Web 端 baseUrl 契约一致）：仅 OpenAI 兼容厂商有效，存在时模型名交由上游校验
    #[serde(rename = "baseUrl", skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// 同一厂商可配置多条模型、各用各的 Key：指明取用哪个密钥槽（缺省为厂商名本身的槽）
    #[serde(rename = "keySlot", skip_serializing_if = "Option::is_none")]
    pub key_slot: Option<String>,
    #[serde(rename = "webSearch", skip_serializing_if = "Option::is_none")]
    pub web_search: Option<bool>,
    #[serde(rename = "smartSearch", skip_serializing_if = "Option::is_none")]
    pub smart_search: Option<bool>,
    #[serde(rename = "currentTime", skip_serializing_if = "Option::is_none")]
    pub current_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentRequestConfig>,
    /// 用户在对话框选择的思考档位；缺省或模型不支持时沿用各厂商的默认规则
    #[serde(rename = "reasoningEffort", skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningLevel>,
    /// 「自定义模型」的线路协议与采样参数；只与 baseUrl 同时出现（与 Web 端 customModel 契约一致）
    #[serde(rename = "customModel", skip_serializing_if = "Option::is_none")]
    pub custom_model: Option<CustomModelOptions>,
}

/// 自定义模型的线路协议
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormat {
    ChatCompletions,
    Responses,
    AnthropicMessages,
}

/// 模型系列：决定思考开关的参数写法与 OpenAI 兼容厂商规则
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelFamily {
    Deepseek,
    Qwen,
    Glm,
    Kimi,
    Doubao,
    Minimax,
    Gpt,
    Claude,
}

/// 显式的思考开关；缺省跟随模型默认配置
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingMode {
    On,
    Off,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CustomModelOptions {
    #[serde(rename = "apiFormat")]
    pub api_format: ApiFormat,
    /// 按 baseUrl 原样请求，不补全协议路径
    #[serde(rename = "fullUrl", default)]
    pub full_url: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<ModelFamily>,
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<ThinkingMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(rename = "topP", skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(rename = "topK", skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
}

/// 界面统一的思考档位（轻度 / 中 / 高 / 极高 / Ultra），按思考深度递增；各厂商原生取值见 `gateway::providers::reasoning`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningLevel {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    #[serde(rename = "promptTokens", skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u32>,
    #[serde(rename = "completionTokens", skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u32>,
    #[serde(rename = "totalTokens", skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u32>,
    /// 提示词中命中前缀缓存的部分，已计入 prompt_tokens
    #[serde(rename = "cacheReadTokens", skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u32>,
    /// 提示词中本次写入缓存的部分，已计入 prompt_tokens；只有 Anthropic 单独上报
    #[serde(rename = "cacheWriteTokens", skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u32>,
}

impl TokenUsage {
    /// 同一请求的多个流事件各自只带部分字段（如 Anthropic 的 message_start 带输入、message_delta 带输出），
    /// 按字段覆盖合并，后到的值优先
    pub fn merge_from(&mut self, other: &TokenUsage) {
        self.prompt_tokens = other.prompt_tokens.or(self.prompt_tokens);
        self.completion_tokens = other.completion_tokens.or(self.completion_tokens);
        self.total_tokens = other.total_tokens.or(self.total_tokens);
        self.cache_read_tokens = other.cache_read_tokens.or(self.cache_read_tokens);
        self.cache_write_tokens = other.cache_write_tokens.or(self.cache_write_tokens);
    }
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
        /// 非正常结束的原因（如 loop_detected），正常完成时省略
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "error")]
    Error { code: String },
    /// 上游模型接口返回的错误：编码为带 message 的 error 事件，界面据此说明失败原因而不是笼统地“连不上”
    #[serde(rename = "upstream_error")]
    UpstreamError { message: String },
    /// 不中断运行的提示（如所选思考档位被模型拒绝、已按默认档位继续），code 由前端本地化
    #[serde(rename = "notice")]
    Notice { code: String },
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
