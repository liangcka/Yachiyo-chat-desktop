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
fn test_parse_tool_call() {
    use yachiyo_desktop_lib::gateway::parse_tool_call;

    // 1. JSON code block format
    let block = "好的，我这就帮你查看：\n```tool_call\n{\"name\": \"list_directory\", \"arguments\": {\"path\": \".\"}}\n```";
    let (name, args) = parse_tool_call(block).expect("Should parse json block");
    assert_eq!(name, "list_directory");
    assert_eq!(args["path"], ".");

    // 2. XML tag format (like model output)
    let xml = "<tool_call>\n<ollama:name>list_directory</ollama:name>\n<args><path>.</path></args>\n</function_calls>";
    let (name, args) = parse_tool_call(xml).expect("Should parse xml format");
    assert_eq!(name, "list_directory");
    assert_eq!(args["path"], ".");
}
