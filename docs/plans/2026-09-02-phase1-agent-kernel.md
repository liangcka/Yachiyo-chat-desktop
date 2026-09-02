# 阶段一：Agent 内核实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端 Rust 网关实现多步 Agent 循环（原生 function calling + 结构化工具协议 + 读写分级权限门 + 写前 checkpoint），前端以结构化事件渲染工具卡片与权限卡片。

**Architecture:** 循环住在 Rust 网关（方案 A）：一次 `POST /api/chat` 的 SSE 响应承载完整多轮运行；权限批准走独立 `POST /api/agent/approval`；取消靠 SSE 断流（Drop guard）。循环核心 `run_agent_loop` 通过 `TurnExecutor` trait 注入上游交互，真实实现为 `HttpTurnExecutor`，测试注入脚本化 executor。

**Tech Stack:** Rust（Tauri v2 / axum / reqwest / async-stream / tokio）+ React 19 / TypeScript。设计依据：[PHASE1\_AGENT\_KERNEL\_DESIGN.md](../PHASE1_AGENT_KERNEL_DESIGN.md)。

## Global Constraints

- 全程中文注释与提交说明；提交信息用约定式（feat/fix/refactor/test）。

- 严禁修改 `android/`、`capacitor.config.ts`。

- 云端 `functions/` 零改动（协议向后兼容：新 SSE 事件与请求字段全部可选）。

- 每个任务门禁：`cargo test --manifest-path src-tauri/Cargo.toml`（Rust 任务）或 `npm run test:unit -- --run`（前端任务）；T12 跑全量。

- 严禁 `any` 与无理由 `unwrap()`（Rust 测试代码中 `unwrap` 允许）。

- 移动端纯聊天路径行为不变（除移除 `max_characters` 截断 bug——设计文档 2.4 已批准）。

***

### Task 1: 协议类型与事件编码（Rust）

**Files:**

- Modify: `src-tauri/src/types.rs`

- Modify: `src-tauri/src/gateway/stream.rs`

- Test: `src-tauri/tests/gateway_tests.rs`

**Interfaces:**

- Produces（后续任务依赖的精确类型）:

  - `pub struct ToolInvocation { pub id: String, pub name: String, pub arguments: serde_json::Value }`

  - `pub struct AgentRequestConfig { pub enabled: bool, pub max_turns: Option<u32> }`

  - `ClientChatRequest.agent: Option<AgentRequestConfig>`（serde 名 `agent`，`maxTurns`）

  - `ClientHistoryMessage` 新字段：`tool_calls: Option<Vec<ToolInvocation>>`（serde 名 `toolCalls`）、`tool_call_id: Option<String>`（serde 名 `toolCallId`）、`tool_name: Option<String>`（serde 名 `toolName`）

  - `ClientStreamEvent` 新变体：`ToolCall { id, name, arguments }`、`ToolResult { id, name, output, is_error(serde名isError), duration_ms(serde名durationMs) }`、`PermissionRequest { request_id(requestId), tool_name(toolName), arguments }`、`PermissionResolved { request_id(requestId), approved }`、`Turn { index, usage: Option<TokenUsage> }`

  - `encode_client_event` 对上述变体的 SSE 编码

- [ ] **Step 1: 写失败测试**

在 `src-tauri/tests/gateway_tests.rs` 末尾追加：

```rust
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_agent`
Expected: 编译失败（`ToolCall` 等变体不存在）

- [ ] **Step 3: 实现**

`src-tauri/src/types.rs`：`ClientHistoryMessage` 之后新增：

```rust
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
}
```

`ClientHistoryMessage` 改为：

```rust
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
```

`ClientChatRequest` 在 `current_time` 字段后加：

```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub agent: Option<AgentRequestConfig>,
```

`ClientStreamEvent` 枚举在 `Error` 变体后追加：

```rust
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
```

`src-tauri/src/gateway/stream.rs` 的 `encode_client_event` 匹配分支追加：

```rust
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过（含既有用例）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/types.rs src-tauri/src/gateway/stream.rs src-tauri/tests/gateway_tests.rs
git commit -m "feat(agent): 扩展客户端协议类型与 Agent 模式 SSE 事件编码"
```

***

### Task 2: 工具风险分级与输出截断（Rust）

**Files:**

- Modify: `src-tauri/src/tools/mod.rs`

- Modify: `src-tauri/src/tools/fs.rs`

- Test: `src-tauri/tests/tool_tests.rs`

**Interfaces:**

- Produces:

  - `pub enum ToolRisk { Read, Write }`（`tools` 模块）

  - `pub fn tool_risk(name: &str) -> Option<ToolRisk>`：read\_file/list\_directory/git\_status/git\_diff/web\_fetch → Read；write\_file/run\_command → Write；未知 → None

  - `pub fn truncate_tool_output(name: &str, output: &str) -> String`（按工具上限截断并附中文注明）

  - `pub fn preview_tool_output(output: &str) -> String`（2KB UI 预览截断）

  - `pub fn resolve_in_workspace(path_str: &str, workspace_root: &Path) -> Result<PathBuf, String>`（fs.rs 提取的公共路径解析）

- [ ] **Step 1: 写失败测试**

`src-tauri/tests/tool_tests.rs` 末尾追加：

```rust
use yachiyo_desktop_lib::tools::{preview_tool_output, tool_risk, truncate_tool_output, ToolRisk};

#[test]
fn test_tool_risk_classification() {
    assert_eq!(tool_risk("read_file"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("list_directory"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("git_status"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("git_diff"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("web_fetch"), Some(ToolRisk::Read));
    assert_eq!(tool_risk("write_file"), Some(ToolRisk::Write));
    assert_eq!(tool_risk("run_command"), Some(ToolRisk::Write));
    assert_eq!(tool_risk("unknown_tool"), None);
}

#[test]
fn test_truncate_tool_output() {
    let small = "hello";
    assert_eq!(truncate_tool_output("read_file", small), "hello");

    let big = "x".repeat(70 * 1024);
    let truncated = truncate_tool_output("read_file", &big);
    assert!(truncated.len() < big.len());
    assert!(truncated.contains("输出已截断"));

    // 多字节字符不产生 panic 且截断在字符边界
    let cjk = "八".repeat(40 * 1024);
    let truncated_cjk = truncate_tool_output("read_file", &cjk);
    let _ = truncated_cjk.chars().count();
}

#[test]
fn test_preview_tool_output() {
    let short = "abc".to_string();
    assert_eq!(preview_tool_output(&short), "abc");
    let long = "y".repeat(3000);
    let preview = preview_tool_output(&long);
    assert!(preview.len() <= 2 * 1024 + 64);
    assert!(preview.contains("…"));
}

#[test]
fn test_resolve_in_workspace() {
    use yachiyo_desktop_lib::tools::fs::resolve_in_workspace;
    let root = std::env::temp_dir();
    let resolved = resolve_in_workspace("sub/a.txt", &root).expect("relative path resolves");
    assert!(resolved.starts_with(&root));
    assert!(resolved.ends_with("sub\\a.txt") || resolved.ends_with("sub/a.txt"));
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml tool_risk`
Expected: 编译失败（`tool_risk` 不存在）

- [ ] **Step 3: 实现**

`src-tauri/src/tools/fs.rs` 顶部新增（并让 `read_file`/`write_file`/`list_directory` 复用它替换各自的内联解析，行为不变）：

```rust
/// 相对路径基于工作区根解析、绝对路径原样保留；不含越界校验（由调用方决定）
pub fn resolve_in_workspace(path_str: &str, workspace_root: &Path) -> Result<PathBuf, String> {
    let target = PathBuf::from(path_str);
    Ok(if target.is_relative() {
        workspace_root.join(target)
    } else {
        target
    })
}
```

`src-tauri/src/tools/mod.rs` 顶部 use 区后新增：

```rust
/// 工具风险分级：读类自动放行，写类需用户批准
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRisk {
    Read,
    Write,
}

pub fn tool_risk(name: &str) -> Option<ToolRisk> {
    match name {
        "read_file" | "list_directory" | "git_status" | "git_diff" | "web_fetch" => Some(ToolRisk::Read),
        "write_file" | "run_command" => Some(ToolRisk::Write),
        _ => None,
    }
}

/// 回填模型前的工具输出上限（字节）
fn tool_output_limit(name: &str) -> usize {
    match name {
        "read_file" => 64 * 1024,
        "run_command" => 16 * 1024,
        "web_fetch" => 32 * 1024,
        _ => 16 * 1024,
    }
}

/// 截断到字符边界的安全切片（不产生 panic）
fn floor_char_boundary(s: &str, mut index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    while index > 0 && !s.is_char_boundary(index) {
        index -= 1;
    }
    index
}

pub fn truncate_tool_output(name: &str, output: &str) -> String {
    let limit = tool_output_limit(name);
    if output.len() <= limit {
        return output.to_string();
    }
    let cut = floor_char_boundary(output, limit);
    format!(
        "{}\n[输出已截断：原始 {} 字节，截断至 {} 字节]",
        &output[..cut],
        output.len(),
        cut
    )
}

/// 下发给前端 ToolCard 的 2KB 预览
pub fn preview_tool_output(output: &str) -> String {
    const PREVIEW_LIMIT: usize = 2 * 1024;
    if output.len() <= PREVIEW_LIMIT {
        return output.to_string();
    }
    let cut = floor_char_boundary(output, PREVIEW_LIMIT);
    format!("{}…", &output[..cut])
}
```

同时把 `fs.rs` 的 `read_file`/`write_file` 中路径解析行替换为 `let resolved = resolve_in_workspace(path_str, workspace_root)?;`（`list_directory` 的非根分支同理）。

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/tools/mod.rs src-tauri/src/tools/fs.rs src-tauri/tests/tool_tests.rs
git commit -m "feat(agent): 工具风险分级、输出截断与工作区路径解析复用"
```

***

### Task 3: AgentMessage 模型 + OpenAI 系请求构建与流解析（Rust）

**Files:**

- Create: `src-tauri/src/gateway/agent/mod.rs`、`src-tauri/src/gateway/agent/messages.rs`、`src-tauri/src/gateway/agent/stream_agg.rs`（`checkpoint.rs`/`permission.rs`/`runtime.rs` 建空文件占位，后续任务填充）

- Modify: `src-tauri/src/types.rs`（ExtractedDelta）、`src-tauri/src/gateway/providers/openai_compat.rs`、`src-tauri/src/gateway/mod.rs`（加 `pub mod agent;`）

- Test: `src-tauri/tests/agent_tests.rs`（新建）

**Interfaces:**

- Consumes: Task 1 的 `ToolInvocation`

- Produces:

  - `pub enum AgentMessage { User { text: String, image_data_url: Option<String> }, Assistant { text: String, tool_calls: Vec<ToolInvocation> }, ToolResult { tool_call_id: String, name: String, content: String } }`（agent/messages.rs）

  - `pub fn history_to_agent_messages(history: &[ClientHistoryMessage]) -> Vec<AgentMessage>`

  - `pub struct ToolCallAggregator` + `push(&mut self, delta: &ToolCallStreamDelta)` + `finish(self) -> Vec<ToolInvocation>`（stream\_agg.rs）

  - `pub enum ToolCallStreamDelta { Openai { index, id: Option<String>, name: Option<String>, arguments_fragment: Option<String> }, AnthropicStart { index, block_id: String, name: String }, AnthropicArgs { index, partial_json: String }, AnthropicStop { index }, Gemini { call: ToolInvocation } }`（types.rs）

  - `ExtractedDelta` 新增字段 `pub tool_calls: Vec<ToolCallStreamDelta>`

  - `pub fn build_openai_agent_body(model: &str, messages: &[AgentMessage], system_prompt: &str, tools: &[serde_json::Value]) -> serde_json::Value`

- [ ] **Step 1: 写失败测试**

新建 `src-tauri/tests/agent_tests.rs`：

```rust
use yachiyo_desktop_lib::gateway::agent::messages::{history_to_agent_messages, AgentMessage};
use yachiyo_desktop_lib::gateway::agent::stream_agg::ToolCallAggregator;
use yachiyo_desktop_lib::gateway::providers::openai_compat::build_openai_agent_body;
use yachiyo_desktop_lib::gateway::stream::extract_openai_delta;
use yachiyo_desktop_lib::types::{ClientHistoryMessage, ToolInvocation};

