use crate::gateway::agent::messages::AgentMessage;
use crate::gateway::prompt::build_system_prompt;
use crate::types::{ChatLocale, ClientChatRequest, ClientHistoryMessage, ExtractedDelta, TokenUsage, ToolInvocation};
use serde_json::json;

/// 服务端拒答回退（`fallbacks: "default"`）所需的 beta 头
pub const SERVER_SIDE_FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Agent 单次请求输出预算：Claude 5 系列思考常开且思考 token 计入 max_tokens，
/// 预算过小会截断长文件写入的工具参数；流式请求不受 HTTP 超时约束
pub const ANTHROPIC_AGENT_MAX_TOKENS: u32 = 64_000;

/// Haiku 4.5 仍使用 budget_tokens 思考协议，不接受 adaptive thinking 与 effort
fn is_legacy_thinking_model(model: &str) -> bool {
    model == "claude-haiku-4-5"
}

/// 安全分类器可能拒答、且支持服务端回退到其他模型继续作答的型号
fn supports_server_fallback(model: &str) -> bool {
    matches!(model, "claude-fable-5-1" | "claude-opus-5-5" | "claude-opus-5" | "claude-sonnet-5-5")
}

/// 该模型请求需要附带的 `anthropic-beta` 头
pub fn anthropic_beta_header(model: &str) -> Option<&'static str> {
    supports_server_fallback(model).then_some(SERVER_SIDE_FALLBACK_BETA)
}

/// 角色提示词（数万字符）是每次请求都相同的前缀，而 <runtime> 段携带逐分钟变化的时间与工作区信息。
/// Anthropic 不做隐式前缀缓存，在两段之间显式打缓存断点，后续请求的工具定义与角色提示词按缓存读取计费
pub fn build_anthropic_system(prompt: &str) -> serde_json::Value {
    match prompt.find("\n\n<runtime>") {
        Some(boundary) if boundary > 0 => json!([
            { "type": "text", "text": &prompt[..boundary], "cache_control": { "type": "ephemeral" } },
            { "type": "text", "text": &prompt[boundary + 2..] }
        ]),
        _ => json!(prompt),
    }
}

/// adaptive thinking 字段：display 为 None 时沿用服务端默认（omitted），effort 为 None 时沿用模型默认档位
fn apply_thinking(body: &mut serde_json::Value, model: &str, display: Option<&str>, effort: Option<&str>) {
    if is_legacy_thinking_model(model) {
        return;
    }
    body["thinking"] = match display {
        Some(display) => json!({ "type": "adaptive", "display": display }),
        None => json!({ "type": "adaptive" }),
    };
    if let Some(effort) = effort {
        body["output_config"] = json!({ "effort": effort });
    }
}

fn parse_image_data_url(data_url: &str) -> Option<(&str, &str)> {
    if !data_url.starts_with("data:image/") {
        return None;
    }
    let parts: Vec<&str> = data_url.splitn(2, ";base64,").collect();
    if parts.len() != 2 {
        return None;
    }
    let mime_type = &parts[0]["data:".len()..];
    let base64_data = parts[1];
    Some((mime_type, base64_data))
}

pub fn build_anthropic_messages(
    messages: &[ClientHistoryMessage],
    locale: ChatLocale,
) -> Vec<serde_json::Value> {
    let mut mapped = Vec::new();

    for msg in messages {
        let role = if msg.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        if let Some(image_url) = &msg.image_data_url {
            if let Some((mime_type, base64_data)) = parse_image_data_url(image_url) {
                let default_text = match locale {
                    ChatLocale::JaJp => "この画像を見てください。",
                    ChatLocale::ZhCn => "请看看这张图片。",
                };
                let text = if msg.text.is_empty() {
                    default_text
                } else {
                    &msg.text
                };
                mapped.push(json!({
                    "role": role,
                    "content": [
                        { "type": "text", "text": text },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": base64_data
                            }
                        }
                    ]
                }));
                continue;
            }
        }

        mapped.push(json!({
            "role": role,
            "content": msg.text
        }));
    }

    // Merge consecutive same-role messages
    let mut merged = Vec::new();
    for msg in mapped {
        if merged.is_empty() {
            if msg["role"] != "user" {
                continue;
            }
            merged.push(msg);
            continue;
        }

        let last_idx = merged.len() - 1;
        let last_role = merged[last_idx]["role"].as_str().unwrap_or_default();
        let curr_role = msg["role"].as_str().unwrap_or_default();

        if last_role == curr_role {
            let last_content = &merged[last_idx]["content"];
            let curr_content = &msg["content"];

            if last_content.is_string() && curr_content.is_string() {
                let combined = format!(
                    "{}\n\n{}",
                    last_content.as_str().unwrap_or_default(),
                    curr_content.as_str().unwrap_or_default()
                );
                merged[last_idx]["content"] = json!(combined);
            } else {
                let mut last_blocks = if last_content.is_array() {
                    last_content.as_array().cloned().unwrap_or_default()
                } else {
                    vec![json!({ "type": "text", "text": last_content.as_str().unwrap_or_default() })]
                };
                let curr_blocks = if curr_content.is_array() {
                    curr_content.as_array().cloned().unwrap_or_default()
                } else {
                    vec![json!({ "type": "text", "text": curr_content.as_str().unwrap_or_default() })]
                };
                last_blocks.extend(curr_blocks);
                merged[last_idx]["content"] = json!(last_blocks);
            }
        } else {
            merged.push(msg);
        }
    }

    merged
}

