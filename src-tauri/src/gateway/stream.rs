use crate::types::{ClientStreamEvent, TokenUsage};
use serde_json::json;

pub fn encode_client_event(event: &ClientStreamEvent) -> String {
    match event {
        ClientStreamEvent::Delta { text } => {
            format!("event: delta\ndata: {}\n\n", json!({ "text": text }))
        }
        ClientStreamEvent::Thought { text } => {
            format!("event: thought\ndata: {}\n\n", json!({ "text": text }))
        }
        ClientStreamEvent::Sources { sources } => {
            format!("event: sources\ndata: {}\n\n", json!({ "sources": sources }))
        }
        ClientStreamEvent::Done { truncated, usage, reason, unknown } => {
            let mut payload = json!({ "truncated": truncated });
            if let Some(u) = usage {
                payload["usage"] = json!(u);
            }
            if let Some(reason) = reason {
                payload["reason"] = json!(reason);
            }
            if !unknown.is_empty() {
                payload["unknown"] = json!(unknown);
            }
            format!("event: done\ndata: {}\n\n", payload)
        }
        ClientStreamEvent::Error { code } => {
            format!("event: error\ndata: {}\n\n", json!({ "code": code }))
        }
        ClientStreamEvent::UpstreamError { message } => {
            format!("event: error\ndata: {}\n\n", json!({ "code": "PROVIDER_STREAM_ERROR", "message": message }))
        }
        ClientStreamEvent::Notice { code } => {
            format!("event: notice\ndata: {}\n\n", json!({ "code": code }))
        }
        ClientStreamEvent::ToolCall { id, name, arguments } => {
            format!("event: tool_call\ndata: {}\n\n", json!({ "id": id, "name": name, "arguments": arguments }))
        }
        ClientStreamEvent::ToolOutput { id, stream, text } => {
            format!("event: tool_output\ndata: {}\n\n", json!({ "id": id, "stream": stream, "text": text }))
        }
        ClientStreamEvent::ToolResult { id, name, output, is_error, duration_ms, command } => {
            let mut payload = json!({ "id": id, "name": name, "output": output, "isError": is_error, "durationMs": duration_ms });
            if let Some(command) = command {
                payload["command"] = command.clone();
            }
            format!("event: tool_result\ndata: {}\n\n", payload)
        }
        ClientStreamEvent::PermissionRequest { request_id, tool_name, arguments, call_id } => {
            format!(
                "event: permission_request\ndata: {}\n\n",
                json!({ "requestId": request_id, "toolName": tool_name, "arguments": arguments, "callId": call_id })
            )
        }
        ClientStreamEvent::PermissionResolved { request_id, approved, reason } => {
            format!(
                "event: permission_resolved\ndata: {}\n\n",
                json!({ "requestId": request_id, "approved": approved, "reason": reason })
            )
        }
        ClientStreamEvent::RunStatus { run_id, status, pending } => {
            format!("event: run_status\ndata: {}\n\n", json!({ "runId": run_id, "status": status, "pending": pending }))
        }
        ClientStreamEvent::RunNote { kind, detail } => {
            format!("event: run_note\ndata: {}\n\n", json!({ "kind": kind, "detail": detail }))
        }
        ClientStreamEvent::SupplementDelivered { run_id, ids } => {
            format!("event: supplement_delivered\ndata: {}\n\n", json!({ "runId": run_id, "ids": ids }))
        }
        ClientStreamEvent::RunStarted { run_id, conversation_id, workspace, execution_mode, provider, model, started_at } => {
            format!(
                "event: run_started\ndata: {}\n\n",
                json!({
                    "runId": run_id,
                    "conversationId": conversation_id,
                    "workspace": workspace,
                    "executionMode": execution_mode,
                    "provider": provider,
                    "model": model,
                    "startedAt": started_at,
                })
            )
        }
        ClientStreamEvent::Turn { index, usage } => {
            let mut payload = json!({ "index": index });
            if let Some(u) = usage {
                payload["usage"] = json!(u);
            }
            format!("event: turn\ndata: {}\n\n", payload)
        }
    }
}

pub fn encode_ping() -> &'static str {
    ": ping\n\n"
}