#[test]
fn test_history_to_agent_messages() {
    let history = vec![
        ClientHistoryMessage {
            role: "user".to_string(),
            text: "看下项目".to_string(),
            image_data_url: None,
            tool_calls: None,
            tool_call_id: None,
            tool_name: None,
        },
        ClientHistoryMessage {
            role: "assistant".to_string(),
            text: "我先列目录".to_string(),
            image_data_url: None,
            tool_calls: Some(vec![ToolInvocation {
                id: "call-1".to_string(),
                name: "list_directory".to_string(),
                arguments: serde_json::json!({"path": "."}),
            }]),
            tool_call_id: None,
            tool_name: None,
        },
        ClientHistoryMessage {
            role: "tool".to_string(),
            text: "src/".to_string(),
            image_data_url: None,
            tool_calls: None,
            tool_call_id: Some("call-1".to_string()),
            tool_name: Some("list_directory".to_string()),
        },
    ];
    let agent_msgs = history_to_agent_messages(&history);
    assert_eq!(agent_msgs.len(), 3);
    assert!(matches!(&agent_msgs[0], AgentMessage::User { text, .. } if text == "看下项目"));
    match &agent_msgs[1] {
        AgentMessage::Assistant { text, tool_calls } => {
            assert_eq!(text, "我先列目录");
            assert_eq!(tool_calls.len(), 1);
            assert_eq!(tool_calls[0].name, "list_directory");
        }
        _ => panic!("expected Assistant"),
    }
    assert!(matches!(&agent_msgs[2], AgentMessage::ToolResult { tool_call_id, name, content }
        if tool_call_id == "call-1" && name == "list_directory" && content == "src/"));
}

#[test]
fn test_openai_agent_body_structure() {
    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: "好的".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "call-1".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({"path": "a.rs"}),
            }],
        },
        AgentMessage::ToolResult {
            tool_call_id: "call-1".to_string(),
            name: "read_file".to_string(),
            content: "fn main() {}".to_string(),
        },
    ];
    let tools = vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })];
    let body = build_openai_agent_body("test-model", &messages, "系统提示", &tools);
    assert_eq!(body["model"], "test-model");
    assert_eq!(body["tool_choice"], "auto");
    assert_eq!(body["tools"].as_array().unwrap().len(), 1);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs[0]["role"], "system");
    assert_eq!(msgs[1]["role"], "user");
    assert_eq!(msgs[2]["role"], "assistant");
    assert_eq!(msgs[2]["tool_calls"][0]["function"]["name"], "read_file");
    assert_eq!(msgs[2]["tool_calls"][0]["function"]["arguments"], "{\"path\":\"a.rs\"}");
    assert_eq!(msgs[3]["role"], "tool");
    assert_eq!(msgs[3]["tool_call_id"], "call-1");
}

#[test]
fn test_openai_tool_call_delta_extraction_and_aggregation() {
    let chunk1 = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"write_file","arguments":""}}]}}]}"#;
    let delta1 = extract_openai_delta(chunk1).expect("should parse tool delta");
    assert_eq!(delta1.tool_calls.len(), 1);

    let chunk2 = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]}}]}"#;
    let delta2 = extract_openai_delta(chunk2).expect("should parse args fragment");

    let chunk3 = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.rs\",\"content\":\"hi\"}"}}]}}]}"#;
    let delta3 = extract_openai_delta(chunk3).expect("should parse args tail");

    let mut agg = ToolCallAggregator::new();
    agg.push(&delta1.tool_calls[0]);
    agg.push(&delta2.tool_calls[0]);
    agg.push(&delta3.tool_calls[0]);
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call-1");
    assert_eq!(calls[0].name, "write_file");
    assert_eq!(calls[0]["arguments"]["path"], "a.rs");
}

#[test]
fn test_aggregator_assigns_id_for_gemini_calls() {
    use yachiyo_desktop_lib::types::ToolCallStreamDelta;
    let mut agg = ToolCallAggregator::new();
    agg.push(&ToolCallStreamDelta::Gemini {
        call: ToolInvocation {
            id: String::new(),
            name: "read_file".to_string(),
            arguments: serde_json::json!({"path": "x"}),
        },
    });
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert!(!calls[0].id.is_empty());
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_history_to_agent`
Expected: 编译失败（模块不存在）

- [ ] **Step 3: 实现**

新建 `src-tauri/src/gateway/agent/mod.rs`：

```rust
pub mod checkpoint;
pub mod messages;
pub mod permission;
pub mod runtime;
pub mod stream_agg;
```

（`checkpoint.rs`/`permission.rs`/`runtime.rs` 先建空文件，后续任务填充。）

新建 `src-tauri/src/gateway/agent/messages.rs`：

```rust
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
        tool_calls: Vec<ToolInvocation>,
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
                tool_calls: msg.tool_calls.clone().unwrap_or_default(),
            },
            _ => AgentMessage::User {
                text: msg.text.clone(),
                image_data_url: msg.image_data_url.clone(),
            },
        })
        .collect()
}
```

新建 `src-tauri/src/gateway/agent/stream_agg.rs`：

```rust
use crate::types::{ToolCallStreamDelta, ToolInvocation};

struct AggSlot {
    id: String,
    name: String,
    arguments: String,
}

/// 流式工具调用增量聚合器：跨 SSE chunk 按 index 拼接 id/name/arguments
#[derive(Default)]
pub struct ToolCallAggregator {
    slots: Vec<AggSlot>,
    next_synthetic_id: u32,
}

impl ToolCallAggregator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, delta: &ToolCallStreamDelta) {
        match delta {
            ToolCallStreamDelta::Openai { index, id, name, arguments_fragment } => {
                let slot = self.slot_at(*index);
                if let Some(id) = id {
                    if !id.is_empty() {
                        slot.id = id.clone();
                    }
                }
                if let Some(name) = name {
                    if !name.is_empty() {
                        slot.name = name.clone();
                    }
                }
                if let Some(fragment) = arguments_fragment {
                    slot.arguments.push_str(fragment);
                }
            }
            ToolCallStreamDelta::AnthropicStart { index, block_id, name } => {
                let slot = self.slot_at(*index);
                slot.id = block_id.clone();
                slot.name = name.clone();
            }
            ToolCallStreamDelta::AnthropicArgs { index, partial_json } => {
                self.slot_at(*index).arguments.push_str(partial_json);
            }
            ToolCallStreamDelta::AnthropicStop { .. } => {}
            ToolCallStreamDelta::Gemini { call } => {
                // Gemini functionCall 完整出现；provider 不返回 id，由聚合器分配
                let synthetic_id = format!("call-gemini-{}", self.next_synthetic_id);
                self.next_synthetic_id += 1;
                self.slots.push(AggSlot {
                    id: if call.id.is_empty() { synthetic_id } else { call.id.clone() },
                    name: call.name.clone(),
                    arguments: call.arguments.to_string(),
                });
            }
        }
    }

    fn slot_at(&mut self, index: usize) -> &mut AggSlot {
        while self.slots.len() <= index {
            self.slots.push(AggSlot {
                id: format!("call-{}", self.slots.len()),
                name: String::new(),
                arguments: String::new(),
            });
        }
        &mut self.slots[index]
    }

    /// 收尾：解析累积的 arguments JSON（失败回退空对象），保持插入顺序
    pub fn finish(self) -> Vec<ToolInvocation> {
        self.slots
            .into_iter()
            .filter(|slot| !slot.name.is_empty())
            .map(|slot| ToolInvocation {
                id: slot.id,
                name: slot.name,
                arguments: serde_json::from_str(&slot.arguments).unwrap_or(serde_json::json!({})),
            })
            .collect()
    }
}
```

`src-tauri/src/types.rs`：`ExtractedDelta` 前加流式 delta 枚举并扩展结构体：

```rust
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
```

`src-tauri/src/gateway/stream.rs` 的 `extract_openai_delta`：在 `delta_obj` 处理块内追加，末尾判空条件改为 `delta.content.is_none() && delta.thought.is_none() && delta.usage.is_none() && delta.tool_calls.is_empty()`：

```rust
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
```

`src-tauri/src/gateway/providers/openai_compat.rs` 追加（use 区补 `crate::gateway::agent::messages::AgentMessage`）：

```rust
/// Agent 模式请求体：messages 含 assistant tool_calls 与 role:"tool" 结果回填
pub fn build_openai_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let mut out = vec![json!({ "role": "system", "content": system_prompt })];
    for msg in messages {
        match msg {
            AgentMessage::User { text, image_data_url } => {
                if let Some(url) = image_data_url {
                    out.push(json!({
                        "role": "user",
                        "content": [
                            { "type": "text", "text": text },
                            { "type": "image_url", "image_url": { "url": url } }
                        ]
                    }));
                } else {
                    out.push(json!({ "role": "user", "content": text }));
                }
            }
            AgentMessage::Assistant { text, tool_calls } => {
                if tool_calls.is_empty() {
                    if !text.is_empty() {
                        out.push(json!({ "role": "assistant", "content": text }));
                    }
                    continue;
                }
                let calls: Vec<serde_json::Value> = tool_calls
                    .iter()
                    .map(|c| {
                        json!({
                            "id": c.id,
                            "type": "function",
                            "function": { "name": c.name, "arguments": c.arguments.to_string() }
                        })
                    })
                    .collect();
                out.push(json!({
                    "role": "assistant",
                    "content": if text.is_empty() { serde_json::Value::Null } else { json!(text) },
                    "tool_calls": calls
                }));
            }
            AgentMessage::ToolResult { tool_call_id, content, .. } => {
                out.push(json!({ "role": "tool", "tool_call_id": tool_call_id, "content": content }));
            }
        }
    }
    json!({
        "model": model,
        "messages": out,
        "tools": tools,
        "tool_choice": "auto",
        "stream": true,
        "stream_options": { "include_usage": true }
    })
}
```

`src-tauri/src/gateway/mod.rs` 模块声明区加 `pub mod agent;`。

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/gateway/agent/ src-tauri/src/gateway/mod.rs src-tauri/src/types.rs src-tauri/src/gateway/stream.rs src-tauri/src/gateway/providers/openai_compat.rs src-tauri/tests/agent_tests.rs
git commit -m "feat(agent): AgentMessage 统一模型与 OpenAI 系原生工具调用构建解析"
```

***

### Task 4: Anthropic Agent 适配（Rust）

**Files:**

- Modify: `src-tauri/src/gateway/providers/anthropic.rs`

- Test: `src-tauri/tests/agent_tests.rs`

**Interfaces:**

- Consumes: Task 3 的 `AgentMessage`、`ToolCallStreamDelta`、`ToolCallAggregator`

- Produces:

  - `pub fn build_anthropic_agent_body(model: &str, messages: &[AgentMessage], system_prompt: &str, tools: &[serde_json::Value]) -> serde_json::Value`

  - `extract_anthropic_delta` 对 `content_block_start`(tool\_use) / `input_json_delta` / `content_block_stop` 的解析

- [ ] **Step 1: 写失败测试**

`agent_tests.rs` 追加：