pub fn build_anthropic_body(
    request: &ClientChatRequest,
    model: &str,
) -> serde_json::Value {
    let system_prompt = build_system_prompt(
        request.locale,
        request.mode,
        request.web_search.unwrap_or(false),
        request.current_time.as_deref(),
    );

    let auxiliary = matches!(
        request.mode,
        Some(crate::types::RequestMode::Summary | crate::types::RequestMode::Title)
    );
    // 思考 token 计入 max_tokens，辅助请求也需留出 low 档位的思考空间
    let max_tokens = if let Some(crate::types::RequestMode::Summary) = request.mode {
        4096
    } else if let Some(crate::types::RequestMode::Title) = request.mode {
        1024
    } else {
        16000
    };

    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": build_anthropic_system(&system_prompt),
        "messages": build_anthropic_messages(&request.messages, request.locale),
        "stream": true
    });
    // 默认 omitted 只返回空思考块，聊天显式请求思考摘要才有 thought 流
    apply_thinking(&mut body, model, (!auxiliary).then_some("summarized"), Some("low"));
    if supports_server_fallback(model) {
        body["fallbacks"] = json!("default");
    }
    body
}

/// Agent 模式请求体：tool_use 块 + tool_result 回填（user 角色内嵌）
pub fn build_anthropic_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let mut anthropic_tools: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            let function = &t["function"];
            json!({
                "name": function["name"],
                "description": function["description"],
                "input_schema": function["parameters"],
            })
        })
        .collect();

    // 对齐 Claude Code 缓存策略：在工具定义列表末尾添加 cache_control 断点，
    // 使 System Prompt 与全部工具定义在后续多轮会话中 100% 命中缓存
    if let Some(last_tool) = anthropic_tools.last_mut() {
        last_tool["cache_control"] = json!({ "type": "ephemeral" });
    }

    let mut mapped: Vec<serde_json::Value> = Vec::new();
    for msg in messages {
        match msg {
            AgentMessage::User { text, image_data_url } => {
                let mut blocks = vec![json!({ "type": "text", "text": text })];
                if let Some(url) = image_data_url {
                    if let Some((mime_type, base64_data)) = parse_image_data_url(url) {
                        blocks.push(json!({
                            "type": "image",
                            "source": { "type": "base64", "media_type": mime_type, "data": base64_data }
                        }));
                    }
                }
                // 紧跟工具结果的用户消息（如 look 截图）并入同一条，保持 user/assistant 严格交替
                match mapped.last_mut() {
                    Some(last) if last["role"] == "user" && last["content"].is_array() => {
                        if let Some(content) = last["content"].as_array_mut() {
                            content.extend(blocks);
                        }
                    }
                    _ => mapped.push(json!({ "role": "user", "content": blocks })),
                }
            }
            // 本运行内的轮次原样回传内容块：思考块签名绑定原始前缀，重建会丢失推理延续
            AgentMessage::Assistant { native, .. } if !native.is_empty() => {
                mapped.push(json!({ "role": "assistant", "content": native }));
            }
            AgentMessage::Assistant { text, tool_calls, .. } => {
                let mut blocks: Vec<serde_json::Value> = Vec::new();
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                for call in tool_calls {
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": call.arguments,
                    }));
                }
                if !blocks.is_empty() {
                    mapped.push(json!({ "role": "assistant", "content": blocks }));
                }
            }
            AgentMessage::ToolResult { tool_call_id, content, .. } => {
                let block = json!({
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": content,
                });
                // 连续 tool_result 合并进同一条 user 消息（Anthropic 要求）
                match mapped.last_mut() {
                    Some(last) if last["role"] == "user" && last["content"].is_array() => {
                        last["content"].as_array_mut().unwrap().push(block);
                    }
                    _ => mapped.push(json!({ "role": "user", "content": [block] })),
                }
            }
        }
    }

    // 对齐 Claude Code 消息断点缓存：在倒数第二条（上一轮末尾）或最后一条 user 消息末尾打上缓存断点，
    // 使得多轮 Agent 交互中已完成的前 N-1 轮会话历史 100% 命中缓存
    let user_indices: Vec<usize> = mapped
        .iter()
        .enumerate()
        .filter_map(|(idx, m)| if m["role"] == "user" { Some(idx) } else { None })
        .collect();
    if let Some(&target_idx) = user_indices.iter().rev().nth(1).or_else(|| user_indices.last()) {
        if let Some(blocks) = mapped[target_idx]["content"].as_array_mut() {
            if let Some(last_block) = blocks.last_mut() {
                last_block["cache_control"] = json!({ "type": "ephemeral" });
            }
        }
    }

    // 运行内历史只追加不改写：顶层自动缓存断点随对话前移，每轮复用上一轮的前缀缓存
    let mut body = json!({
        "model": model,
        "max_tokens": ANTHROPIC_AGENT_MAX_TOKENS,
        "system": build_anthropic_system(system_prompt),
        "messages": mapped,
        "tools": anthropic_tools,
        "cache_control": { "type": "ephemeral" },
        "stream": true
    });
    apply_thinking(&mut body, model, Some("summarized"), None);
    if supports_server_fallback(model) {
        body["fallbacks"] = json!("default");
    }
    body
}

