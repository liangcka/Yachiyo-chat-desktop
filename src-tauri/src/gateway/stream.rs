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
        ClientStreamEvent::Done { truncated, usage } => {
            let mut payload = json!({ "truncated": truncated });
            if let Some(u) = usage {
                payload["usage"] = json!(u);
            }
            format!("event: done\ndata: {}\n\n", payload)
        }
        ClientStreamEvent::Error { code } => {
            format!("event: error\ndata: {}\n\n", json!({ "code": code }))
        }
        ClientStreamEvent::ToolCall { id, name, arguments } => {
            format!("event: tool_call\ndata: {}\n\n", json!({ "id": id, "name": name, "arguments": arguments }))
        }
        ClientStreamEvent::ToolResult { id, name, output, is_error, duration_ms } => {
            format!(
                "event: tool_result\ndata: {}\n\n",
                json!({ "id": id, "name": name, "output": output, "isError": is_error, "durationMs": duration_ms })
            )
        }
        ClientStreamEvent::PermissionRequest { request_id, tool_name, arguments } => {
            format!(
                "event: permission_request\ndata: {}\n\n",
                json!({ "requestId": request_id, "toolName": tool_name, "arguments": arguments })
            )
        }
        ClientStreamEvent::PermissionResolved { request_id, approved } => {
            format!(
                "event: permission_resolved\ndata: {}\n\n",
                json!({ "requestId": request_id, "approved": approved })
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

pub fn extract_openai_delta(data: &str) -> Option<crate::types::ExtractedDelta> {
    let parsed: serde_json::Value = serde_json::from_str(data).ok()?;
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
            }
        }
    }

    if delta.content.is_none() && delta.thought.is_none() && delta.usage.is_none() {
        None
    } else {
        Some(delta)
    }
}