```rust
#[test]
fn test_anthropic_agent_body_structure() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::build_anthropic_agent_body;

    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: "好的".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "toolu_1".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({"path": "a.rs"}),
            }],
        },
        AgentMessage::ToolResult {
            tool_call_id: "toolu_1".to_string(),
            name: "read_file".to_string(),
            content: "fn main() {}".to_string(),
        },
    ];
    let tools = vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })];
    let body = build_anthropic_agent_body("claude-sonnet-5", &messages, "系统提示", &tools);

    assert_eq!(body["model"], "claude-sonnet-5");
    assert_eq!(body["system"], "系统提示");
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[1]["role"], "assistant");
    assert_eq!(msgs[1]["content"][1]["type"], "tool_use");
    assert_eq!(msgs[1]["content"][1]["id"], "toolu_1");
    assert_eq!(msgs[1]["content"][1]["input"]["path"], "a.rs");
    assert_eq!(msgs[2]["role"], "user");
    assert_eq!(msgs[2]["content"][0]["type"], "tool_result");
    assert_eq!(msgs[2]["content"][0]["tool_use_id"], "toolu_1");
    assert_eq!(body["tools"][0]["name"], "read_file");
    assert!(body["tools"][0].get("input_schema").is_some());
}

#[test]
fn test_anthropic_tool_use_stream_extraction() {
    use yachiyo_desktop_lib::gateway::providers::anthropic::extract_anthropic_delta;

    let start = r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file"}}"#;
    let args1 = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"a"}}"#;
    let args2 = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":".rs\"}"}}"#;
    let stop = r#"{"type":"content_block_stop","index":1}"#;

    let mut agg = ToolCallAggregator::new();
    for chunk in [start, args1, args2, stop] {
        if let Some(delta) = extract_anthropic_delta(chunk) {
            for tc in &delta.tool_calls {
                agg.push(tc);
            }
        }
    }
    let calls = agg.finish();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "toolu_1");
    assert_eq!(calls[0].name, "write_file");
    assert_eq!(calls[0]["arguments"]["path"], "a.rs");
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_anthropic_agent`
Expected: 编译失败

- [ ] **Step 3: 实现**

`anthropic.rs` 追加（use 区补 `crate::gateway::agent::messages::AgentMessage`）：

```rust
/// Agent 模式请求体：tool_use 块 + tool_result 回填（user 角色内嵌）
pub fn build_anthropic_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let anthropic_tools: Vec<serde_json::Value> = tools
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
                mapped.push(json!({ "role": "user", "content": blocks }));
            }
            AgentMessage::Assistant { text, tool_calls } => {
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

    json!({
        "model": model,
        "max_tokens": 8192,
        "system": system_prompt,
        "messages": mapped,
        "tools": anthropic_tools,
        "stream": true
    })
}
```

`extract_anthropic_delta` 的 match 增加两个事件分支与 `input_json_delta` 处理：

```rust
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
```

`"content_block_delta"` 分支内追加：

```rust
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/gateway/providers/anthropic.rs src-tauri/tests/agent_tests.rs
git commit -m "feat(agent): Anthropic 原生工具调用请求构建与流式解析"
```

***

### Task 5: Gemini Agent 适配（Rust）

**Files:**

- Modify: `src-tauri/src/gateway/providers/gemini.rs`

- Test: `src-tauri/tests/agent_tests.rs`

**Interfaces:**

- Consumes: Task 3 的 `AgentMessage`、`ToolCallStreamDelta::Gemini`

- Produces:

  - `pub fn build_gemini_agent_body(model: &str, messages: &[AgentMessage], system_prompt: &str, tools: &[serde_json::Value]) -> serde_json::Value`

  - `extract_gemini_delta` 对 `parts[].functionCall` 的解析

- [ ] **Step 1: 写失败测试**

`agent_tests.rs` 追加：

```rust
#[test]
fn test_gemini_agent_body_structure() {
    use yachiyo_desktop_lib::gateway::providers::gemini::build_gemini_agent_body;

    let messages = vec![
        AgentMessage::User { text: "读 a.rs".to_string(), image_data_url: None },
        AgentMessage::Assistant {
            text: "好的".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "call-gemini-0".to_string(),
                name: "read_file".to_string(),
                arguments: serde_json::json!({"path": "a.rs"}),
            }],
        },
        AgentMessage::ToolResult {
            tool_call_id: "call-gemini-0".to_string(),
            name: "read_file".to_string(),
            content: "fn main() {}".to_string(),
        },
    ];
    let tools = vec![serde_json::json!({
        "type": "function",
        "function": {"name": "read_file", "description": "read", "parameters": {"type": "object", "properties": {}}}
    })];
    let body = build_gemini_agent_body("gemini-3.7-flash", &messages, "系统提示", &tools);

    assert_eq!(body["systemInstruction"]["parts"][0]["text"], "系统提示");
    let contents = body["contents"].as_array().unwrap();
    assert_eq!(contents[0]["role"], "user");
    assert_eq!(contents[1]["role"], "model");
    assert_eq!(contents[1]["parts"][1]["functionCall"]["name"], "read_file");
    assert_eq!(contents[1]["parts"][1]["functionCall"]["args"]["path"], "a.rs");
    assert_eq!(contents[2]["role"], "user");
    assert_eq!(contents[2]["parts"][0]["functionResponse"]["name"], "read_file");
    assert_eq!(
        contents[2]["parts"][0]["functionResponse"]["response"]["result"],
        "fn main() {}"
    );
    assert_eq!(body["tools"][0]["functionDeclarations"][0]["name"], "read_file");
}

#[test]
fn test_gemini_function_call_extraction() {
    use yachiyo_desktop_lib::gateway::providers::gemini::extract_gemini_delta;

    let chunk = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_directory","args":{"path":"."}}}]}}]}"#;
    let delta = extract_gemini_delta(chunk).expect("should parse functionCall");
    assert_eq!(delta.tool_calls.len(), 1);
    match &delta.tool_calls[0] {
        yachiyo_desktop_lib::types::ToolCallStreamDelta::Gemini { call } => {
            assert_eq!(call.name, "list_directory");
            assert_eq!(call.arguments["path"], ".");
        }
        _ => panic!("expected Gemini delta"),
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_gemini_agent`
Expected: 编译失败

- [ ] **Step 3: 实现**

`gemini.rs` 追加（use 区补 `crate::gateway::agent::messages::AgentMessage`）：

```rust
/// Agent 模式请求体：functionDeclarations + functionCall/functionResponse parts
pub fn build_gemini_agent_body(
    model: &str,
    messages: &[AgentMessage],
    system_prompt: &str,
    tools: &[serde_json::Value],
) -> serde_json::Value {
    let declarations: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            let function = &t["function"];
            json!({
                "name": function["name"],
                "description": function["description"],
                "parameters": function["parameters"],
            })
        })
        .collect();

    let mut contents: Vec<serde_json::Value> = Vec::new();
    for msg in messages {
        match msg {
            AgentMessage::User { text, image_data_url } => {
                let mut parts = vec![json!({ "text": text })];
                if let Some(url) = image_data_url {
                    if let Some((mime_type, base64_data)) = parse_image_data_url(url) {
                        parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": base64_data } }));
                    }
                }
                contents.push(json!({ "role": "user", "parts": parts }));
            }
            AgentMessage::Assistant { text, tool_calls } => {
                let mut parts: Vec<serde_json::Value> = Vec::new();
                if !text.is_empty() {
                    parts.push(json!({ "text": text }));
                }
                for call in tool_calls {
                    parts.push(json!({ "functionCall": { "name": call.name, "args": call.arguments } }));
                }
                if !parts.is_empty() {
                    contents.push(json!({ "role": "model", "parts": parts }));
                }
            }
            AgentMessage::ToolResult { name, content, .. } => {
                contents.push(json!({
                    "role": "user",
                    "parts": [{ "functionResponse": { "name": name, "response": { "result": content } } }]
                }));
            }
        }
    }

    json!({
        "contents": contents,
        "systemInstruction": { "parts": [{ "text": system_prompt }] },
        "tools": [{ "functionDeclarations": declarations }],
        "generationConfig": { "thinkingConfig": { "thinkingLevel": "low" } },
        "model": model
    })
}
```

`extract_gemini_delta` 的 parts 循环内追加（与 `part.get("text")` 同级）：

```rust
if let Some(function_call) = part.get("functionCall") {
    let name = function_call.get("name").and_then(|v| v.as_str()).unwrap_or_default();
    if !name.is_empty() {
        let args = function_call.get("args").cloned().unwrap_or(serde_json::json!({}));
        delta.tool_calls.push(crate::types::ToolCallStreamDelta::Gemini {
            call: crate::types::ToolInvocation {
                // Gemini 不返回调用 id，由聚合器分配
                id: String::new(),
                name: name.to_string(),
                arguments: args,
            },
        });
    }
}
```

末尾判空条件加 `&& delta.tool_calls.is_empty()`。

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/gateway/providers/gemini.rs src-tauri/tests/agent_tests.rs
git commit -m "feat(agent): Gemini 原生函数调用请求构建与解析"
```

***

### Task 6: Agent 系统提示词（Rust）

**Files:**

- Modify: `src-tauri/src/gateway/prompt.rs`

- Test: `src-tauri/tests/gateway_tests.rs`

**Interfaces:**

- Produces: `pub fn build_agent_system_prompt(locale: ChatLocale, current_time: Option<&str>) -> String`

- 行为变更：`build_system_prompt` 不再注入 `DESKTOP_TOOLS_INSTRUCTION_*`（文本协议指令整体删除，纯聊天不提供工具能力）

- [ ] **Step 1: 写失败测试**

`gateway_tests.rs` 追加：

````rust
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
````

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_agent_system`
Expected: 编译失败

- [ ] **Step 3: 实现**

`prompt.rs`：删除 `DESKTOP_TOOLS_INSTRUCTION_ZH` 与 `DESKTOP_TOOLS_INSTRUCTION_JA` 两个常量；新增：

```rust
const AGENT_TOOLS_INSTRUCTION_ZH: &str = "\n【桌面 Agent 干活模式】\n你正以 Agent 模式运行，拥有以下原生工具：read_file（读文件）、write_file（写文件，需彩叶批准）、list_directory（列目录）、run_command（执行终端命令，需彩叶批准）、git_status / git_diff（查看仓库状态）、web_fetch（抓取网页）。\n使用准则：\n- 接到编码、文件、终端类任务时主动组合工具完成，不要只给建议；\n- 修改文件前先读取目标确认现状，写前说明你的意图；\n- 执行命令后检查输出，出错就修复并重试；\n- 任务完成后用简洁的总结收尾（做了什么、改了哪些文件、结果如何）；\n- 依然保持月见八千代的语气与口吻，但技术内容要准确专业，输出长度按任务需要决定。\n";

const AGENT_TOOLS_INSTRUCTION_JA: &str = "\n【デスクトップAgentモード】\nAgentモードで動作しており、ネイティブツール（read_file、write_file、list_directory、run_command、git_status、git_diff、web_fetch）を利用できます。write_file と run_command は彩葉の承認が必要です。\n方針：\n- コーディングやファイル・ターミナル作業はツールを組み合わせて自ら完遂すること。\n- ファイル変更前に対象を読み、意図を説明してから書くこと。\n- コマンド実行後は出力を確認し、失敗したら修正して再試行すること。\n- 完了後は簡潔にまとめること。技術内容は正確に、長さは作業に応じて。\n";

const AGENT_OUTPUT_RULE_ZH: &str = "平台安全、隐私与紧急风险规则始终优先。本模式为编码/执行任务模式，输出长度按任务需要决定，不做人为压缩；保留括号动作描写。";
const AGENT_OUTPUT_RULE_JA: &str = "プラットフォームの安全・プライバシー・緊急リスク規則を常に優先。このモードは作業実行モードのため、出力の長さはタスクに応じて決め、人為的な圧縮はしない。";

/// Agent 模式系统提示词：角色人设 + 工具规范 + 放宽的输出限制
pub fn build_agent_system_prompt(locale: ChatLocale, current_time: Option<&str>) -> String {
    let (locale_suffix, tools_instruction) = match locale {
        ChatLocale::JaJp => (LOCALE_SUFFIX_JA, AGENT_TOOLS_INSTRUCTION_JA),
        ChatLocale::ZhCn => (LOCALE_SUFFIX_ZH, AGENT_TOOLS_INSTRUCTION_ZH),
    };
    let output_rule = match locale {
        ChatLocale::JaJp => AGENT_OUTPUT_RULE_JA,
        ChatLocale::ZhCn => AGENT_OUTPUT_RULE_ZH,
    };
    let time_rule = build_time_instruction(locale, current_time);
    format!(
        "{}\n\n<runtime>\n始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。\n{}\n{}\n{}\n{}\n</runtime>",
        ROLE_PROMPT.trim(),
        locale_suffix,
        tools_instruction,
        time_rule,
        output_rule,
    )
}
```