/// 按 content block index 还原一轮完整的 assistant 内容块（含思考签名与工具参数），供 Agent 循环原样回传
#[derive(Default)]
pub struct AnthropicTurnCollector {
    blocks: Vec<(usize, serde_json::Value)>,
    partial_json: std::collections::HashMap<usize, String>,
}

impl AnthropicTurnCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, data: &str) {
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) else { return };
        let index = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        match parsed.get("type").and_then(|v| v.as_str()) {
            Some("content_block_start") => {
                let Some(block) = parsed.get("content_block") else { return };
                if block.get("type").and_then(|v| v.as_str()) == Some("fallback") {
                    // 拒答回退边界之前的思考块与工具调用不得回传，文本块作为续写上下文保留
                    self.blocks.retain(|(_, b)| b.get("type").and_then(|v| v.as_str()) == Some("text"));
                    self.partial_json.clear();
                    return;
                }
                self.blocks.push((index, block.clone()));
            }
            Some("content_block_delta") => {
                let Some(delta) = parsed.get("delta") else { return };
                let Some((_, block)) = self.blocks.iter_mut().find(|(i, _)| *i == index) else { return };
                let append = |block: &mut serde_json::Value, field: &str, piece: Option<&str>| {
                    if let Some(piece) = piece {
                        let current = block.get(field).and_then(|v| v.as_str()).unwrap_or_default();
                        block[field] = json!(format!("{}{}", current, piece));
                    }
                };
                match delta.get("type").and_then(|v| v.as_str()) {
                    Some("text_delta") => append(block, "text", delta.get("text").and_then(|v| v.as_str())),
                    Some("thinking_delta") => {
                        append(block, "thinking", delta.get("thinking").and_then(|v| v.as_str()))
                    }
                    Some("signature_delta") => {
                        if let Some(signature) = delta.get("signature") {
                            block["signature"] = signature.clone();
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some(partial) = delta.get("partial_json").and_then(|v| v.as_str()) {
                            self.partial_json.entry(index).or_default().push_str(partial);
                        }
                    }
                    _ => {}
                }
            }
            Some("content_block_stop") => {
                if let Some(raw) = self.partial_json.remove(&index) {
                    if let Some((_, block)) = self.blocks.iter_mut().find(|(i, _)| *i == index) {
                        block["input"] = serde_json::from_str(&raw).unwrap_or(json!({}));
                    }
                }
            }
            _ => {}
        }
    }

    /// 收尾：返回可回传的内容块（上游拒绝空文本块，一并剔除）与其中的工具调用
    pub fn finish(self) -> (Vec<serde_json::Value>, Vec<ToolInvocation>) {
        let blocks: Vec<serde_json::Value> = self
            .blocks
            .into_iter()
            .map(|(_, block)| block)
            .filter(|block| {
                block.get("type").and_then(|v| v.as_str()) != Some("text")
                    || block.get("text").and_then(|v| v.as_str()).is_some_and(|t| !t.is_empty())
            })
            .collect();
        let tool_calls = blocks
            .iter()
            .filter(|block| block.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
            .filter_map(|block| {
                Some(ToolInvocation {
                    id: block.get("id")?.as_str()?.to_string(),
                    name: block.get("name")?.as_str()?.to_string(),
                    arguments: block.get("input").cloned().unwrap_or(json!({})),
                })
            })
            .collect();
        (blocks, tool_calls)
    }
}

