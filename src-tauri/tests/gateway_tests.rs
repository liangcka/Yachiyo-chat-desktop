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

    let title_zh = build_system_prompt(ChatLocale::ZhCn, Some(RequestMode::Title), false, None);
    assert!(title_zh.contains("标题生成"));

    let title_ja = build_system_prompt(ChatLocale::JaJp, Some(RequestMode::Title), false, None);
    assert!(title_ja.contains("会話タイトル"));
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
        reason: None,
    };
    let encoded_done = encode_client_event(&done_event);
    assert!(encoded_done.starts_with("event: done\ndata: "));
    assert!(encoded_done.contains("\"truncated\":false"));
    assert!(!encoded_done.contains("reason"));

    let loop_done = ClientStreamEvent::Done { truncated: false, usage: None, reason: Some("loop_detected".to_string()) };
    assert_eq!(encode_client_event(&loop_done), "event: done\ndata: {\"truncated\":false,\"reason\":\"loop_detected\"}\n\n");
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
    use yachiyo_desktop_lib::types::ClientStreamEvent;

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
fn test_deepseek_auxiliary_requests_disable_thinking() {
    use yachiyo_desktop_lib::gateway::providers::openai_compat::build_openai_compat_body;
    use yachiyo_desktop_lib::gateway::providers::registry::get_provider_config;
    use yachiyo_desktop_lib::types::{ClientChatRequest, ProviderId};

    let request = |mode: &str| -> ClientChatRequest {
        let mode = if mode.is_empty() { String::new() } else { format!(r#","mode":"{}""#, mode) };
        serde_json::from_str(&format!(r#"{{"locale":"zh-CN","messages":[{{"role":"user","text":"你好"}}]{}}}"#, mode)).unwrap()
    };
    let deepseek = get_provider_config(ProviderId::Deepseek);
    for mode in ["title", "summary"] {
        let body = build_openai_compat_body(&request(mode), "deepseek-v4-flash", deepseek);
        assert_eq!(body["thinking"]["type"], "disabled", "mode {mode}");
    }
    assert!(build_openai_compat_body(&request(""), "deepseek-v4-flash", deepseek).get("thinking").is_none());
    let stepfun = get_provider_config(ProviderId::Stepfun);
    assert!(build_openai_compat_body(&request("title"), "step-3.7-flash", stepfun).get("thinking").is_none());
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

    let zh = build_agent_system_prompt(ChatLocale::ZhCn, Some("2026-09-02"), None);
    assert!(zh.contains("月见八千代"));
    assert!(zh.contains("工具"));
    assert!(zh.contains("彩叶"));
    assert!(!zh.contains("```tool_call"));
    assert!(!zh.contains("输出最多200个Unicode字符"));

    let ja = build_agent_system_prompt(ChatLocale::JaJp, None, None);
    assert!(ja.contains("八千代"));
    assert!(!ja.contains("```tool_call"));
}

#[test]
fn test_agent_system_prompt_with_workspace() {
    use std::path::Path;
    use yachiyo_desktop_lib::gateway::prompt::build_agent_system_prompt;

    let ws = Path::new(env!("CARGO_MANIFEST_DIR"));
    let zh = build_agent_system_prompt(ChatLocale::ZhCn, Some("2026-09-02"), Some(ws));
    assert!(zh.contains("当前项目工作区"));
    assert!(zh.contains("项目感知与主动探索准则"));
    assert!(zh.contains("亲自探查先行"));
    assert!(zh.contains("list_directory"));
    assert!(zh.contains("read_file"));
    assert!(zh.contains("src/"));
    assert!(zh.contains("Cargo.toml"));
}

#[test]
fn test_plain_prompt_no_longer_contains_text_tool_protocol() {
    use yachiyo_desktop_lib::gateway::prompt::build_system_prompt;

    let zh = build_system_prompt(ChatLocale::ZhCn, None, false, Some("2026-09-02"));
    assert!(!zh.contains("```tool_call"));
    assert!(zh.contains("输出最多200个Unicode字符"));
}

/// 本地网关的 token 门禁与跨域源白名单的真实 HTTP 行为
#[tokio::test]
async fn test_local_gateway_token_gate_and_cors_allowlist() {
    use std::sync::Arc;
    use yachiyo_desktop_lib::crypto::keys::KeyStore;
    use yachiyo_desktop_lib::mcp::McpManager;
    use yachiyo_desktop_lib::server::http::{
        generate_gateway_token, start_local_server, GATEWAY_TOKEN_HEADER,
    };
    use yachiyo_desktop_lib::tools::WorkspaceManager;

    let temp_dir = tempfile::tempdir().expect("temp dir");
    let mcp_manager = Arc::new(McpManager::new(
        Some(temp_dir.path().join("mcp_servers.json")),
        reqwest::Client::new(),
    ));
    let token = generate_gateway_token();
    // 避开桌面端默认的 28888-28897 区间，防止与本机正在运行的实例互抢
    let (port, _server) = start_local_server(
        Arc::new(KeyStore::new()),
        Arc::new(WorkspaceManager::new(None)),
        Arc::clone(&mcp_manager),
        token.clone(),
        38888,
    )
    .await
    .expect("local gateway should start");

    let client = reqwest::Client::new();
    let session_url = format!("http://127.0.0.1:{port}/api/session");

    let unsigned = client.get(&session_url).send().await.expect("unsigned request");
    assert_eq!(unsigned.status(), reqwest::StatusCode::UNAUTHORIZED);

    let wrong_token = client
        .get(&session_url)
        .header(GATEWAY_TOKEN_HEADER, "0".repeat(token.len()))
        .send()
        .await
        .expect("wrong token request");
    assert_eq!(wrong_token.status(), reqwest::StatusCode::UNAUTHORIZED);

    let signed = client
        .get(&session_url)
        .header(GATEWAY_TOKEN_HEADER, token.as_str())
        .send()
        .await
        .expect("signed request");
    assert_eq!(signed.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = signed.json().await.expect("session json");
    assert_eq!(body["authenticated"], serde_json::json!(true));

    // 静态资源不在 token 门禁内：否则页面本身无法加载（允许 404，但不能是 401）
    let asset = client
        .get(format!("http://127.0.0.1:{port}/index.html"))
        .send()
        .await
        .expect("asset request");
    assert_ne!(asset.status(), reqwest::StatusCode::UNAUTHORIZED);

    let acao = "access-control-allow-origin";
    let evil = client
        .get(&session_url)
        .header("origin", "http://evil.example")
        .send()
        .await
        .expect("evil origin request");
    assert!(
        evil.headers().get(acao).is_none(),
        "非白名单源不得拿到 ACAO: {:?}",
        evil.headers().get(acao)
    );

    let dev = client
        .get(&session_url)
        .header("origin", "http://127.0.0.1:5173")
        .send()
        .await
        .expect("dev origin request");
    assert_eq!(
        dev.headers().get(acao).and_then(|v| v.to_str().ok()),
        Some("http://127.0.0.1:5173")
    );
}

#[test]
fn test_agent_system_prompt_evidence_verification_rule() {
    use yachiyo_desktop_lib::gateway::prompt::build_agent_system_prompt;

    let zh = build_agent_system_prompt(ChatLocale::ZhCn, Some("2026-09-02"), None);
    assert!(zh.contains("证据闭环与存疑交叉验证铁律"));
    assert!(zh.contains("严禁依赖 Win32_VideoController.AdapterRAM"));
    assert!(zh.contains("HardwareInformation.qwMemorySize"));
    assert!(zh.contains("nvidia-smi"));

    let ja = build_agent_system_prompt(ChatLocale::JaJp, None, None);
    assert!(ja.contains("エビデンス閉ループと疑問点の交差検証原則"));
    assert!(ja.contains("HardwareInformation.qwMemorySize"));
}


fn plain_request(provider: &str, mode: &str) -> yachiyo_desktop_lib::types::ClientChatRequest {
    let mode = if mode.is_empty() { String::new() } else { format!(r#","mode":"{}""#, mode) };
    serde_json::from_str(&format!(
        r#"{{"locale":"zh-CN","provider":"{}","messages":[{{"role":"user","text":"你好"}}]{}}}"#,
        provider, mode
    ))
    .unwrap()
}

#[test]
fn test_openai_official_body_uses_completion_budget_and_reasoning_effort() {
    use yachiyo_desktop_lib::gateway::providers::openai_compat::build_openai_compat_body;
    use yachiyo_desktop_lib::gateway::providers::registry::get_provider_config;
    use yachiyo_desktop_lib::types::ProviderId;

    let openai = get_provider_config(ProviderId::Openai);
    let summary = build_openai_compat_body(&plain_request("openai", "summary"), "gpt-6-luna", openai);
    assert_eq!(summary["max_completion_tokens"], 4096);
    assert!(summary.get("max_tokens").is_none());
    assert_eq!(summary["reasoning_effort"], "low");

    let legacy = build_openai_compat_body(&plain_request("openai", "title"), "gpt-4.1", openai);
    assert_eq!(legacy["max_completion_tokens"], 512);
    assert!(legacy.get("reasoning_effort").is_none());

    let stepfun = get_provider_config(ProviderId::Stepfun);
    let step = build_openai_compat_body(&plain_request("stepfun", "summary"), "step-5-preview", stepfun);
    assert_eq!(step["max_tokens"], 4096);
    assert_eq!(step["reasoning_effort"], "low");
    let glm = get_provider_config(ProviderId::Glm);
    // GLM-5.3 强制思考，不能 disabled，只能把档位降到 low
    let glm_body = build_openai_compat_body(&plain_request("glm", "title"), "glm-5.3", glm);
    assert_eq!(glm_body["reasoning_effort"], "low");
    assert!(glm_body.get("thinking").is_none());
    let legacy_glm = build_openai_compat_body(&plain_request("glm", "title"), "glm-4.7-flash", glm);
    assert!(legacy_glm.get("reasoning_effort").is_none());
}

#[test]
fn test_anthropic_chat_body_caches_role_prompt_and_tunes_thinking() {
    use yachiyo_desktop_lib::gateway::build_upstream_request;
    use yachiyo_desktop_lib::gateway::providers::anthropic::build_anthropic_body;

    let chat = build_anthropic_body(&plain_request("claude", ""), "claude-opus-5-5");
    let system = chat["system"].as_array().expect("chat system splits into cacheable blocks");
    assert_eq!(system[0]["cache_control"]["type"], "ephemeral");
    assert!(system[0]["text"].as_str().unwrap().contains("月见八千代"));
    assert!(system[1]["text"].as_str().unwrap().starts_with("<runtime>"));
    assert!(system[1].get("cache_control").is_none());
    assert_eq!(chat["max_tokens"], 16000);
    assert_eq!(chat["thinking"], serde_json::json!({ "type": "adaptive", "display": "summarized" }));
    assert_eq!(chat["output_config"]["effort"], "low");
    assert_eq!(chat["fallbacks"], "default");

    let title = build_anthropic_body(&plain_request("claude", "title"), "claude-haiku-5-5");
    assert!(title["system"].is_string());
    assert_eq!(title["max_tokens"], 1024);
    assert_eq!(title["thinking"], serde_json::json!({ "type": "adaptive" }));
    assert!(title.get("fallbacks").is_none());

    let legacy = build_anthropic_body(&plain_request("claude", ""), "claude-haiku-4-5");
    assert!(legacy.get("thinking").is_none());
    assert!(legacy.get("output_config").is_none());

    let built = build_upstream_request(&plain_request("claude", ""), "sk-ant-test", "claude-sonnet-5-5").unwrap();
    assert_eq!(built.headers.get("anthropic-beta").unwrap(), "server-side-fallback-2026-07-01");
    let built = build_upstream_request(&plain_request("claude", ""), "sk-ant-test", "claude-haiku-5-5").unwrap();
    assert!(built.headers.get("anthropic-beta").is_none());
}

#[test]
fn test_anthropic_usage_counts_cached_prompt_tokens() {
    let start = r#"{"type":"message_start","message":{"usage":{"input_tokens":12,"cache_creation_input_tokens":300,"cache_read_input_tokens":15000}}}"#;
    let delta = extract_anthropic_delta(start).expect("usage delta");
    assert_eq!(delta.usage.and_then(|u| u.prompt_tokens), Some(15312));
}

#[test]
fn test_gemini_chat_body_requests_thought_summaries() {
    use yachiyo_desktop_lib::gateway::providers::gemini::build_gemini_body;

    let chat = build_gemini_body(&plain_request("gemini", ""));
    assert_eq!(chat["generationConfig"]["thinkingConfig"]["includeThoughts"], true);
    let summary = build_gemini_body(&plain_request("gemini", "summary"));
    assert!(summary["generationConfig"]["thinkingConfig"].get("includeThoughts").is_none());
}

fn custom_request(provider: &str, mode: &str, base_url: &str) -> yachiyo_desktop_lib::types::ClientChatRequest {
    let mode = if mode.is_empty() { String::new() } else { format!(r#","mode":"{}""#, mode) };
    serde_json::from_str(&format!(
        r#"{{"locale":"zh-CN","provider":"{}","baseUrl":"{}","messages":[{{"role":"user","text":"你好"}}]{}}}"#,
        provider, base_url, mode
    ))
    .unwrap()
}

#[test]
fn test_custom_base_url_routes_plain_requests_without_official_openai_rules() {
    use yachiyo_desktop_lib::gateway::build_upstream_request;

    let request = custom_request("openai", "summary", "https://api.moonshot.cn/v1/");
    let built = build_upstream_request(&request, "sk-test", "kimi-k3").unwrap();
    assert_eq!(built.url, "https://api.moonshot.cn/v1/chat/completions");
    let body: serde_json::Value = serde_json::from_str(&built.body).unwrap();
    assert_eq!(body["max_tokens"], 4096);
    assert!(body.get("max_completion_tokens").is_none());
    assert_eq!(body["reasoning_effort"], "low");
    assert!(body.get("thinking").is_none());

    let k26 = build_upstream_request(&custom_request("openai", "title", "https://api.moonshot.ai/v1"), "sk-test", "kimi-k2.6").unwrap();
    let body: serde_json::Value = serde_json::from_str(&k26.body).unwrap();
    assert_eq!(body["thinking"]["type"], "disabled");
    assert!(body.get("reasoning_effort").is_none());

    assert!(build_upstream_request(&custom_request("claude", "", "https://api.moonshot.cn/v1"), "sk-test", "kimi-k3").is_err());
    assert!(build_upstream_request(&custom_request("openai", "", "http://api.moonshot.cn/v1"), "sk-test", "kimi-k3").is_err());
}

#[test]
fn test_compat_vendor_detection_and_domestic_routing() {
    use yachiyo_desktop_lib::gateway::providers::compat_vendor::{is_domestic_endpoint, CompatVendor};

    assert_eq!(CompatVendor::detect("https://ark.cn-beijing.volces.com/api/v3"), Some(CompatVendor::Ark));
    assert_eq!(CompatVendor::detect("https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"), Some(CompatVendor::Dashscope));
    assert_eq!(CompatVendor::detect("https://api.minimax.cn/v1"), Some(CompatVendor::MiniMax));
    assert_eq!(CompatVendor::detect("https://evilmoonshot.cn/v1"), None);
    assert_eq!(CompatVendor::resolve(None, "https://open.bigmodel.cn/api/paas/v4/chat/completions"), Some(CompatVendor::Zhipu));
    assert_eq!(CompatVendor::resolve(Some("https://api.z.ai/api/paas/v4"), "https://api.openai.com/v1/chat/completions"), Some(CompatVendor::Zhipu));
    assert_eq!(CompatVendor::resolve(None, "https://api.openai.com/v1/chat/completions"), None);

    assert!(is_domestic_endpoint("https://ark.cn-beijing.volces.com/api/v3"));
    assert!(is_domestic_endpoint("https://api.moonshot.cn/v1"));
    assert!(!is_domestic_endpoint("https://api.moonshot.ai/v1"));
    assert!(!is_domestic_endpoint("https://openrouter.ai/api/v1"));
}

#[test]
fn test_compat_vendor_body_patches_match_web_rules() {
    use yachiyo_desktop_lib::gateway::providers::compat_vendor::{body_patch, CompatVendor, RequestPurpose};

    let patch = |vendor, model, purpose| -> serde_json::Value {
        serde_json::Value::Object(body_patch(Some(vendor), model, purpose).into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    };
    use serde_json::json;
    assert_eq!(patch(CompatVendor::Dashscope, "qwen3.8-flash", RequestPurpose::Auxiliary), json!({ "enable_thinking": false }));
    assert_eq!(patch(CompatVendor::Dashscope, "qwen3.7-plus-2026-05-26", RequestPurpose::Auxiliary), json!({ "enable_thinking": false }));
    assert_eq!(patch(CompatVendor::Dashscope, "qwen3.8-max-preview", RequestPurpose::Auxiliary), json!({}));
    assert_eq!(patch(CompatVendor::Dashscope, "qwen3.7-max-2026-05-17", RequestPurpose::Auxiliary), json!({}));
    assert_eq!(patch(CompatVendor::Dashscope, "qwen3.8-max", RequestPurpose::Chat), json!({ "reasoning_effort": "low" }));
    assert_eq!(patch(CompatVendor::Dashscope, "qwen3.8-max", RequestPurpose::Agent), json!({}));
    for model in ["doubao-seed-2-1-pro-260915", "doubao-seed-2-1-lite-260915", "doubao-seed-2-0-mini-260428", "doubao-seed-evolving", "dola-seed-2-1-turbo-260628", "seed-2-0-lite-260428"] {
        assert_eq!(patch(CompatVendor::Ark, model, RequestPurpose::Auxiliary), json!({ "thinking": { "type": "disabled" } }), "{model}");
    }
    for model in ["glm-5-3-flash-260828", "kimi-k2.7-code", "doubao-seed-1-6-thinking-250715", "doubao-seed-2-0-code-preview-260215", "seed-2-0-code-preview-260328", "doubao-seed-character-251128", "ep-20260101000000-abcde"] {
        assert_eq!(patch(CompatVendor::Ark, model, RequestPurpose::Auxiliary), json!({}), "{model}");
    }
    assert_eq!(patch(CompatVendor::Ark, "doubao-seed-2-1-turbo-260628", RequestPurpose::Chat), json!({ "reasoning_effort": "low" }));
    assert_eq!(patch(CompatVendor::Ark, "doubao-seed-2-0-lite-260428", RequestPurpose::Chat), json!({}));
    assert_eq!(patch(CompatVendor::Ark, "doubao-seed-2-1-turbo-260628", RequestPurpose::Agent), json!({}));
    assert_eq!(patch(CompatVendor::MiniMax, "MiniMax-M3", RequestPurpose::Auxiliary), json!({ "reasoning_split": true, "thinking": { "type": "disabled" } }));
    assert_eq!(patch(CompatVendor::MiniMax, "MiniMax-M3", RequestPurpose::Agent), json!({ "reasoning_split": true }));
    assert_eq!(patch(CompatVendor::MiniMax, "MiniMax-M3.1-Flash", RequestPurpose::Chat), json!({ "reasoning_effort": "low" }));
    assert_eq!(patch(CompatVendor::Zhipu, "glm-5.3-flash", RequestPurpose::Chat), json!({ "reasoning_effort": "low" }));
    assert_eq!(patch(CompatVendor::Zhipu, "glm-5.2", RequestPurpose::Auxiliary), json!({ "reasoning_effort": "low" }));
    assert_eq!(patch(CompatVendor::Zhipu, "glm-4.7-flash", RequestPurpose::Chat), json!({}));
    assert_eq!(patch(CompatVendor::Zhipu, "glm-5.3", RequestPurpose::Agent), json!({ "thinking": { "type": "enabled", "clear_thinking": false } }));
    assert_eq!(patch(CompatVendor::Moonshot, "kimi-k3", RequestPurpose::Agent), json!({}));
    assert_eq!(patch(CompatVendor::Moonshot, "kimi-k2.7-code", RequestPurpose::Auxiliary), json!({}));
}

#[test]
fn test_openai_delta_parser_splits_inline_thinking_and_details_snapshots() {
    use yachiyo_desktop_lib::gateway::stream::OpenAiDeltaParser;

    let chunk = |delta: serde_json::Value| serde_json::json!({ "choices": [{ "index": 0, "delta": delta }] }).to_string();
    let mut parser = OpenAiDeltaParser::default();
    let first = parser.parse(&chunk(serde_json::json!({ "reasoning_details": [{ "type": "reasoning.text", "text": "先想" }] }))).unwrap();
    assert_eq!(first.thought.as_deref(), Some("先想"));
    let second = parser.parse(&chunk(serde_json::json!({ "reasoning_details": [{ "type": "reasoning.text", "text": "先想一想" }] }))).unwrap();
    assert_eq!(second.thought.as_deref(), Some("一想"));

    let mut parser = OpenAiDeltaParser::default();
    let held = parser.parse(&chunk(serde_json::json!({ "content": "<thi" }))).unwrap();
    assert!(held.content.is_none() && held.thought.is_none());
    let thinking = parser.parse(&chunk(serde_json::json!({ "content": "nk>用户在问候。</th" }))).unwrap();
    assert_eq!(thinking.thought.as_deref(), Some("用户在问候。"));
    assert!(thinking.content.is_none());
    let answer = parser.parse(&chunk(serde_json::json!({ "content": "ink>\n\n你好" }))).unwrap();
    assert_eq!(answer.content.as_deref(), Some("你好"));
    let later = parser.parse(&chunk(serde_json::json!({ "content": "<think>不是思考" }))).unwrap();
    assert_eq!(later.content.as_deref(), Some("<think>不是思考"));

    let mut parser = OpenAiDeltaParser::default();
    let plain = parser.parse(&chunk(serde_json::json!({ "content": "<b>你好</b>" }))).unwrap();
    assert_eq!(plain.content.as_deref(), Some("<b>你好</b>"));
}

#[test]
fn test_stored_key_is_only_released_to_the_endpoint_it_was_saved_for() {
    let dir = tempfile::tempdir().unwrap();
    let store = KeyStore::at_path(dir.path().join("keys.enc"));

    // 原生端点保存的 Key 不能被带自定义端点的请求取走
    store.set_key("openai", "sk-native-key-1234567890").unwrap();
    assert_eq!(store.get_key_for_endpoint("openai", None).as_deref(), Some("sk-native-key-1234567890"));
    assert_eq!(store.get_key_for_endpoint("openai", Some("https://evil.example/v1")), None);

    // 绑定自定义端点后，只有同一端点（忽略尾部斜杠与空白）能取到，原生端点和其他端点都取不到
    store.set_key_for_endpoint("openai", "sk-moonshot-key-1234567890", Some("https://api.moonshot.cn/v1")).unwrap();
    assert_eq!(store.get_key_for_endpoint("openai", Some("https://api.moonshot.cn/v1")).as_deref(), Some("sk-moonshot-key-1234567890"));
    assert_eq!(store.get_key_for_endpoint("openai", Some(" https://api.moonshot.cn/v1/ ")).as_deref(), Some("sk-moonshot-key-1234567890"));
    assert_eq!(store.get_key_for_endpoint("openai", None), None);
    assert_eq!(store.get_key_for_endpoint("openai", Some("https://evil.example/v1")), None);

    // 重新以原生端点保存会清掉绑定；删除 Key 同时清掉绑定
    store.set_key("openai", "sk-native-again-1234567890").unwrap();
    assert_eq!(store.get_key_for_endpoint("openai", Some("https://api.moonshot.cn/v1")), None);
    assert_eq!(store.get_key_for_endpoint("openai", None).as_deref(), Some("sk-native-again-1234567890"));
    store.set_key_for_endpoint("openai", "sk-moonshot-key-1234567890", Some("https://api.moonshot.cn/v1")).unwrap();
    store.delete_key("openai").unwrap();
    store.set_key("openai", "sk-after-delete-1234567890").unwrap();
    assert_eq!(store.get_key_for_endpoint("openai", None).as_deref(), Some("sk-after-delete-1234567890"));
}

#[test]
fn test_endpoint_binding_survives_reopening_and_old_files_count_as_native() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("keys.enc");
    let store = KeyStore::at_path(path.clone());
    store.set_key_for_endpoint("glm", "sk-zai-key-1234567890", Some("https://api.z.ai/api/paas/v4")).unwrap();
    store.set_key("deepseek", "sk-deepseek-key-1234567890").unwrap();

    let reopened = KeyStore::at_path(path);
    assert_eq!(reopened.get_key_for_endpoint("glm", Some("https://api.z.ai/api/paas/v4")).as_deref(), Some("sk-zai-key-1234567890"));
    assert_eq!(reopened.get_key_for_endpoint("glm", None), None);
    // 没有绑定记录的 Key（旧版本写入）视为原生端点
    assert_eq!(reopened.get_key_for_endpoint("deepseek", None).as_deref(), Some("sk-deepseek-key-1234567890"));
    assert_eq!(reopened.get_key_for_endpoint("deepseek", Some("https://evil.example/v1")), None);
}

#[test]
fn test_resolve_api_key_never_sends_the_stored_key_to_another_endpoint() {
    use yachiyo_desktop_lib::gateway::resolve_api_key;
    use yachiyo_desktop_lib::types::ProviderId;

    let dir = tempfile::tempdir().unwrap();
    let store = KeyStore::at_path(dir.path().join("keys.enc"));
    store.set_key("openai", "sk-native-key-1234567890").unwrap();

    let stored_only = plain_request("openai", "");
    assert_eq!(resolve_api_key(&stored_only, ProviderId::Openai, &store).as_deref(), Some("sk-native-key-1234567890"));

    let redirected = custom_request("openai", "", "https://evil.example/v1");
    assert_eq!(resolve_api_key(&redirected, ProviderId::Openai, &store), None);

    // 请求自带的 Key 是调用方已知的，不受绑定限制
    let mut explicit = custom_request("openai", "", "https://api.moonshot.cn/v1");
    explicit.api_key = Some("sk-explicit-key-1234567890".to_string());
    assert_eq!(resolve_api_key(&explicit, ProviderId::Openai, &store).as_deref(), Some("sk-explicit-key-1234567890"));
}