`build_system_prompt` 中删除 `tools_instruction` 的选取与 `format!` 中对应占位（纯聊天不再注入桌面工具指令），其余保留。

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过（含既有 `test_build_system_prompt`——其断言不涉及 tools 指令，无需改动）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/gateway/prompt.rs src-tauri/tests/gateway_tests.rs
git commit -m "feat(agent): Agent 模式系统提示词，移除文本协议指令"
```

***

### Task 7: PermissionGate 与批准路由（Rust）

**Files:**

- Modify: `src-tauri/src/gateway/agent/permission.rs`

- Modify: `src-tauri/src/server/http.rs`

- Test: `src-tauri/tests/agent_tests.rs`

**Interfaces:**

- Produces:

  - `pub struct ApprovalDecision { pub approved: bool, pub session_scope: bool }`

  - `pub struct ApprovalRegistry`（`new()` / `register(&self, request_id: &str) -> oneshot::Receiver<ApprovalDecision>` / `resolve(&self, request_id: &str, decision: ApprovalDecision) -> bool` / `cancel(&self, request_id: &str)`）

  - `AppState.approvals: Arc<ApprovalRegistry>`；路由 `POST /api/agent/approval`

- [ ] **Step 1: 写失败测试**

`agent_tests.rs` 追加：

```rust
#[tokio::test]
async fn test_approval_registry_flow() {
    use yachiyo_desktop_lib::gateway::agent::permission::{ApprovalDecision, ApprovalRegistry};

    let registry = ApprovalRegistry::new();
    let mut rx = registry.register("req-1");
    assert!(registry.resolve(
        "req-1",
        ApprovalDecision { approved: true, session_scope: false }
    ));
    let decision = rx.await.expect("should receive decision");
    assert!(decision.approved);
    assert!(!registry.resolve("req-1", ApprovalDecision { approved: false, session_scope: false }));
    assert!(!registry.resolve("req-404", ApprovalDecision { approved: true, session_scope: false }));
}

#[tokio::test]
async fn test_approval_registry_cancel() {
    use yachiyo_desktop_lib::gateway::agent::permission::ApprovalRegistry;

    let registry = ApprovalRegistry::new();
    let mut rx = registry.register("req-2");
    registry.cancel("req-2");
    assert!(rx.await.is_err(), "cancelled receiver should error");
}
```

`src-tauri/Cargo.toml` 确认 `[dev-dependencies]` 有 `tokio = { version = "1", features = ["full"] }`（主依赖已是 full，无 dev 冲突则可省略）。

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_approval_registry`
Expected: 编译失败

- [ ] **Step 3: 实现**

`src-tauri/src/gateway/agent/permission.rs`：

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy)]
pub struct ApprovalDecision {
    pub approved: bool,
    /// true 时把该工具记入本次运行的会话级放行集（不再询问）
    pub session_scope: bool,
}

/// 全局批准注册表：SSE 流内发起 permission_request，POST /api/agent/approval 回填决定
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, request_id: &str) -> oneshot::Receiver<ApprovalDecision> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(request_id.to_string(), tx);
        rx
    }

    /// 送达决定；返回 false 表示 requestId 未知或已被消费（超时/取消）
    pub fn resolve(&self, request_id: &str, decision: ApprovalDecision) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn cancel(&self, request_id: &str) {
        self.pending.lock().unwrap().remove(request_id);
    }
}
```

`src-tauri/src/server/http.rs`：

- `AppState` 加字段 `pub approvals: Arc<crate::gateway::agent::permission::ApprovalRegistry>`

- 新增 handler（`create_router` 里加 `.route("/api/agent/approval", post(handle_agent_approval))`）：

```rust
#[derive(Debug, Deserialize)]
pub struct AgentApprovalRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub approved: bool,
    #[serde(rename = "sessionScope", default)]
    pub session_scope: bool,
}

async fn handle_agent_approval(
    State(state): State<AppState>,
    Json(payload): Json<AgentApprovalRequest>,
) -> impl IntoResponse {
    let decision = crate::gateway::agent::permission::ApprovalDecision {
        approved: payload.approved,
        session_scope: payload.session_scope,
    };
    if state.approvals.resolve(&payload.request_id, decision) {
        (StatusCode::OK, Json(serde_json::json!({ "success": true })))
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Unknown or expired requestId" })),
        )
    }
}
```

- `start_local_server` 构造 `AppState` 处加 `approvals: Arc::new(crate::gateway::agent::permission::ApprovalRegistry::new())`

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/gateway/agent/permission.rs src-tauri/src/server/http.rs src-tauri/tests/agent_tests.rs
git commit -m "feat(agent): 权限批准注册表与 /api/agent/approval 路由"
```

***

### Task 8: CheckpointStore（Rust）

**Files:**

- Modify: `src-tauri/src/gateway/agent/checkpoint.rs`

- Modify: `src-tauri/Cargo.toml`（dev-dependencies 加 `tempfile = "3"`）

- Test: `src-tauri/tests/agent_tests.rs`

**Interfaces:**

- Produces:

  - `pub struct CheckpointStore`：`new(workspace_root: &Path, run_id: &str)` / `run_id(&self) -> &str` / `backup_before_write(&mut self, path_str: &str) -> Result<bool, String>` / `rollback_all(&self) -> Result<usize, String>` / `entries(&self) -> &[CheckpointManifestEntry]` / `ensure_gitignore(&self) -> Result<(), String>`

  - `pub struct CheckpointManifestEntry { pub sequence: u32, pub original: String, pub backup: String }`

- [ ] **Step 1: 写失败测试**

`agent_tests.rs` 追加：

```rust
#[test]
fn test_checkpoint_backup_and_rollback() {
    use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    let original = "原内容 v1";
    std::fs::write(root.join("a.txt"), original).unwrap();

    let mut store = CheckpointStore::new(root, "run-test-1");
    assert!(store.backup_before_write("a.txt").unwrap());
    assert_eq!(store.entries().len(), 1);

    std::fs::write(root.join("a.txt"), "被改坏的内容").unwrap();

    let restored = store.rollback_all().unwrap();
    assert_eq!(restored, 1);
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), original);
}

#[test]
fn test_checkpoint_skips_new_files_and_yachiyo_dir() {
    use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    let mut store = CheckpointStore::new(root, "run-test-2");
    assert!(!store.backup_before_write("new-file.txt").unwrap());
    assert!(!store.backup_before_write(".yachiyo/x.txt").unwrap());
    assert_eq!(store.entries().len(), 0);
}

#[test]
fn test_checkpoint_ensure_gitignore() {
    use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;

    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let store = CheckpointStore::new(root, "run-test-3");
    store.ensure_gitignore().unwrap();
    let content = std::fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(content.contains(".yachiyo/"));
    store.ensure_gitignore().unwrap();
    let again = std::fs::read_to_string(root.join(".gitignore")).unwrap();
    assert_eq!(content.matches(".yachiyo/").count(), again.matches(".yachiyo/").count());
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_checkpoint`
Expected: 编译失败

- [ ] **Step 3: 实现**

`src-tauri/src/gateway/agent/checkpoint.rs`：

```rust
use crate::tools::fs::resolve_in_workspace;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointManifestEntry {
    pub sequence: u32,
    /// 工作区相对路径（原文件）
    pub original: String,
    /// 工作区相对路径（备份文件）
    pub backup: String,
}

/// 单次 Agent 运行的写前影子备份；rollback_all 按逆序恢复
pub struct CheckpointStore {
    workspace_root: PathBuf,
    run_id: String,
    entries: Vec<CheckpointManifestEntry>,
    sequence: u32,
}

impl CheckpointStore {
    pub fn new(workspace_root: &Path, run_id: &str) -> Self {
        Self {
            workspace_root: workspace_root.to_path_buf(),
            run_id: run_id.to_string(),
            entries: Vec::new(),
            sequence: 0,
        }
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn entries(&self) -> &[CheckpointManifestEntry] {
        &self.entries
    }

    /// write_file 执行前调用；目标存在且不在 .yachiyo/ 内时备份，返回是否产生备份
    pub fn backup_before_write(&mut self, path_str: &str) -> Result<bool, String> {
        let target = resolve_in_workspace(path_str, &self.workspace_root)?;
        if !target.exists() || !target.is_file() {
            return Ok(false);
        }
        let relative = target
            .strip_prefix(&self.workspace_root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| target.to_string_lossy().to_string());
        if relative.starts_with(".yachiyo") {
            return Ok(false);
        }

        self.sequence += 1;
        let backup_rel = format!(
            ".yachiyo/checkpoints/{}/{}__{}",
            self.run_id,
            self.sequence,
            relative.replace(['\\', '/'], "__")
        );
        let backup_abs = self.workspace_root.join(&backup_rel);
        if let Some(parent) = backup_abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {}", e))?;
        }
        std::fs::copy(&target, &backup_abs).map_err(|e| format!("备份文件失败: {}", e))?;

        self.entries.push(CheckpointManifestEntry {
            sequence: self.sequence,
            original: relative,
            backup: backup_rel,
        });
        Ok(true)
    }

    /// 逆序恢复全部备份，返回恢复数量
    pub fn rollback_all(&self) -> Result<usize, String> {
        let mut restored = 0;
        for entry in self.entries.iter().rev() {
            let backup_abs = self.workspace_root.join(&entry.backup);
            let original_abs = self.workspace_root.join(&entry.original);
            match std::fs::copy(&backup_abs, &original_abs) {
                Ok(_) => restored += 1,
                Err(e) => return Err(format!("回滚 {} 失败: {}", entry.original, e)),
            }
        }
        Ok(restored)
    }

    /// 确保 workspace 的 .gitignore 忽略 .yachiyo/（不存在则创建，幂等追加）
    pub fn ensure_gitignore(&self) -> Result<(), String> {
        let gitignore = self.workspace_root.join(".gitignore");
        let marker = ".yachiyo/";
        let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
        if existing.lines().any(|line| line.trim() == marker) {
            return Ok(());
        }
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(marker);
        next.push('\n');
        std::fs::write(&gitignore, next).map_err(|e| format!("写入 .gitignore 失败: {}", e))
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/gateway/agent/checkpoint.rs src-tauri/tests/agent_tests.rs src-tauri/Cargo.toml
git commit -m "feat(agent): 写前影子备份 CheckpointStore 与回滚"
```

***

### Task 9: AgentRuntime 循环与 /api/chat 集成（Rust，核心）

**Files:**

- Modify: `src-tauri/src/gateway/agent/runtime.rs`

- Modify: `src-tauri/src/gateway/mod.rs`

- Modify: `src-tauri/src/server/http.rs`（handle\_chat 传 approvals）

- Test: `src-tauri/tests/agent_tests.rs`

**Interfaces:**

- Consumes: Task 1-8 全部产物

- Produces:

  - `pub type EventSink = Arc<dyn Fn(LoopEmit) + Send + Sync>`；`pub enum LoopEmit { Event(ClientStreamEvent), Ping }`

  - `pub struct AgentLoopConfig { pub max_turns: u32, pub permission_timeout_secs: u64 }`（Default: 12 / 300）

  - `pub struct TurnOutcome { pub text: String, pub tool_calls: Vec<ToolInvocation>, pub usage: Option<TokenUsage> }`

  - `pub trait TurnExecutor: Send + Sync { fn execute(&self, messages: &[AgentMessage], sink: &EventSink) -> BoxFuture<'_, Result<TurnOutcome, String>> }`

  - `pub enum LoopOutcome { Completed { usage: TokenUsage }, MaxTurnsReached { usage: TokenUsage }, Cancelled }`

  - `pub async fn run_agent_loop(messages, tools_schema, config, executor: &dyn TurnExecutor, gate: &ApprovalRegistry, checkpoint: &mut CheckpointStore, cancelled: &AtomicBool, sink: &EventSink, workspace_root: &Path, http_client: &reqwest::Client) -> Result<LoopOutcome, String>`

  - `pub struct HttpTurnExecutor { client, provider_id, api_key, model, system_prompt, tools_schema }`

  - `pub fn run_agent_chat_stream(client, request, key_store, workspace_manager, approvals) -> impl Stream<Item = Result<String, axum::Error>>`

  - `handle_chat_stream`：`agent.enabled` 分流；纯聊天路径删除 `parse_tool_call`、单工具 hack、第二轮汇报、`max_characters` 截断