/// 上游 SSE 字节流解码器：按字节缓冲，凑齐以空行结尾的完整事件后再解码。
/// 网络分块可能切在多字节字符中间，逐块按 UTF-8 解码会把整块数据连同其中的事件一起丢掉
#[derive(Default)]
pub struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    /// 追加一块字节，返回其中已完整事件的 data 内容；多行 data 以换行拼接，没有 data 的事件跳过
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut payloads = Vec::new();
        let mut start = 0;
        while let Some(pos) = self.buffer[start..].windows(2).position(|pair| pair == b"\n\n") {
            let record = String::from_utf8_lossy(&self.buffer[start..start + pos]);
            start += pos + 2;
            let mut data = String::new();
            for line in record.lines() {
                if let Some(content) = line.trim().strip_prefix("data:") {
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(content.trim_start());
                }
            }
            if !data.is_empty() {
                payloads.push(data);
            }
        }
        self.buffer.drain(..start);
        payloads
    }
}

/// MiniMax reasoning_split 模式的 reasoning_details[].text 拼接；不同实现分别按累计快照或增量下发
fn reasoning_details_text(delta_obj: &serde_json::Value) -> Option<String> {
    let text: String = delta_obj
        .get("reasoning_details")?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
        .collect();
    (!text.is_empty()).then_some(text)
}

/// 无状态解析：reasoning_details 按增量处理，正文原样透传
pub fn extract_openai_delta(data: &str) -> Option<crate::types::ExtractedDelta> {
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
    extract_openai_delta_value(&parsed)
}

