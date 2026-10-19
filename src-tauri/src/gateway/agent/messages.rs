use crate::types::{ClientHistoryMessage, ToolInvocation};

/// Agent 循环内的统一消息表示（与具体 provider 格式解耦）
#[derive(Debug, Clone)]
pub enum AgentMessage {
    User {
        text: String,
        image_data_url: Option<String>,
    },
    Assistant {
        text: String,
        /// 本轮思维链原文；DeepSeek 思考模式要求工具轮次回传，客户端历史不携带时为空
        reasoning: String,
        tool_calls: Vec<ToolInvocation>,
        /// 本轮厂商原生输出（Anthropic 内容块、Responses 输出项、Gemini parts），
        /// 携带思考签名等不可重建的字段，同一运行内原样回传；客户端历史不携带时为空
        native: Vec<serde_json::Value>,
    },
    ToolResult {
        tool_call_id: String,
        name: String,
        content: String,
    },
}

/// 客户端历史（含 tool 角色消息）转换为循环内部表示
pub fn history_to_agent_messages(history: &[ClientHistoryMessage]) -> Vec<AgentMessage> {
    history
        .iter()
        .map(|msg| match msg.role.as_str() {
            "tool" => AgentMessage::ToolResult {
                tool_call_id: msg.tool_call_id.clone().unwrap_or_default(),
                name: msg.tool_name.clone().unwrap_or_default(),
                content: msg.text.clone(),
            },
            "assistant" => AgentMessage::Assistant {
                text: msg.text.clone(),
                reasoning: String::new(),
                tool_calls: msg.tool_calls.clone().unwrap_or_default(),
                native: Vec::new(),
            },
            _ => AgentMessage::User {
                text: msg.text.clone(),
                image_data_url: msg.image_data_url.clone(),
            },
        })
        .collect()
}