- [ ] **Step 1: 写失败测试**

`agent_tests.rs` 头部追加 use（含 `futures::future::BoxFuture` 的使用方式见 ScriptedExecutor），并追加测试：

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use yachiyo_desktop_lib::gateway::agent::checkpoint::CheckpointStore;
use yachiyo_desktop_lib::gateway::agent::messages::AgentMessage;
use yachiyo_desktop_lib::gateway::agent::permission::{ApprovalDecision, ApprovalRegistry};
use yachiyo_desktop_lib::gateway::agent::runtime::{
    run_agent_loop, AgentLoopConfig, LoopEmit, LoopOutcome, TurnExecutor, TurnOutcome,
};
use yachiyo_desktop_lib::tools::get_agent_tools_schema;
use yachiyo_desktop_lib::types::{ClientStreamEvent, TokenUsage, ToolInvocation};

/// 脚本化执行器：按序返回预编排轮次，并记录收到的消息序列
struct ScriptedExecutor {
    turns: Mutex<Vec<TurnOutcome>>,
    seen: Mutex<Vec<Vec<AgentMessage>>>,
}

impl ScriptedExecutor {
    fn new(turns: Vec<TurnOutcome>) -> Self {
        Self { turns: Mutex::new(turns), seen: Mutex::new(Vec::new()) }
    }
}

impl TurnExecutor for ScriptedExecutor {
    fn execute(
        &self,
        messages: &[AgentMessage],
        _sink: &yachiyo_desktop_lib::gateway::agent::runtime::EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        self.seen.lock().unwrap().push(messages.to_vec());
        let next = self.turns.lock().unwrap().remove(0);
        Box::pin(async move { Ok(next) })
    }
}

fn collector() -> (yachiyo_desktop_lib::gateway::agent::runtime::EventSink, Arc<Mutex<Vec<ClientStreamEvent>>>) {
    let events: Arc<Mutex<Vec<ClientStreamEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let sink: yachiyo_desktop_lib::gateway::agent::runtime::EventSink =
        Arc::new(move |emit| {
            if let LoopEmit::Event(ev) = emit {
                sink_events.lock().unwrap().push(ev);
            }
        });
    (sink, events)
}

fn read_call(id: &str, path: &str) -> TurnOutcome {
    TurnOutcome {
        text: "我先读文件".to_string(),
        tool_calls: vec![ToolInvocation {
            id: id.to_string(),
            name: "read_file".to_string(),
            arguments: serde_json::json!({ "path": path }),
        }],
        usage: None,
    }
}

#[tokio::test]
async fn test_loop_plain_text_completion() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        text: "任务完成".to_string(),
        tool_calls: vec![],
        usage: None,
    }]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-1");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert!(events.lock().unwrap().iter().all(|ev| !matches!(ev, ClientStreamEvent::ToolCall { .. })));
    assert_eq!(executor.seen.lock().unwrap()[0].len(), 1);
}

#[tokio::test]
async fn test_loop_multi_turn_chain() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), "内容").unwrap();
    let executor = ScriptedExecutor::new(vec![
        read_call("call-1", "a.txt"),
        TurnOutcome { text: "读完了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-2");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "读 a.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let all = events.lock().unwrap();
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::ToolCall { name, .. } if name == "read_file")));
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::ToolResult { is_error: false, .. })));
    let second = &executor.seen.lock().unwrap()[1];
    assert_eq!(second.len(), 3);
    assert!(matches!(&second[2], AgentMessage::ToolResult { content, .. } if content.contains("内容")));
}

#[tokio::test]
async fn test_loop_write_permission_denied() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            text: "我要写文件".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "call-w".to_string(),
                name: "write_file".to_string(),
                arguments: serde_json::json!({ "path": "out.txt", "content": "x" }),
            }],
        },
        TurnOutcome { text: "好的，那我不写了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-3");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let gate_ref = &gate;
    let handle = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        gate_ref.resolve("run-3-call-w", ApprovalDecision { approved: false, session_scope: false });
    });

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写 out.txt".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();
    handle.abort();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let all = events.lock().unwrap();
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::PermissionRequest { .. })));
    assert!(all.iter().any(|ev| matches!(ev, ClientStreamEvent::ToolResult { is_error: true, .. })));
    assert!(!dir.path().join("out.txt").exists());
}

#[tokio::test]
async fn test_loop_session_scope_skips_second_prompt() {
    let dir = tempfile::tempdir().unwrap();
    let write_call = |id: &str| TurnOutcome {
        text: "写".to_string(),
        tool_calls: vec![ToolInvocation {
            id: id.to_string(),
            name: "write_file".to_string(),
            arguments: serde_json::json!({ "path": format!("{}.txt", id), "content": "x" }),
        }],
    };
    let executor = ScriptedExecutor::new(vec![
        write_call("w1"),
        write_call("w2"),
        TurnOutcome { text: "完成".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-4");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let gate_ref = &gate;
    let approver = tokio::spawn(async move {
        for _ in 0..2 {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            gate_ref.resolve("run-4-w1", ApprovalDecision { approved: true, session_scope: true });
            gate_ref.resolve("run-4-w2", ApprovalDecision { approved: true, session_scope: true });
        }
    });

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写两个文件".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();
    approver.abort();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    let all = events.lock().unwrap();
    let permission_count = all
        .iter()
        .filter(|ev| matches!(ev, ClientStreamEvent::PermissionRequest { .. }))
        .count();
    assert_eq!(permission_count, 1, "session_scope 批准后同类工具不再询问");
    assert!(dir.path().join("w1.txt").exists());
    assert!(dir.path().join("w2.txt").exists());
}

#[tokio::test]
async fn test_loop_permission_timeout_treated_as_denied() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![
        TurnOutcome {
            text: "写".to_string(),
            tool_calls: vec![ToolInvocation {
                id: "w1".to_string(),
                name: "write_file".to_string(),
                arguments: serde_json::json!({ "path": "t.txt", "content": "x" }),
            }],
        },
        TurnOutcome { text: "超时了".to_string(), tool_calls: vec![], usage: None },
    ]);
    let (sink, events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-5");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "写".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig { max_turns: 12, permission_timeout_secs: 1 },
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();

    assert!(matches!(outcome, LoopOutcome::Completed { .. }));
    assert!(events.lock().unwrap().iter().any(|ev| matches!(ev, ClientStreamEvent::ToolResult { is_error: true, .. })));
    assert!(!dir.path().join("t.txt").exists());
}

#[tokio::test]
async fn test_loop_cancel_between_turns() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![read_call("c1", ".")]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-6");
    let cancelled = AtomicBool::new(true);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "列目录".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();
    assert!(matches!(outcome, LoopOutcome::Cancelled));
}

#[tokio::test]
async fn test_loop_usage_accumulates() {
    let dir = tempfile::tempdir().unwrap();
    let executor = ScriptedExecutor::new(vec![TurnOutcome {
        text: "a".to_string(),
        tool_calls: vec![],
        usage: Some(TokenUsage {
            prompt_tokens: Some(10),
            completion_tokens: Some(5),
            total_tokens: Some(15),
        }),
    }]);
    let (sink, _events) = collector();
    let gate = ApprovalRegistry::new();
    let mut checkpoint = CheckpointStore::new(dir.path(), "run-7");
    let cancelled = AtomicBool::new(false);
    let http = reqwest::Client::new();

    let outcome = run_agent_loop(
        vec![AgentMessage::User { text: "hi".to_string(), image_data_url: None }],
        get_agent_tools_schema(),
        AgentLoopConfig::default(),
        &executor,
        &gate,
        &mut checkpoint,
        &cancelled,
        &sink,
        dir.path(),
        &http,
    )
    .await
    .unwrap();
    match outcome {
        LoopOutcome::Completed { usage } => assert_eq!(usage.total_tokens, Some(15)),
        _ => panic!("expected Completed"),
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_loop_`
Expected: 编译失败（runtime 模块为空）

- [ ] **Step 3: 实现 runtime.rs**

```rust
use crate::crypto::keys::KeyStore;
use crate::gateway::agent::checkpoint::CheckpointStore;
use crate::gateway::agent::messages::{history_to_agent_messages, AgentMessage};
use crate::gateway::agent::permission::{ApprovalRegistry, ApprovalDecision};
use crate::gateway::prompt::build_agent_system_prompt;
use crate::gateway::providers::registry::get_provider_config;
use crate::gateway::stream::{encode_client_event, encode_ping};
use crate::tools::{
    execute_tool, preview_tool_output, truncate_tool_output, WorkspaceManager, ToolRisk, tool_risk,
};
use crate::types::{ClientChatRequest, ClientStreamEvent, ProviderId, TokenUsage, ToolInvocation};
use async_stream::stream;
use futures::Stream;
use futures_util::StreamExt;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub type EventSink = Arc<dyn Fn(LoopEmit) + Send + Sync>;

pub enum LoopEmit {
    Event(ClientStreamEvent),
    Ping,
}

#[derive(Debug, Clone)]
pub struct AgentLoopConfig {
    pub max_turns: u32,
    pub permission_timeout_secs: u64,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self { max_turns: 12, permission_timeout_secs: 300 }
    }
}

pub struct TurnOutcome {
    pub text: String,
    pub tool_calls: Vec<ToolInvocation>,
    pub usage: Option<TokenUsage>,
}

pub trait TurnExecutor: Send + Sync {
    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>>;
}

pub enum LoopOutcome {
    Completed { usage: TokenUsage },
    MaxTurnsReached { usage: TokenUsage },
    Cancelled,
}

fn accumulate_usage(acc: &mut TokenUsage, inc: &Option<TokenUsage>) {
    if let Some(u) = inc {
        acc.prompt_tokens = u.prompt_tokens.or(acc.prompt_tokens);
        if let Some(c) = u.completion_tokens {
            acc.completion_tokens = Some(acc.completion_tokens.unwrap_or(0) + c);
        }
        if let Some(t) = u.total_tokens {
            acc.total_tokens = Some(acc.total_tokens.unwrap_or(0) + t);
        }
    }
}

/// 工具被用户拒绝时回填给模型的说明
const DENIED_TOOL_RESULT: &str = "用户拒绝了本次操作。不要立即重试同一动作；请改用其他方案，或向用户说明需要该操作的理由。";

pub async fn run_agent_loop(
    mut messages: Vec<AgentMessage>,
    tools_schema: Vec<serde_json::Value>,
    config: AgentLoopConfig,
    executor: &dyn TurnExecutor,
    gate: &ApprovalRegistry,
    checkpoint: &mut CheckpointStore,
    cancelled: &AtomicBool,
    sink: &EventSink,
    workspace_root: &Path,
    http_client: &reqwest::Client,
) -> Result<LoopOutcome, String> {
    let mut usage = TokenUsage::default();
    let mut session_allowed: HashSet<String> = HashSet::new();
    let run_id = checkpoint.run_id().to_string();

    for turn in 1..=config.max_turns {
        if cancelled.load(Ordering::Relaxed) {
            return Ok(LoopOutcome::Cancelled);
        }
        sink(LoopEmit::Event(ClientStreamEvent::Turn { index: turn, usage: None }));

        let outcome = executor.execute(&messages, sink).await?;
        accumulate_usage(&mut usage, &outcome.usage);

        if outcome.tool_calls.is_empty() {
            return Ok(LoopOutcome::Completed { usage });
        }

        messages.push(AgentMessage::Assistant {
            text: outcome.text.clone(),
            tool_calls: outcome.tool_calls.clone(),
        });

        for call in &outcome.tool_calls {
            sink(LoopEmit::Event(ClientStreamEvent::ToolCall {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            }));

            let approved = match tool_risk(&call.name) {
                Some(ToolRisk::Read) | None => true,
                Some(ToolRisk::Write) => {
                    if session_allowed.contains(&call.name) {
                        true
                    } else {
                        let request_id = format!("{}-{}", run_id, call.id);
                        let mut rx = gate.register(&request_id);
                        sink(LoopEmit::Event(ClientStreamEvent::PermissionRequest {
                            request_id: request_id.clone(),
                            tool_name: call.name.clone(),
                            arguments: call.arguments.clone(),
                        }));
                        let deadline = Instant::now() + Duration::from_secs(config.permission_timeout_secs);
                        let mut last_ping = Instant::now();
                        let decision = loop {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                break None;
                            }
                            tokio::select! {
                                decided = &mut rx => break decided.ok(),
                                _ = tokio::time::sleep(remaining) => break None,
                                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                                    if cancelled.load(Ordering::Relaxed) {
                                        gate.cancel(&request_id);
                                        return Ok(LoopOutcome::Cancelled);
                                    }
                                    if last_ping.elapsed() >= Duration::from_secs(5) {
                                        sink(LoopEmit::Ping);
                                        last_ping = Instant::now();
                                    }
                                }
                            }
                        };
                        let approved = decision.map(|d| d.approved).unwrap_or(false);
                        sink(LoopEmit::Event(ClientStreamEvent::PermissionResolved {
                            request_id,
                            approved,
                        }));
                        if approved {
                            if let Some(d) = decision {
                                if d.session_scope {
                                    session_allowed.insert(call.name.clone());
                                }
                            }
                        }
                        approved
                    }
                }
            };

            let started = Instant::now();
            let (output, is_error) = if approved {
                if call.name == "write_file" {
                    if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                        checkpoint.backup_before_write(path)?;
                    }
                }
                match execute_tool(&call.name, &call.arguments, workspace_root, http_client).await {
                    Ok(out) => (out, false),
                    Err(err) => (err, true),
                }
            } else {
                (DENIED_TOOL_RESULT.to_string(), true)
            };
            let duration_ms = started.elapsed().as_millis() as u64;

            let model_output = if is_error { output.clone() } else { truncate_tool_output(&call.name, &output) };
            sink(LoopEmit::Event(ClientStreamEvent::ToolResult {
                id: call.id.clone(),
                name: call.name.clone(),
                output: preview_tool_output(&model_output),
                is_error,
                duration_ms,
            }));
            messages.push(AgentMessage::ToolResult {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                content: model_output,
            });
        }
    }
    Ok(LoopOutcome::MaxTurnsReached { usage })
}

