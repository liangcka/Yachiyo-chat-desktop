use yachiyo_desktop_lib::crypto::keys::KeyStore;
use yachiyo_desktop_lib::gateway::prompt::build_system_prompt;
use yachiyo_desktop_lib::gateway::providers::anthropic::extract_anthropic_delta;
use yachiyo_desktop_lib::gateway::providers::gemini::extract_gemini_delta;
use yachiyo_desktop_lib::gateway::stream::{encode_client_event, extract_openai_delta};
use yachiyo_desktop_lib::types::{ChatLocale, ClientStreamEvent, RequestMode, TokenUsage};

#[test]
fn test_build_system_prompt() {
    let zh_prompt = build_system_prompt(ChatLocale::ZhCn, None, false, Some("2026-08-30"));
    assert!(zh_prompt.contains("月见八千代"));
    assert!(zh_prompt.contains("酒寄彩叶"));
    assert!(zh_prompt.contains("简体中文"));

    let ja_prompt = build_system_prompt(ChatLocale::JaJp, None, false, Some("2026-08-30"));
    assert!(ja_prompt.contains("日本語"));

    let summary_prompt = build_system_prompt(ChatLocale::ZhCn, Some(RequestMode::Summary), false, None);
    assert!(summary_prompt.contains("记忆整理"));
}

#[test]
fn test_openai_delta_extraction() {
    let normal_chunk = r#"{"choices":[{"delta":{"content":"八千代~"}}]}"#;
    let delta = extract_openai_delta(normal_chunk).expect("Should parse normal chunk");
    assert_eq!(delta.content.as_deref(), Some("八千代~"));

    let thought_chunk = r#"{"choices":[{"delta":{"reasoning_content":"思考中..."}}]}"#;
    let thought_delta = extract_openai_delta(thought_chunk).expect("Should parse thought chunk");
    assert_eq!(thought_delta.thought.as_deref(), Some("思考中..."));

    let usage_chunk = r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}"#;
    let usage_delta = extract_openai_delta(usage_chunk).expect("Should parse usage chunk");
    assert_eq!(usage_delta.usage.and_then(|u| u.total_tokens), Some(30));
}

#[test]
fn test_anthropic_delta_extraction() {
    let start_chunk = r#"{"type":"message_start","message":{"usage":{"input_tokens":50}}}"#;
    let start_delta = extract_anthropic_delta(start_chunk).expect("Should parse message_start");
    assert_eq!(start_delta.usage.and_then(|u| u.prompt_tokens), Some(50));

    let text_chunk = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好！"}}"#;
    let text_delta = extract_anthropic_delta(text_chunk).expect("Should parse text delta");
    assert_eq!(text_delta.content.as_deref(), Some("你好！"));

    let thinking_chunk = r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"思考中..."}}"#;
    let thinking_delta = extract_anthropic_delta(thinking_chunk).expect("Should parse thinking delta");
    assert_eq!(thinking_delta.thought.as_deref(), Some("思考中..."));
}

#[test]
fn test_gemini_delta_extraction() {
    let gemini_chunk = r#"{"candidates":[{"content":{"parts":[{"text":"星空很美"}]}}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":25,"totalTokenCount":40}}"#;
    let gemini_delta = extract_gemini_delta(gemini_chunk).expect("Should parse gemini chunk");
    assert_eq!(gemini_delta.content.as_deref(), Some("星空很美"));
    assert_eq!(gemini_delta.usage.and_then(|u| u.total_tokens), Some(40));

    let grounding_chunk = r#"{"candidates":[{"content":{"parts":[{"text":"根据搜索"}]},"groundingMetadata":{"groundingChunks":[{"web":{"uri":"https://example.com","title":"示例"}}]}}]}"#;
    let grounding_delta = extract_gemini_delta(grounding_chunk).expect("Should parse grounding chunk");
    assert_eq!(grounding_delta.sources.as_ref().map(|s| s.len()), Some(1));
    assert_eq!(grounding_delta.sources.unwrap()[0].url, "https://example.com");
}

#[test]
fn test_client_event_encoding() {
    let delta_event = ClientStreamEvent::Delta {
        text: "hello".to_string(),
    };
    let encoded = encode_client_event(&delta_event);
    assert_eq!(encoded, "event: delta\ndata: {\"text\":\"hello\"}\n\n");

    let done_event = ClientStreamEvent::Done {
        truncated: false,
        usage: Some(TokenUsage {
            prompt_tokens: Some(10),
            completion_tokens: Some(20),
            total_tokens: Some(30),
        }),
    };
    let encoded_done = encode_client_event(&done_event);
    assert!(encoded_done.starts_with("event: done\ndata: "));
    assert!(encoded_done.contains("\"truncated\":false"));
}

#[test]
fn test_keystore_encrypt_decrypt() {
    let store = KeyStore::new();
    store.set_key("deepseek", "sk-test-key-1234567890").expect("Save key failed");
    let retrieved = store.get_key("deepseek");
    assert_eq!(retrieved.as_deref(), Some("sk-test-key-1234567890"));
    store.delete_key("deepseek").expect("Delete key failed");
    assert_eq!(store.get_key("deepseek"), None);
}

