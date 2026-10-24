use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::prompt::build_system_prompt;
use crate::gateway::providers::openai_compat::is_openai_reasoning_model;
use crate::types::{ChatLocale, ClientChatRequest, ExtractedDelta, TokenUsage, ToolCallStreamDelta};
use serde_json::json;

/// OpenAI Agent 走 Responses API：GPT-6 Astra 与 GPT-6.1 Sol 的 Chat Completions 不支持工具调用，
/// GPT-6 Sol/Luna 也只在 reasoning_effort 为 none 时支持，Responses 对全部模型与思考档位开放工具调用
pub const OPENAI_RESPONSES_ENDPOINT: &str = "https://api.openai.com/v1/responses";

/// Agent 模式请求体：function_call / function_call_output 输入项；
/// store 关闭时推理项以加密内容随输出返回，同一运行内原样回传以延续推理
pub fn build_openai_responses_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let function_tools: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            let function = &t["function"];
            json!({
                "type": "function",
                "name": function["name"],
                "description": function["description"],
                "parameters": function["parameters"],
            })
        })
        .collect();

    let mut input: Vec<serde_json::Value> = Vec::new();
    for msg in messages {
        match msg {
            AgentMessage::User { text, image_data_url } => {
                let mut content = vec![json!({ "type": "input_text", "text": text })];
                if let Some(url) = image_data_url {
                    content.push(json!({ "type": "input_image", "image_url": url }));
                }
                input.push(json!({ "role": "user", "content": content }));
            }
            AgentMessage::Assistant { native, .. } if !native.is_empty() => {
                input.extend(native.iter().cloned());
            }
            AgentMessage::Assistant { text, tool_calls, .. } => {
                if !text.is_empty() {
                    input.push(json!({ "role": "assistant", "content": text }));
                }
                for call in tool_calls {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": call.id,
                        "name": call.name,
                        "arguments": call.arguments.to_string(),
                    }));
                }
            }
            AgentMessage::ToolResult { tool_call_id, content, .. } => {
                input.push(json!({ "type": "function_call_output", "call_id": tool_call_id, "output": content }));
            }
        }
    }

    let mut body = json!({
        "model": model,
        "instructions": system_prompt,
        "input": input,
        "tools": function_tools,
        "tool_choice": "auto",
        "store": false,
        "stream": true
    });
    if is_openai_reasoning_model(model) {
        body["include"] = json!(["reasoning.encrypted_content"]);
    }
    body
}

/// 普通聊天、标题与摘要请求体（自定义模型选择 Responses 格式时使用）：系统提示词放 instructions，不在上游留存对话
pub fn build_openai_responses_body(request: &ClientChatRequest, model: &str) -> serde_json::Value {
    let instructions = build_system_prompt(
        request.locale,
        request.mode,
        request.web_search.unwrap_or(false),
        request.current_time.as_deref(),
    );
    let input: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|msg| {
            if msg.role != "user" {
                return json!({ "role": msg.role, "content": msg.text });
            }
            let Some(url) = &msg.image_data_url else {
                return json!({ "role": "user", "content": [{ "type": "input_text", "text": msg.text }] });
            };
            let text = if !msg.text.is_empty() {
                msg.text.as_str()
            } else if request.locale == ChatLocale::JaJp {
                "この画像を見てください。"
            } else {
                "请看看这张图片。"
            };
            json!({
                "role": "user",
                "content": [
                    { "type": "input_text", "text": text },
                    { "type": "input_image", "image_url": url }
                ]
            })
        })
        .collect();
    json!({
        "model": model,
        "instructions": instructions,
        "input": input,
        "store": false,
        "stream": true
    })
}

/// 解析 Responses 流事件：正文、推理摘要、函数调用（按 output_index 聚合）与用量
pub fn extract_openai_responses_delta(data: &str) -> Option<ExtractedDelta> {
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    let event_type = parsed.get("type").and_then(|v| v.as_str())?;
    let output_index = parsed.get("output_index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let text_of = |field: &str| {
        parsed
            .get(field)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
    };

    let mut delta = ExtractedDelta::default();
    match event_type {
        "response.output_text.delta" => delta.content = Some(text_of("delta")?),
        "response.reasoning_summary_text.delta" => delta.thought = Some(text_of("delta")?),
        "response.output_item.added" => {
            let item = parsed.get("item")?;
            if item.get("type").and_then(|v| v.as_str()) != Some("function_call") {
                return None;
            }
            delta.tool_calls.push(ToolCallStreamDelta::Openai {
                index: output_index,
                id: item.get("call_id").and_then(|v| v.as_str()).map(String::from),
                name: item.get("name").and_then(|v| v.as_str()).map(String::from),
                arguments_fragment: None,
            });
        }
        "response.function_call_arguments.delta" => {
            delta.tool_calls.push(ToolCallStreamDelta::Openai {
                index: output_index,
                id: None,
                name: None,
                arguments_fragment: Some(text_of("delta")?),
            });
        }
        "response.completed" => {
            let usage = parsed.get("response")?.get("usage")?;
            let field = |name: &str| usage.get(name).and_then(|v| v.as_u64()).map(|v| v as u32);
            delta.usage = Some(TokenUsage {
                prompt_tokens: field("input_tokens"),
                completion_tokens: field("output_tokens"),
                total_tokens: field("total_tokens"),
            });
        }
        _ => return None,
    }
    Some(delta)
}

/// 收集一轮完整的输出项（推理项、消息、函数调用）供下一轮原样回传；流内失败事件转为错误
#[derive(Default)]
pub struct ResponsesTurnCollector {
    items: Vec<serde_json::Value>,
    error: Option<String>,
}

impl ResponsesTurnCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, data: &str) {
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) else { return };
        match parsed.get("type").and_then(|v| v.as_str()) {
            Some("response.output_item.done") => {
                if let Some(item) = parsed.get("item") {
                    self.items.push(item.clone());
                }
            }
            Some("response.failed") => {
                let error = parsed.get("response").and_then(|r| r.get("error"));
                self.error = Some(error.map(|e| e.to_string()).unwrap_or_else(|| "response.failed".to_string()));
            }
            Some("error") => {
                self.error = Some(parsed.to_string());
            }
            _ => {}
        }
    }

    pub fn finish(self) -> Result<Vec<serde_json::Value>, String> {
        match self.error {
            Some(error) => Err(format!("上游返回错误: {}", error)),
            None => Ok(self.items),
        }
    }
}