/// 真实执行器：走上游 HTTP 流式接口，透传 thought/delta/sources 事件
pub struct HttpTurnExecutor {
    pub client: reqwest::Client,
    pub provider_id: ProviderId,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub tools_schema: Vec<serde_json::Value>,
}

impl TurnExecutor for HttpTurnExecutor {
    fn execute(
        &self,
        messages: &[AgentMessage],
        sink: &EventSink,
    ) -> futures::future::BoxFuture<'_, Result<TurnOutcome, String>> {
        let client = self.client.clone();
        let provider_id = self.provider_id;
        let api_key = self.api_key.clone();
        let model = self.model.clone();
        let system_prompt = self.system_prompt.clone();
        let tools_schema = self.tools_schema.clone();
        let messages = messages.to_vec();
        let sink = Arc::clone(sink);
        Box::pin(async move {
            let config = get_provider_config(provider_id);

            let (url, body) = match provider_id {
                ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => {
                    (
                        config.endpoint.to_string(),
                        crate::gateway::providers::openai_compat::build_openai_agent_body(
                            &model, &messages, &system_prompt, &tools_schema,
                        ),
                    )
                }
                ProviderId::Claude => (
                    config.endpoint.to_string(),
                    crate::gateway::providers::anthropic::build_anthropic_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
                ProviderId::Gemini => (
                    format!("{}/models/{}:streamGenerateContent?alt=sse", config.endpoint, model),
                    crate::gateway::providers::gemini::build_gemini_agent_body(
                        &model, &messages, &system_prompt, &tools_schema,
                    ),
                ),
            };

            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static("application/json"));
            headers.insert(reqwest::header::ACCEPT, reqwest::header::HeaderValue::from_static("text/event-stream"));
            match provider_id {
                ProviderId::Claude => {
                    headers.insert(reqwest::header::HeaderName::from_static("x-api-key"), reqwest::header::HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);
                    headers.insert(reqwest::header::HeaderName::from_static("anthropic-version"), reqwest::header::HeaderValue::from_static("2023-06-01"));
                }
                ProviderId::Gemini => {
                    headers.insert(reqwest::header::HeaderName::from_static("x-goog-api-key"), reqwest::header::HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);
                }
                _ => {
                    let auth_val = format!("Bearer {}", api_key);
                    headers.insert(reqwest::header::AUTHORIZATION, reqwest::header::HeaderValue::from_str(&auth_val).map_err(|e| e.to_string())?);
                }
            }

            let res = client
                .post(&url)
                .headers(headers)
                .body(body.to_string())
                .send()
                .await
                .map_err(|e| format!("上游网络错误: {}", e))?;
            if !res.status().is_success() {
                let status = res.status();
                let text = res.text().await.unwrap_or_default();
                return Err(format!("上游返回错误 {}: {}", status, text));
            }

            let mut agg = crate::gateway::agent::stream_agg::ToolCallAggregator::new();
            let mut full_text = String::new();
            let mut usage: Option<TokenUsage> = None;
            let mut buffer = String::new();
            let mut byte_stream = res.bytes_stream();

            while let Some(chunk_res) = byte_stream.next().await {
                let bytes = chunk_res.map_err(|e| format!("上游流读取失败: {}", e))?;
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    buffer.push_str(text);
                }
                while let Some(pos) = buffer.find("\n\n") {
                    let record = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();
                    let mut data_str = String::new();
                    for line in record.lines() {
                        let trimmed = line.trim();
                        if trimmed.starts_with("data:") {
                            let content = trimmed[5..].trim_start();
                            if !data_str.is_empty() {
                                data_str.push('\n');
                            }
                            data_str.push_str(content);
                        }
                    }
                    if data_str.is_empty() || data_str == "[DONE]" {
                        continue;
                    }
                    let delta = match provider_id {
                        ProviderId::Stepfun | ProviderId::Deepseek | ProviderId::Glm | ProviderId::Openai => crate::gateway::stream::extract_openai_delta(&data_str),
                        ProviderId::Claude => crate::gateway::providers::anthropic::extract_anthropic_delta(&data_str),
                        ProviderId::Gemini => crate::gateway::providers::gemini::extract_gemini_delta(&data_str),
                    };
                    let Some(delta) = delta else { continue };
                    if let Some(sources) = delta.sources {
                        if !sources.is_empty() {
                            sink(LoopEmit::Event(ClientStreamEvent::Sources { sources }));
                        }
                    }
                    if let Some(u) = delta.usage {
                        usage = Some(u);
                    }
                    if let Some(thought) = delta.thought {
                        if !thought.is_empty() {
                            sink(LoopEmit::Event(ClientStreamEvent::Thought { text: thought }));
                        }
                    }
                    if let Some(content) = delta.content {
                        if !content.is_empty() {
                            full_text.push_str(&content);
                            sink(LoopEmit::Event(ClientStreamEvent::Delta { text: content }));
                        }
                    }
                    for tc in &delta.tool_calls {
                        agg.push(tc);
                    }
                }
            }

            Ok(TurnOutcome { text: full_text, tool_calls: agg.finish(), usage })
        })
    }
}

/// Agent 模式的 /api/chat 入口：SSE 流承载完整多轮运行
pub fn run_agent_chat_stream(
    client: reqwest::Client,
    request: ClientChatRequest,
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
    approvals: Arc<ApprovalRegistry>,
) -> impl Stream<Item = Result<String, axum::Error>> {
    stream! {
        let provider_id = request.provider.unwrap_or(ProviderId::Stepfun);
        let config = get_provider_config(provider_id);
        let model = request.model.clone().unwrap_or_else(|| config.default_model.to_string());

        let api_key = request.api_key.clone().or_else(|| {
            let provider_name = match provider_id {
                ProviderId::Stepfun => "stepfun",
                ProviderId::Deepseek => "deepseek",
                ProviderId::Glm => "glm",
                ProviderId::Openai => "openai",
                ProviderId::Claude => "claude",
                ProviderId::Gemini => "gemini",
            };
            key_store.get_key(provider_name)
        });
        let api_key = match api_key {
            Some(k) if !k.is_empty() => k,
            _ => {
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "SESSION_REQUIRED".to_string() }));
                return;
            }
        };

        // 取消哨兵：SSE 流 Drop（客户端断开）时置位
        let cancelled = Arc::new(AtomicBool::new(false));
        let _guard = CancelOnDrop(Arc::clone(&cancelled));

        let system_prompt = build_agent_system_prompt(request.locale, request.current_time.as_deref());
        let executor = HttpTurnExecutor {
            client: client.clone(),
            provider_id,
            api_key,
            model,
            system_prompt,
            tools_schema: crate::tools::get_agent_tools_schema(),
        };

        let agent_config = request.agent.as_ref()
            .map(|a| AgentLoopConfig { max_turns: a.max_turns.unwrap_or(12), permission_timeout_secs: 300 })
            .unwrap_or_default();

        let root = workspace_manager.get_workspace_root();
        let run_id = format!(
            "{}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
            rand::random::<u32>()
        );
        let mut checkpoint = CheckpointStore::new(&root, &run_id);
        let _ = checkpoint.ensure_gitignore();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<LoopEmit>();
        let sink: EventSink = Arc::new(move |emit| { let _ = tx.send(emit); });

        let loop_messages = history_to_agent_messages(&request.messages);
        let exec = executor;
        let handle = tokio::spawn(async move {
            run_agent_loop(
                loop_messages,
                exec.tools_schema.clone(),
                agent_config,
                &exec,
                &approvals,
                &mut checkpoint,
                &cancelled,
                &sink,
                &root,
                &exec.client,
            )
            .await
        });

        while let Some(emit) = rx.recv().await {
            match emit {
                LoopEmit::Event(ev) => yield Ok(encode_client_event(&ev)),
                LoopEmit::Ping => yield Ok(encode_ping().to_string()),
            }
        }

        match handle.await {
            Ok(Ok(outcome)) => match outcome {
                LoopOutcome::Completed { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: false, usage: Some(usage) }));
                }
                LoopOutcome::MaxTurnsReached { usage } => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: true, usage: Some(usage) }));
                }
                LoopOutcome::Cancelled => {
                    yield Ok(encode_client_event(&ClientStreamEvent::Done { truncated: true, usage: None }));
                }
            },
            Ok(Err(e)) => {
                tracing::error!("Agent loop error: {}", e);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "PROVIDER_STREAM_ERROR".to_string() }));
            }
            Err(e) => {
                tracing::error!("Agent loop task join error: {}", e);
                yield Ok(encode_client_event(&ClientStreamEvent::Error { code: "PROVIDER_STREAM_ERROR".to_string() }));
            }
        }
    }
}

