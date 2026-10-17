use crate::mcp::types::{
    JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, McpContentItem, McpServerConfig,
    McpTool, McpToolCallResult, McpTransportConfig,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

static REQUEST_COUNTER: AtomicI64 = AtomicI64::new(1);

fn next_request_id() -> i64 {
    REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst)
}

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(35);

/// 执行 Stdio 会话操作
pub struct StdioSession {
    child: tokio::process::Child,
    writer: tokio::process::ChildStdin,
    reader: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

impl StdioSession {
    pub async fn spawn(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self, String> {
        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args);
        for (k, v) in env {
            cmd.env(k, v);
        }

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 MCP 进程失败 '{}': {}", command, e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法获取子进程 stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法获取子进程 stdout".to_string())?;

        let reader = BufReader::new(stdout).lines();

        let mut session = Self {
            child,
            writer: stdin,
            reader,
        };

        // 执行 MCP 协议握手
        session.initialize().await?;

        Ok(session)
    }

    /// 发送 JSON-RPC 请求并等待匹配其 id 的响应
    pub async fn send_request(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let req_id = next_request_id();
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::Value::from(req_id),
            method: method.to_string(),
            params,
        };

        let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        line.push('\n');

        self.writer
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("写入子进程失败: {}", e))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("刷新子进程输入流失败: {}", e))?;

        let target_id = serde_json::Value::from(req_id);

        let timeout_fut = tokio::time::sleep(DEFAULT_TIMEOUT);
        tokio::pin!(timeout_fut);

        loop {
            tokio::select! {
                _ = &mut timeout_fut => {
                    return Err(format!("MCP 请求 '{}' 超时 ({}s)", method, DEFAULT_TIMEOUT.as_secs()));
                }
                next_line = self.reader.next_line() => {
                    match next_line {
                        Ok(Some(raw_line)) => {
                            let trimmed = raw_line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(trimmed) {
                                if resp.id == Some(target_id.clone()) {
                                    if let Some(err) = resp.error {
                                        return Err(format!("MCP 错误 {}: {}", err.code, err.message));
                                    }
                                    return Ok(resp.result.unwrap_or(serde_json::Value::Null));
                                }
                            }
                        }
                        Ok(None) => return Err("MCP 子进程输出已关闭".to_string()),
                        Err(e) => return Err(format!("读取 MCP 子进程失败: {}", e)),
                    }
                }
            }
        }
    }

    /// 发送 JSON-RPC 通知
    pub async fn send_notification(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };
        let mut line = serde_json::to_string(&notif).map_err(|e| e.to_string())?;
        line.push('\n');

        self.writer
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("写入子进程失败: {}", e))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("刷新子进程输入流失败: {}", e))?;
        Ok(())
    }

    /// 初始化握手
    async fn initialize(&mut self) -> Result<(), String> {
        let init_params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": "yachiyo-chat-desktop",
                "version": "0.1.0"
            }
        });

        let _ = self.send_request("initialize", Some(init_params)).await?;
        self.send_notification("notifications/initialized", None)
            .await?;
        Ok(())
    }

    /// 列出所有工具
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>, String> {
        let res = self.send_request("tools/list", Some(serde_json::json!({}))).await?;
        parse_tools_list(&res)
    }

    /// 调用工具
    pub async fn call_tool(
        &mut self,
        name: &str,
        args: &serde_json::Value,
    ) -> Result<McpToolCallResult, String> {
        let params = serde_json::json!({
            "name": name,
            "arguments": args
        });
        let res = self.send_request("tools/call", Some(params)).await?;
        parse_tool_call_result(&res)
    }

    pub async fn close(mut self) {
        let _ = self.child.kill().await;
    }
}

impl Drop for StdioSession {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// 解析 tools/list 结果
fn parse_tools_list(res: &serde_json::Value) -> Result<Vec<McpTool>, String> {
    let tools_val = res
        .get("tools")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "响应缺少 'tools' 列表".to_string())?;

    let mut list = Vec::new();
    for item in tools_val {
        if let Ok(tool) = serde_json::from_value::<McpTool>(item.clone()) {
            list.push(tool);
        }
    }
    Ok(list)
}

/// 解析 tools/call 结果
fn parse_tool_call_result(res: &serde_json::Value) -> Result<McpToolCallResult, String> {
    if let Ok(result) = serde_json::from_value::<McpToolCallResult>(res.clone()) {
        return Ok(result);
    }

    // 容错：直接包含文本字符串或其他格式
    if let Some(content) = res.get("content").and_then(|v| v.as_array()) {
        let mut items = Vec::new();
        for c in content {
            if let Ok(item) = serde_json::from_value::<McpContentItem>(c.clone()) {
                items.push(item);
            } else if let Some(t) = c.get("text").and_then(|t| t.as_str()) {
                items.push(McpContentItem::Text {
                    text: t.to_string(),
                });
            }
        }
        return Ok(McpToolCallResult {
            content: items,
            is_error: res.get("isError").and_then(|b| b.as_bool()).unwrap_or(false),
        });
    }

    Ok(McpToolCallResult {
        content: vec![McpContentItem::Text {
            text: res.to_string(),
        }],
        is_error: false,
    })
}