fn extract_openai_delta_value(parsed: &serde_json::Value) -> Option<crate::types::ExtractedDelta> {
    let mut delta = crate::types::ExtractedDelta::default();

    if let Some(usage) = parsed.get("usage") {
        let p = usage.get("prompt_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
        let c = usage.get("completion_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
        let t = usage.get("total_tokens").and_then(|v| v.as_u64()).map(|v| v as u32);
        if p.is_some() || c.is_some() || t.is_some() {
            delta.usage = Some(TokenUsage {
                prompt_tokens: p,
                completion_tokens: c,
                total_tokens: t,
            });
        }
    }

    if let Some(choices) = parsed.get("choices").and_then(|v| v.as_array()) {
        if let Some(first) = choices.first() {
            if let Some(delta_obj) = first.get("delta") {
                if let Some(content) = delta_obj.get("content").and_then(|v| v.as_str()) {
                    if !content.is_empty() {
                        delta.content = Some(content.to_string());
                    }
                }
                if let Some(thought) = delta_obj
                    .get("reasoning_content")
                    .or_else(|| delta_obj.get("reasoning"))
                    .and_then(|v| v.as_str())
                {
                    if !thought.is_empty() {
                        delta.thought = Some(thought.to_string());
                    }
                }
                if delta.thought.is_none() {
                    delta.thought = reasoning_details_text(delta_obj);
                }
                if let Some(tool_calls) = delta_obj.get("tool_calls").and_then(|v| v.as_array()) {
                    for tc in tool_calls {
                        let index = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                        let id = tc.get("id").and_then(|v| v.as_str()).map(String::from);
                        let function = tc.get("function");
                        let name = function
                            .and_then(|f| f.get("name"))
                            .and_then(|v| v.as_str())
                            .map(String::from);
                        let arguments_fragment = function
                            .and_then(|f| f.get("arguments"))
                            .and_then(|v| v.as_str())
                            .map(String::from);
                        if id.is_some() || name.is_some() || arguments_fragment.is_some() {
                            delta.tool_calls.push(crate::types::ToolCallStreamDelta::Openai {
                                index,
                                id,
                                name,
                                arguments_fragment,
                            });
                        }
                    }
                }
            }
        }
    }

    if delta.content.is_none() && delta.thought.is_none() && delta.usage.is_none() && delta.tool_calls.is_empty() {
        None
    } else {
        Some(delta)
    }
}

const THINK_OPEN_TAG: &str = "<think>";
const THINK_CLOSE_TAG: &str = "</think>";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum ThinkPhase {
    #[default]
    Start,
    Thinking,
    AfterThink,
    Content,
}

/// text 末尾与 tag 前缀重合的最长字节长度，用于保留被拆到下一个 chunk 的半个标签
fn partial_tag_suffix_len(text: &str, tag: &str) -> usize {
    (1..tag.len().min(text.len() + 1))
        .rev()
        .find(|&len| text.is_char_boundary(text.len() - len) && tag.starts_with(&text[text.len() - len..]))
        .unwrap_or(0)
}

/// 正文开头的 <think>…</think> 拆分器（与 Web 端 createThinkTagSplitter 一致）：部分厂商把思考混在 content 里，
/// 只识别正文最开始的思考块，之后的内容原样透传；开头单独出现的 </think> 直接丢弃
#[derive(Debug, Default)]
pub struct ThinkTagSplitter {
    phase: ThinkPhase,
    pending: String,
}

impl ThinkTagSplitter {
    /// 返回 (正文, 思考)
    pub fn push(&mut self, chunk: &str) -> (String, String) {
        let mut content = String::new();
        let mut thought = String::new();
        let mut text = std::mem::take(&mut self.pending);
        text.push_str(chunk);
        while !text.is_empty() {
            match self.phase {
                ThinkPhase::Content => {
                    content.push_str(&text);
                    break;
                }
                ThinkPhase::Start => {
                    let lead = text.trim_start();
                    if let Some(rest) = lead.strip_prefix(THINK_OPEN_TAG) {
                        self.phase = ThinkPhase::Thinking;
                        text = rest.to_string();
                    } else if let Some(rest) = lead.strip_prefix(THINK_CLOSE_TAG) {
                        self.phase = ThinkPhase::AfterThink;
                        text = rest.to_string();
                    } else if THINK_OPEN_TAG.starts_with(lead) || THINK_CLOSE_TAG.starts_with(lead) {
                        self.pending = text;
                        break;
                    } else {
                        self.phase = ThinkPhase::Content;
                    }
                }
                ThinkPhase::Thinking => {
                    if let Some(end) = text.find(THINK_CLOSE_TAG) {
                        thought.push_str(&text[..end]);
                        text = text[end + THINK_CLOSE_TAG.len()..].to_string();
                        self.phase = ThinkPhase::AfterThink;
                    } else {
                        let keep = partial_tag_suffix_len(&text, THINK_CLOSE_TAG);
                        let split = text.len() - keep;
                        thought.push_str(&text[..split]);
                        self.pending = text[split..].to_string();
                        break;
                    }
                }
                ThinkPhase::AfterThink => {
                    // 思考块之后的空行属于标签排版，不计入正文
                    text = text.trim_start().to_string();
                    if !text.is_empty() {
                        self.phase = ThinkPhase::Content;
                    }
                }
            }
        }
        (content, thought)
    }
}

/// 有状态解析（每个请求一份，与 Web 端 createOpenAIDeltaExtractor 一致）：
/// reasoning_details 同时兼容累计快照与增量两种下发方式，正文开头混入的思考块转为思考流
#[derive(Debug, Default)]
pub struct OpenAiDeltaParser {
    details_seen: String,
    splitter: ThinkTagSplitter,
}

impl OpenAiDeltaParser {
    pub fn parse(&mut self, data: &str) -> Option<crate::types::ExtractedDelta> {
        let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
        let mut delta = extract_openai_delta_value(&parsed)?;
        let delta_obj = parsed.pointer("/choices/0/delta");
        let has_reasoning_field = delta_obj
            .and_then(|d| d.get("reasoning_content").or_else(|| d.get("reasoning")))
            .and_then(|v| v.as_str())
            .is_some_and(|text| !text.is_empty());
        if let Some(details) = delta_obj.and_then(reasoning_details_text) {
            let cumulative = !self.details_seen.is_empty() && details.starts_with(&self.details_seen);
            let increment = if cumulative { details[self.details_seen.len()..].to_string() } else { details.clone() };
            if cumulative {
                self.details_seen = details;
            } else {
                self.details_seen.push_str(&increment);
            }
            // 同一 delta 同时带 reasoning_content 与 reasoning_details 时以前者为准，避免重复计入
            if !has_reasoning_field {
                delta.thought = (!increment.is_empty()).then_some(increment);
            }
        }
        if let Some(content) = delta.content.take() {
            let (content, inline_thought) = self.splitter.push(&content);
            if !inline_thought.is_empty() {
                delta.thought = Some(delta.thought.unwrap_or_default() + &inline_thought);
            }
            delta.content = (!content.is_empty()).then_some(content);
        }
        Some(delta)
    }
}