/// Drop 时置位取消标志
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}
```

- [ ] **Step 4: handle\_chat\_stream 分流与遗留清理（gateway/mod.rs + server/http.rs）**

1. `src-tauri/src/gateway/mod.rs`：删除 `parse_tool_call` 函数（约 L23-L109）。
2. `handle_chat_stream` 签名加 `approvals: Arc<crate::gateway::agent::permission::ApprovalRegistry>` 参数；函数体最前（`let provider_id = ...` 之前）插入：

```rust
if request.agent.as_ref().map(|a| a.enabled).unwrap_or(false) {
    return agent::runtime::run_agent_chat_stream(client, request, key_store, workspace_manager, approvals);
}
```

1. `server/http.rs` 的 `handle_chat` 调用处传 `Arc::clone(&state.approvals)`。
2. 纯聊天路径清理：删除 `max_characters`/`emitted_chars` 截断逻辑（delta 直接透传）、删除 `full_accumulated_text` 累积、删除流结束后的单工具解析与第二轮汇报块（约 L360-L455 区域）。Done 事件保留现有 usage 聚合。
3. 清理不再使用的 import（如 `tools::{self}` 若已无引用）。

- [ ] **Step 5: 运行确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/gateway/agent/runtime.rs src-tauri/src/gateway/mod.rs src-tauri/src/server/http.rs src-tauri/tests/agent_tests.rs
git commit -m "feat(agent): 多步循环内核与 /api/chat 分流，移除文本假协议与截断遗留"
```

***

### Task 10: 前端协议层（chat-client.ts）

**Files:**

- Modify: `src/services/chat-client.ts`

- Test: `src/services/chat-client.test.ts`

**Interfaces:**

- Produces:

  - `StreamChatMessage`：`role: "user" | "assistant" | "tool"`、`toolCalls?: { id: string; name: string; arguments: unknown }[]`、`toolCallId?: string`、`toolName?: string`

  - `StreamChatRequest` 加 `agent?: { enabled: true; maxTurns?: number }`

  - `StreamChatOptions` 加 `onToolCall?` / `onToolResult?` / `onPermissionRequest?` / `onPermissionResolved?` / `onTurn?` 回调

  - `export async function submitAgentApproval(payload: { requestId: string; approved: boolean; sessionScope?: boolean }): Promise<void>`

- [ ] **Step 1: 写失败测试**

`src/services/chat-client.test.ts` 追加（沿用该文件现有的 mock fetcher 与 ReadableStream 构造模式，若 helper 名不同按现有风格适配）：

```typescript
describe("agent 事件解析", () => {
  function sse(event: string, data: unknown): Uint8Array {
    return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  it("解析 tool_call / tool_result / turn 事件", async () => {
    const events: unknown[] = [];
    const fetcher = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(sse("turn", { index: 1 }));
            controller.enqueue(sse("tool_call", { id: "call-1", name: "read_file", arguments: { path: "a.ts" } }));
            controller.enqueue(sse("tool_result", { id: "call-1", name: "read_file", output: "hi", isError: false, durationMs: 12 }));
            controller.enqueue(sse("done", { truncated: false }));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      ),
    );

    await streamChat(
      { locale: "zh-CN", messages: [{ role: "user", text: "hi" }], agent: { enabled: true } },
      {
        fetcher: fetcher as unknown as typeof fetch,
        onDelta: () => undefined,
        onToolCall: (call) => events.push({ kind: "tool_call", call }),
        onToolResult: (result) => events.push({ kind: "tool_result", result }),
        onTurn: (turn) => events.push({ kind: "turn", turn }),
      },
    );

    expect(events).toEqual([
      { kind: "turn", turn: { index: 1 } },
      { kind: "tool_call", call: { id: "call-1", name: "read_file", arguments: { path: "a.ts" } } },
      { kind: "tool_result", result: { id: "call-1", name: "read_file", output: "hi", isError: false, durationMs: 12 } },
    ]);
  });

  it("畸形 tool_call 载荷抛 STREAM_ERROR", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: tool_call\ndata: {"id":1}\n\n'));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    await expect(
      streamChat(
        { locale: "zh-CN", messages: [{ role: "user", text: "hi" }] },
        { fetcher: fetcher as unknown as typeof fetch, onDelta: () => undefined, onToolCall: () => undefined },
      ),
    ).rejects.toMatchObject({ code: "STREAM_ERROR" });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit -- --run src/services/chat-client.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`chat-client.ts`：

`StreamChatMessage` 扩展 role 联合与字段（`toolCalls`/`toolCallId`/`toolName`，与 Rust 侧 serde 名一致）；`StreamChatRequest` 加 `agent?: { enabled: true; maxTurns?: number }`；`StreamChatOptions` 加五个可选回调（载荷类型即测试中的形态）。

`consume()` 的 else-if 链追加（在 `done` 分支前）：

```typescript
} else if (fields.event === "tool_call") {
  if (typeof payload.id !== "string" || typeof payload.name !== "string") throw new ChatClientError("STREAM_ERROR");
  options.onToolCall?.({ id: payload.id, name: payload.name, arguments: payload.arguments });
} else if (fields.event === "tool_result") {
  if (
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.output !== "string" ||
    typeof payload.isError !== "boolean" ||
    typeof payload.durationMs !== "number"
  ) {
    throw new ChatClientError("STREAM_ERROR");
  }
  options.onToolResult?.({
    id: payload.id,
    name: payload.name,
    output: payload.output,
    isError: payload.isError,
    durationMs: payload.durationMs,
  });
} else if (fields.event === "permission_request") {
  if (typeof payload.requestId !== "string" || typeof payload.toolName !== "string") throw new ChatClientError("STREAM_ERROR");
  options.onPermissionRequest?.({ requestId: payload.requestId, toolName: payload.toolName, arguments: payload.arguments });
} else if (fields.event === "permission_resolved") {
  if (typeof payload.requestId !== "string" || typeof payload.approved !== "boolean") throw new ChatClientError("STREAM_ERROR");
  options.onPermissionResolved?.({ requestId: payload.requestId, approved: payload.approved });
} else if (fields.event === "turn") {
  if (typeof payload.index !== "number") throw new ChatClientError("STREAM_ERROR");
  const usage = isUsagePayload(payload.usage) ? payload.usage : undefined;
  options.onTurn?.(usage !== undefined ? { index: payload.index, usage } : { index: payload.index });
}
```

文件末尾追加：

```typescript
/** 桌面端 Agent 权限批准回传（与 /api/chat 同 origin 路由规则） */
export async function submitAgentApproval(payload: {
  requestId: string;
  approved: boolean;
  sessionScope?: boolean;
}): Promise<void> {
  try {
    await apiFetch("/api/agent/approval", {
      method: "POST",
      body: JSON.stringify(payload),
      credentials: apiCredentials(),
      headers: { "content-type": "application/json" },
    });
  } catch {
    // 网络失败静默：流内 permission_resolved 不会到达，UI 卡片最终走超时拒绝
  }
}
```

注意：现有 else-if 链的兜底 `else { throw new ChatClientError("STREAM_ERROR"); }` 保留在最后——新事件接入后未知事件仍按流损坏处理。

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:unit -- --run src/services/chat-client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/chat-client.ts src/services/chat-client.test.ts
git commit -m "feat(agent): chat-client 解析 Agent SSE 事件与批准回传"
```

***

### Task 11: 前端状态层（domain + reducer + controller）

**Files:**

- Modify: `src/domain/chat.ts`

- Modify: `src/app/chat-reducer.ts`

- Modify: `src/app/use-chat-controller.ts`

- Test: `src/app/chat-reducer.test.ts`

**Interfaces:**

- Produces:

  - `domain/chat.ts`：`export interface ToolStep { readonly id: string; readonly name: string; readonly argumentsJson: string; readonly result?: { readonly output: string; readonly isError: boolean; readonly durationMs: number } }`；`ChatMessage` 加 `toolSteps?: ReadonlyArray<ToolStep>`

  - reducer 新动作：`tool-call` / `tool-result` / `permission-requested` / `permission-resolved`；`ChatState.pendingPermission?: { messageId: string; requestId: string; toolName: string; argumentsJson: string }`

  - controller 返回值新增：`agentEnabled: boolean`、`toggleAgent(): void`、`approvePermission(requestId: string, approved: boolean, sessionScope?: boolean): Promise<void>`、`pendingPermission`

  - 请求体在 `agentEnabled && isDesktopApp()` 时携带 `agent: { enabled: true }`；带 toolSteps 的历史消息展开为 assistant(toolCalls) + tool 消息

- [ ] **Step 1: 写失败测试**

`src/app/chat-reducer.test.ts` 追加（沿用该文件现有 state/message 构造 helper；若 helper 名不同按现有风格适配）：

```typescript
describe("agent 工具事件动作", () => {
  const baseState: ChatState = {
    ...initialChatState,
    phase: "streaming",
    messages: [
      { id: "a1", conversationId: "c1", role: "assistant", text: "", status: "streaming", createdAt: 1 },
    ],
  };

  it("tool-call 追加 ToolStep，tool-result 回填结果", () => {
    let state = chatReducer(baseState, {
      type: "tool-call",
      messageId: "a1",
      call: { id: "call-1", name: "read_file", argumentsJson: '{"path":"a.ts"}' },
    });
    expect(state.messages[0].toolSteps?.length).toBe(1);
    expect(state.messages[0].toolSteps?.[0].name).toBe("read_file");

    state = chatReducer(state, {
      type: "tool-result",
      messageId: "a1",
      callId: "call-1",
      result: { output: "hi", isError: false, durationMs: 5 },
    });
    expect(state.messages[0].toolSteps?.[0].result?.output).toBe("hi");
  });

  it("permission-requested 设置 pendingPermission，resolved 清除", () => {
    let state = chatReducer(baseState, {
      type: "permission-requested",
      messageId: "a1",
      requestId: "req-1",
      toolName: "write_file",
      argumentsJson: '{"path":"b.ts"}',
    });
    expect(state.pendingPermission?.requestId).toBe("req-1");

    state = chatReducer(state, { type: "permission-resolved", requestId: "req-1", approved: true });
    expect(state.pendingPermission).toBeUndefined();
  });

  it("send-started 清除 pendingPermission", () => {
    let state = chatReducer(baseState, {
      type: "permission-requested",
      messageId: "a1",
      requestId: "req-1",
      toolName: "write_file",
      argumentsJson: "{}",
    });
    state = chatReducer(state, {
      type: "send-started",
      assistant: { id: "a2", conversationId: "c1", role: "assistant", text: "", status: "streaming", createdAt: 2 },
    });
    expect(state.pendingPermission).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit -- --run src/app/chat-reducer.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 domain 与 reducer**

`domain/chat.ts` 在 `ChatMessage` 前加：

```typescript
/** Agent 工具执行步骤（调用 + 可选结果），随 assistant 消息持久化 */
export interface ToolStep {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  readonly result?: {
    readonly output: string;
    readonly isError: boolean;
    readonly durationMs: number;
  };
}
```

`ChatMessage` 加字段 `toolSteps?: ReadonlyArray<ToolStep>;`。

`chat-reducer.ts`：`ChatState` 加 `pendingPermission?: { messageId: string; requestId: string; toolName: string; argumentsJson: string }`；`ChatAction` 联合追加四个动作（形态见测试）；switch 追加：

```typescript
    case "tool-call":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          toolSteps: [
            ...(message.toolSteps ?? []),
            { id: action.call.id, name: action.call.name, argumentsJson: action.call.argumentsJson },
          ],
        })),
      };
    case "tool-result":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          toolSteps: (message.toolSteps ?? []).map((step) =>
            step.id === action.callId ? { ...step, result: action.result } : step,
          ),
        })),
      };
    case "permission-requested":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        pendingPermission: {
          messageId: action.messageId,
          requestId: action.requestId,
          toolName: action.toolName,
          argumentsJson: action.argumentsJson,
        },
      };
    case "permission-resolved":
      return state.pendingPermission?.requestId === action.requestId
        ? { ...state, pendingPermission: undefined }
        : state;