#[test]
fn test_agent_event_encoding() {
    use yachiyo_desktop_lib::types::{ClientStreamEvent, ToolInvocation};

    let tool_call = ClientStreamEvent::ToolCall {
        id: "call-1".to_string(),
        name: "read_file".to_string(),
        arguments: serde_json::json!({"path": "a.rs"}),
    };
    let encoded = encode_client_event(&tool_call);
    assert!(encoded.starts_with("event: tool_call\ndata: "));
    assert!(encoded.contains("\"id\":\"call-1\""));
    assert!(encoded.contains("\"name\":\"read_file\""));
    assert!(encoded.ends_with("\n\n"));

    let tool_result = ClientStreamEvent::ToolResult {
        id: "call-1".to_string(),
        name: "read_file".to_string(),
        output: "fn main() {}".to_string(),
        is_error: false,
        duration_ms: 42,
    };
    let encoded = encode_client_event(&tool_result);
    assert!(encoded.starts_with("event: tool_result\ndata: "));
    assert!(encoded.contains("\"isError\":false"));
    assert!(encoded.contains("\"durationMs\":42"));

    let perm_req = ClientStreamEvent::PermissionRequest {
        request_id: "req-9".to_string(),
        tool_name: "write_file".to_string(),
        arguments: serde_json::json!({"path": "b.rs"}),
    };
    let encoded = encode_client_event(&perm_req);
    assert!(encoded.starts_with("event: permission_request\ndata: "));
    assert!(encoded.contains("\"requestId\":\"req-9\""));

    let perm_res = ClientStreamEvent::PermissionResolved {
        request_id: "req-9".to_string(),
        approved: true,
    };
    let encoded = encode_client_event(&perm_res);
    assert_eq!(
        encoded,
        "event: permission_resolved\ndata: {\"requestId\":\"req-9\",\"approved\":true}\n\n"
    );

    let turn = ClientStreamEvent::Turn { index: 3, usage: None };
    let encoded = encode_client_event(&turn);
    assert_eq!(encoded, "event: turn\ndata: {\"index\":3}\n\n");
}

#[test]
fn test_agent_request_deserialization() {
    use yachiyo_desktop_lib::types::ClientChatRequest;

    let raw = r#"{
        "locale": "zh-CN",
        "messages": [
            {"role": "user", "text": "看下这个项目"},
            {"role": "assistant", "text": "好的，我先列目录", "toolCalls": [{"id": "call-1", "name": "list_directory", "arguments": {"path": "."}}]},
            {"role": "tool", "text": "src/ functions/", "toolCallId": "call-1", "toolName": "list_directory"}
        ],
        "agent": {"enabled": true, "maxTurns": 8}
    }"#;
    let req: ClientChatRequest = serde_json::from_str(raw).expect("should parse agent request");
    assert_eq!(req.agent.as_ref().expect("agent config").enabled, true);
    assert_eq!(req.agent.as_ref().unwrap().max_turns, Some(8));
    assert_eq!(req.messages.len(), 3);
    assert_eq!(req.messages[1].tool_calls.as_ref().unwrap()[0].name, "list_directory");
    assert_eq!(req.messages[2].tool_call_id.as_deref(), Some("call-1"));
    assert_eq!(req.messages[2].tool_name.as_deref(), Some("list_directory"));
}

#[test]
fn test_plain_request_still_parses_without_agent_fields() {
    use yachiyo_desktop_lib::types::ClientChatRequest;

    let raw = r#"{"locale": "zh-CN", "messages": [{"role": "user", "text": "你好"}]}"#;
    let req: ClientChatRequest = serde_json::from_str(raw).expect("legacy request must parse");
    assert!(req.agent.is_none());
    assert!(req.messages[0].tool_calls.is_none());
}

#[test]
fn test_agent_system_prompt() {
    use yachiyo_desktop_lib::gateway::prompt::build_agent_system_prompt;

    let zh = build_agent_system_prompt(ChatLocale::ZhCn, Some("2026-09-02"));
    assert!(zh.contains("月见八千代"));
    assert!(zh.contains("工具"));
    assert!(zh.contains("彩叶"));
    assert!(!zh.contains("```tool_call"));
    assert!(!zh.contains("输出最多200个Unicode字符"));

    let ja = build_agent_system_prompt(ChatLocale::JaJp, None);
    assert!(ja.contains("八千代"));
    assert!(!ja.contains("```tool_call"));
}

#[test]
fn test_plain_prompt_no_longer_contains_text_tool_protocol() {
    use yachiyo_desktop_lib::gateway::prompt::build_system_prompt;

    let zh = build_system_prompt(ChatLocale::ZhCn, None, false, Some("2026-09-02"));
    assert!(!zh.contains("```tool_call"));
    assert!(zh.contains("输出最多200个Unicode字符"));
}