pub fn extract_anthropic_delta(data: &str) -> Option<ExtractedDelta> {
    if data == "[DONE]" {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    let event_type = parsed.get("type").and_then(|v| v.as_str())?;

    let mut delta = ExtractedDelta::default();

    match event_type {
        "message_start" => {
            if let Some(msg) = parsed.get("message") {
                if let Some(usage) = msg.get("usage") {
                    // input_tokens 只含未命中缓存的部分，提示词总量需加上缓存写入与读取
                    let field = |name: &str| usage.get(name).and_then(|v| v.as_u64()).map(|v| v as u32);
                    let cache_write = field("cache_creation_input_tokens");
                    let cache_read = field("cache_read_input_tokens");
                    let input_tokens = field("input_tokens")
                        .map(|v| v + cache_write.unwrap_or(0) + cache_read.unwrap_or(0));
                    if input_tokens.is_some() {
                        delta.usage = Some(TokenUsage {
                            prompt_tokens: input_tokens,
                            cache_read_tokens: cache_read,
                            cache_write_tokens: cache_write,
                            ..Default::default()
                        });
                        return Some(delta);
                    }
                }
            }
            None
        }
        "message_delta" => {
            if let Some(usage) = parsed.get("usage") {
                let output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
                if output_tokens.is_some() {
                    delta.usage = Some(TokenUsage { completion_tokens: output_tokens, ..Default::default() });
                    return Some(delta);
                }
            }
            None
        }
        "content_block_start" => {
            if let Some(block) = parsed.get("content_block") {
                if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    let index = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let block_id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    let name = block.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    if !block_id.is_empty() && !name.is_empty() {
                        delta.tool_calls.push(crate::types::ToolCallStreamDelta::AnthropicStart {
                            index,
                            block_id,
                            name,
                        });
                        return Some(delta);
                    }
                }
            }
            None
        }
        "content_block_stop" => {
            let index = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            delta.tool_calls.push(crate::types::ToolCallStreamDelta::AnthropicStop { index });
            Some(delta)
        }
        "content_block_delta" => {
            if let Some(delta_obj) = parsed.get("delta") {
                let delta_type = delta_obj.get("type").and_then(|v| v.as_str()).unwrap_or("text_delta");
                if delta_type == "thinking_delta" {
                    if let Some(thinking) = delta_obj.get("thinking").and_then(|v| v.as_str()) {
                        if !thinking.is_empty() {
                            delta.thought = Some(thinking.to_string());
                            return Some(delta);
                        }
                    }
                } else if delta_type == "text_delta" {
                    if let Some(text) = delta_obj.get("text").and_then(|v| v.as_str()) {
                        if !text.is_empty() {
                            delta.content = Some(text.to_string());
                            return Some(delta);
                        }
                    }
                } else if delta_type == "input_json_delta" {
                    if let Some(partial) = delta_obj.get("partial_json").and_then(|v| v.as_str()) {
                        if !partial.is_empty() {
                            let index = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                            delta.tool_calls.push(crate::types::ToolCallStreamDelta::AnthropicArgs {
                                index,
                                partial_json: partial.to_string(),
                            });
                            return Some(delta);
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}