```

`send-started` 与 `conversation-selected` 分支各加 `pendingPermission: undefined`。

- [ ] **Step 4: controller 接线**

`use-chat-controller.ts`：

1. import 追加：`submitAgentApproval`（from `../services/chat-client`）、`ToolStep`（from `../domain/chat`）、`isDesktopApp`（from `../services/app-platform`，若未导入）；`useState` 若未导入则补。
2. `ActiveRun` 接口加 `toolSteps: ToolStep[]`；`startAssistant` 中 run 初始化加 `toolSteps: []`。
3. 新增开关：

```typescript
  const agentEnabledRef = useRef(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const toggleAgent = useCallback(() => {
    setAgentEnabled((prev) => {
      agentEnabledRef.current = !prev;
      return !prev;
    });
  }, []);
```

1. `startAssistant` 的 streamChat 请求对象追加 `...(agentEnabledRef.current && isDesktopApp() ? { agent: { enabled: true } } : {})`。
2. options 追加回调（全部带 `if (activeRef.current?.token !== run.token) return;` 守卫；`onPermissionResolved` 无守卫）：

```typescript
            onToolCall(call) {
              if (activeRef.current?.token !== run.token) return;
              const argumentsJson = JSON.stringify(call.arguments ?? {});
              run.toolSteps.push({ id: call.id, name: call.name, argumentsJson });
              emit({ messageId: run.assistant.id, call: { id: call.id, name: call.name, argumentsJson }, type: "tool-call" });
            },
            onToolResult(result) {
              if (activeRef.current?.token !== run.token) return;
              const step = run.toolSteps.find((s) => s.id === result.id);
              if (step !== undefined) {
                step.result = { output: result.output, isError: result.isError, durationMs: result.durationMs };
              }
              emit({
                messageId: run.assistant.id,
                callId: result.id,
                result: { output: result.output, isError: result.isError, durationMs: result.durationMs },
                type: "tool-result",
              });
            },
            onPermissionRequest(request) {
              if (activeRef.current?.token !== run.token) return;
              emit({
                messageId: run.assistant.id,
                requestId: request.requestId,
                toolName: request.toolName,
                argumentsJson: JSON.stringify(request.arguments ?? {}),
                type: "permission-requested",
              });
            },
            onPermissionResolved(resolved) {
              emit({ type: "permission-resolved", requestId: resolved.requestId, approved: resolved.approved });
            },
```

1. `finishRun` 与 `schedulePartialPersistence` 的消息构造追加 `...(run.toolSteps.length > 0 ? { toolSteps: run.toolSteps.map((step) => ({ ...step })) } : {})`。
2. 批准函数：

```typescript
  const approvePermission = useCallback(
    async (requestId: string, approved: boolean, sessionScope = false): Promise<void> => {
      await submitAgentApproval({ requestId, approved, ...(sessionScope ? { sessionScope: true } : {}) });
    },
    [],
  );
```

1. `makeRequestMessages` 的消息组装改为 `flatMap` 展开（保留现有末条 user 图片逻辑语义不变）：

```typescript
      const chatMessages = await Promise.all(
        history.flatMap(async ({ message, text }, index) => {
          if (message.role === "assistant" && message.toolSteps !== undefined && message.toolSteps.length > 0) {
            const requestMessages: StreamChatMessage[] = [{
              role: "assistant",
              text,
              toolCalls: message.toolSteps.map((step) => ({
                id: step.id,
                name: step.name,
                arguments: safeParseArguments(step.argumentsJson),
              })),
            }];
            for (const step of message.toolSteps) {
              requestMessages.push({
                role: "tool",
                text: step.result?.output ?? "",
                toolCallId: step.id,
                toolName: step.name,
              });
            }
            return requestMessages;
          }
          const requestMessage: StreamChatMessage = { role: message.role, text };
          if (index === lastIndex && message.role === "user" && message.imageId !== undefined) {
            const image =
              pendingImage?.id === message.imageId
                ? pendingImage
                : await servicesRef.current.repository.getImage(message.imageId);
            if (image !== undefined) requestMessage.imageDataUrl = await blobToDataUrl(image);
          }
          return [requestMessage];
        }),
      );
```

（`lastIndex` 沿用现有变量；`flatMap` 展平后内部数组。）模块底部加：

```typescript
function safeParseArguments(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
}
```

1. 返回对象追加：`agentEnabled`、`toggleAgent`、`approvePermission`、`pendingPermission: state.pendingPermission`。

- [ ] **Step 5: 运行确认通过**

Run: `npm run test:unit -- --run && npm run typecheck`
Expected: 全部通过（含既有 controller/reducer 测试零回归）

- [ ] **Step 6: 提交**

```bash
git add src/domain/chat.ts src/app/chat-reducer.ts src/app/use-chat-controller.ts src/app/chat-reducer.test.ts
git commit -m "feat(agent): 前端工具步骤状态机与控制器接线"
```

***

### Task 12: 前端 UI 与全量验证

**Files:**

- Modify: `src/components/MessageBubble.tsx`

- Create: `src/components/tools/PermissionCard.tsx`

- Modify: `src/styles/tool-card.css`（先 Glob 确认实际路径）

- Modify: `src/views/layout-types.ts`、`src/views/desktop/DesktopChatArea.tsx`

- Test: `src/components/chat-components.test.tsx`

- Create: `.agents/notes/proposed/architecture/2026-09-02-agent-kernel.md`

**Interfaces:**

- Consumes: Task 11 的 `ToolStep`、`pendingPermission`、`agentEnabled`/`toggleAgent`/`approvePermission`

- [ ] **Step 1: 更新 MessageBubble 测试（红）**

`chat-components.test.tsx`：旧 tool\_call 文本渲染用例更新为结构化 `toolSteps` 渲染断言（按该文件现有 message 构造 helper 风格）：

````typescript
it("assistant 消息按 toolSteps 渲染工具卡片", () => {
  const message = makeAssistantMessage({
    toolSteps: [
      { id: "call-1", name: "read_file", argumentsJson: '{"path":"a.ts"}', result: { output: "hi", isError: false, durationMs: 3 } },
    ],
  });
  render(<MessageBubble locale="zh-CN" message={message} />);
  expect(screen.getByText("read_file")).toBeInTheDocument();
});

it("旧格式 tool_call 文本不再解析为卡片（按纯文本渲染）", () => {
  const message = makeAssistantMessage({
    text: '```tool_call\n{"name":"read_file"}\n```',
  });
  render(<MessageBubble locale="zh-CN" message={message} />);
  expect(screen.queryByText("read_file")).not.toBeInTheDocument();
});
````

既有依赖 `parseMessageToolChunks` 行为的用例同步改写或删除。

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit -- --run src/components/chat-components.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 UI**

`MessageBubble.tsx`：

1. 删除 `ParsedContentChunk` 接口、`parseMessageToolChunks` 函数、`parsedChunks` memo。
2. 正文渲染改为 toolSteps 卡片区 + 单段文本：

```tsx
      {message.toolSteps !== undefined && message.toolSteps.length > 0 ? (
        <div className="message-bubble__tools">
          {message.toolSteps.map((step) => (
            <ToolCard
              isError={step.result?.isError}
              isRunning={step.result === undefined && message.status === "streaming"}
              key={step.id}
              args={safeParseArgs(step.argumentsJson)}
              output={step.result?.output}
              toolName={step.name}
            />
          ))}
        </div>
      ) : null}
```

文本区渲染改为 `<p>{displayText}</p>`（原 parsedChunks 分段循环删除）。模块底部 helper：

```typescript
function safeParseArgs(json: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
```

新建 `src/components/tools/PermissionCard.tsx`：

```tsx
import { ShieldAlert } from "lucide-react";

export interface PermissionCardProps {
  toolName: string;
  argumentsJson: string;
  onApprove: (sessionScope: boolean) => void;
  onDeny: () => void;
}

/** 写类工具的批准卡片（跟随 ToolCard 的硬编码中文现状，不入 i18n） */
export function PermissionCard({ toolName, argumentsJson, onApprove, onDeny }: PermissionCardProps) {
  return (
    <div aria-label="工具执行授权" className="permission-card" role="alertdialog">
      <div className="permission-card__header">
        <ShieldAlert size={16} />
        <span>八千代请求执行写操作</span>
      </div>
      <div className="permission-card__body">
        <p className="permission-card__tool">{toolName}</p>
        <pre className="permission-card__args">{argumentsJson}</pre>
      </div>
      <div className="permission-card__actions">
        <button className="permission-card__btn permission-card__btn--deny" onClick={onDeny} type="button">
          拒绝
        </button>
        <button className="permission-card__btn" onClick={() => onApprove(false)} type="button">
          批准一次
        </button>
        <button className="permission-card__btn permission-card__btn--primary" onClick={() => onApprove(true)} type="button">
          批准并本会话不再询问
        </button>
      </div>
    </div>
  );
}
```

样式追加到 ToolCard 所在样式文件（`.permission-card` 系列，视觉变量沿用 `.tool-card`）。

`DesktopChatArea.tsx`（props 从 App → DesktopLayout → DesktopChatArea 沿现有传递链接入 `agentEnabled`/`toggleAgent`/`pendingPermission`/`approvePermission`；`SharedViewProps` 在 `src/views/layout-types.ts` 中扩展）：

1. 消息列表渲染区（MessageBubble 列表后、输入区前）插入：

```tsx
      {pendingPermission !== undefined ? (
        <PermissionCard
          argumentsJson={pendingPermission.argumentsJson}
          toolName={pendingPermission.toolName}
          onApprove={(sessionScope) => {
            void approvePermission(pendingPermission.requestId, true, sessionScope);
          }}
          onDeny={() => {
            void approvePermission(pendingPermission.requestId, false);
          }}
        />
      ) : null}
```

1. 输入区工具栏（现有 webSearch 开关旁）加 Agent 开关（仅桌面显示，跟随该文件现有 toggle 按钮的类名约定）：

```tsx
          <button
            aria-label="Agent 模式开关"
            aria-pressed={agentEnabled}
            className={agentEnabled ? "desktop-toggle desktop-toggle--active" : "desktop-toggle"}
            onClick={toggleAgent}
            title="Agent 模式：八千代多步读写工作区"
            type="button"
          >
            Agent
          </button>
```

- [ ] **Step 4: 运行单测与静态检查**

Run: `npm run test:unit -- --run && npm run typecheck && npm run lint`
Expected: 全部通过

- [ ] **Step 5: 全量门禁**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run test:functions && npm run test:desktop`
Expected: 全部通过（functions 零改动应零回归）

- [ ] **Step 6: Agent Note**

按 `.agents/notes/README.md` 格式创建 `.agents/notes/proposed/architecture/2026-09-02-agent-kernel.md`：记录 Rust 侧循环架构（TurnExecutor 注入、ApprovalRegistry、CheckpointStore）、SSE 协议扩展（5 事件）、`/api/agent/approval` 控制通道、移除的三个历史遗留（文本协议/二轮汇报/max\_characters 截断）与决策依据（指向 `docs/PHASE1_AGENT_KERNEL_DESIGN.md` 与 `docs/plans/2026-09-02-phase1-agent-kernel.md`）。

- [ ] **Step 7: 文档同步与提交**

把 `docs/PHASE1_AGENT_KERNEL_DESIGN.md` 头部标注"已实施"、`docs/IDE_GAP_ANALYSIS.md` 的 A1-A4 条目标注完成。

```bash
git add src/components/MessageBubble.tsx src/components/tools/PermissionCard.tsx src/styles/ src/views/layout-types.ts src/views/desktop/DesktopChatArea.tsx src/components/chat-components.test.tsx .agents/notes/ docs/PHASE1_AGENT_KERNEL_DESIGN.md docs/IDE_GAP_ANALYSIS.md
git commit -m "feat(agent): 工具卡片结构化渲染、权限批准卡片与 Agent 模式开关"
```

***

## 执行注意（对所有任务）

1. **顺序依赖**：T1→T2→T3→T4/T5/T6（可并行）→T7/T8（可并行）→T9→T10→T11→T12。
2. **既有测试更新**：`chat-components.test.tsx` 的 MessageBubble 旧 tool 文本用例在 T12 更新；`gateway_tests.rs` 无 `parse_tool_call` 直接用例（已核查）。
3. **零回归红线**：`npm run test:functions` 与移动端 `MobileLayout` 渲染路径不得受影响（Agent 开关仅在桌面视图挂载；历史消息里旧    ` ```tool` \` 文本按普通文本渲染，不做数据迁移）。
4. **计划文件本身**：属于任务规划文档，全部任务完成验证后按仓库整洁规范删除或归档到 `.agents/notes/` 引用（提交历史中可追溯）。