/// 基于 HTTP / SSE 的 MCP 会话
pub struct SseSession {
    client: reqwest::Client,
    post_url: String,
}

impl SseSession {
    pub async fn connect(
        url_str: &str,
        headers_map: &HashMap<String, String>,
        client: &reqwest::Client,
    ) -> Result<Self, String> {
        let mut headers = reqwest::header::HeaderMap::new();
        for (k, v) in headers_map {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                headers.insert(name, val);
            }
        }

        // 尝试以标准 SSE 握手连接
        let sse_res = client
            .get(url_str)
            .headers(headers.clone())
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        let mut post_url = url_str.to_string();

        if let Ok(mut resp) = sse_res {
            if resp.status().is_success() {
                // 读取首个数据块，寻找 event: endpoint 消息
                let mut buf = String::new();
                let read_fut = async {
                    while let Ok(Some(chunk)) = resp.chunk().await {
                        if let Ok(s) = std::str::from_utf8(&chunk) {
                            buf.push_str(s);
                            if buf.contains("\n\n") {
                                break;
                            }
                        }
                    }
                };

                let _ = tokio::time::timeout(Duration::from_secs(5), read_fut).await;

                // 解析 endpoint
                for line in buf.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("data:") {
                        let endpoint_data = trimmed[5..].trim();
                        if !endpoint_data.is_empty() {
                            if endpoint_data.starts_with("http://")
                                || endpoint_data.starts_with("https://")
                            {
                                post_url = endpoint_data.to_string();
                            } else if let Ok(base) = url::Url::parse(url_str) {
                                if let Ok(joined) = base.join(endpoint_data) {
                                    post_url = joined.to_string();
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }

        let mut session = Self {
            client: client.clone(),
            post_url,
        };

        // 执行握手
        session.initialize().await?;

        Ok(session)
    }

    async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let req_id = next_request_id();
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::Value::from(req_id),
            method: method.to_string(),
            params,
        };

        let res = self
            .client
            .post(&self.post_url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&req)
            .timeout(DEFAULT_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("发送 MCP HTTP 请求失败: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("MCP 服务端返回 HTTP {}: {}", status, err_text));
        }

        let json: JsonRpcResponse = res
            .json()
            .await
            .map_err(|e| format!("解析 MCP JSON-RPC 响应失败: {}", e))?;

        if let Some(err) = json.error {
            return Err(format!("MCP 错误 {}: {}", err.code, err.message));
        }

        Ok(json.result.unwrap_or(serde_json::Value::Null))
    }

    async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };

        let _ = self
            .client
            .post(&self.post_url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&notif)
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        Ok(())
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let init_params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": "yachiyo-chat-desktop",
                "version": "0.1.0"
            }
        });

        let _ = self.send_request("initialize", Some(init_params)).await?;
        let _ = self
            .send_notification("notifications/initialized", None)
            .await;
        Ok(())
    }

    pub async fn list_tools(&self) -> Result<Vec<McpTool>, String> {
        let res = self.send_request("tools/list", Some(serde_json::json!({}))).await?;
        parse_tools_list(&res)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        args: &serde_json::Value,
    ) -> Result<McpToolCallResult, String> {
        let params = serde_json::json!({
            "name": name,
            "arguments": args
        });
        let res = self.send_request("tools/call", Some(params)).await?;
        parse_tool_call_result(&res)
    }
}

/// 快速连接并列出指定配置的所有工具
pub async fn fetch_server_tools(
    config: &McpServerConfig,
    http_client: &reqwest::Client,
) -> Result<Vec<McpTool>, String> {
    match &config.transport {
        McpTransportConfig::Stdio { command, args, env } => {
            let mut session = StdioSession::spawn(command, args, env).await?;
            let tools = session.list_tools().await?;
            session.close().await;
            Ok(tools)
        }
        McpTransportConfig::Sse { url, headers } => {
            let session = SseSession::connect(url, headers, http_client).await?;
            session.list_tools().await
        }
    }
}

/// 执行单次工具调用
pub async fn execute_server_tool(
    config: &McpServerConfig,
    tool_name: &str,
    args: &serde_json::Value,
    http_client: &reqwest::Client,
) -> Result<McpToolCallResult, String> {
    match &config.transport {
        McpTransportConfig::Stdio { command, args: cmd_args, env } => {
            let mut session = StdioSession::spawn(command, cmd_args, env).await?;
            let res = session.call_tool(tool_name, args).await?;
            session.close().await;
            Ok(res)
        }
        McpTransportConfig::Sse { url, headers } => {
            let session = SseSession::connect(url, headers, http_client).await?;
            session.call_tool(tool_name, args).await
        }
    }
}
