use crate::crypto::keys::KeyStore;
use crate::gateway::handle_chat_stream;
use crate::tools::WorkspaceManager;
use crate::types::ClientChatRequest;
use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info};

/// 本地网关鉴权头名。前端 `api-origins.ts` 以同名常量注入，任一侧改名都会导致全量 401
pub const GATEWAY_TOKEN_HEADER: &str = "x-yachiyo-gateway-token";

/// 随机 token 的字节数（hex 编码后为 64 字符）
const GATEWAY_TOKEN_BYTES: usize = 32;

/// vite 开发服务器源：`vite.config.ts` 把 `/api` 代理到本网关，代理会原样转发 Origin
const DEV_SERVER_ORIGINS: [&str; 2] = ["http://127.0.0.1:5173", "http://localhost:5173"];

/// Tauri 生产 webview 源：Windows 走 `http://tauri.localhost`，macOS/Linux 走 `tauri://localhost`
const WEBVIEW_ORIGINS: [&str; 2] = ["http://tauri.localhost", "tauri://localhost"];

#[derive(Clone)]
pub struct AppState {
    pub key_store: Arc<KeyStore>,
    pub workspace_manager: Arc<WorkspaceManager>,
    pub http_client: reqwest::Client,
    pub direct_client: reqwest::Client,
    pub port: u16,
    pub token: String,
    pub approvals: Arc<crate::gateway::agent::permission::ApprovalRegistry>,
    pub mcp_manager: Arc<crate::mcp::McpManager>,
    pub runs: Arc<crate::gateway::agent::run_registry::RunRegistry>,
}

/// 判断提供商是否属于国内大模型服务商（智谱 GLM、DeepSeek、阶跃星辰 Stepfun）
/// 其服务部署在中国大陆境内，在开启网络代理（尤其是全局代理或未分流规则）时，
/// 极易被代理拦截出海导致高延迟或被境外 WAF 阻断，因此优先使用直连客户端。
pub fn is_domestic_provider(provider: crate::types::ProviderId) -> bool {
    matches!(
        provider,
        crate::types::ProviderId::Glm
            | crate::types::ProviderId::Deepseek
            | crate::types::ProviderId::Stepfun
    )
}

impl AppState {
    /// 依据服务商选择主用和备用客户端：
    /// - 国内模型优先使用强制直连（no_proxy）客户端，以代理客户端作为备选重试；
    /// - 海外模型（OpenAI/Claude/Gemini）优先使用代理客户端，以直连客户端作为备选重试；
    /// - 自定义端点按主机归属判断，火山、百炼等国内厂商卡片虽映射到 OpenAI 也走直连优先。
    pub fn select_clients(
        &self,
        provider: Option<crate::types::ProviderId>,
        base_url: Option<&str>,
    ) -> (reqwest::Client, Option<reqwest::Client>) {
        let provider = provider.unwrap_or(crate::types::ProviderId::Stepfun);
        let domestic = match base_url {
            Some(base_url) => crate::gateway::providers::compat_vendor::is_domestic_endpoint(base_url),
            None => is_domestic_provider(provider),
        };
        if domestic {
            (self.direct_client.clone(), Some(self.http_client.clone()))
        } else {
            (self.http_client.clone(), Some(self.direct_client.clone()))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponse {
    pub authenticated: bool,
    pub remaining: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveKeyRequest {
    /// 密钥槽名：厂商名，或同一厂商多条配置时的“厂商名~后缀”
    pub provider: String,
    pub key: String,
    /// Key 所属的自定义端点；省略表示厂商原生端点。网关只会把 Key 发往保存时绑定的端点
    #[serde(rename = "baseUrl", default)]
    pub base_url: Option<String>,
}

/// 生成进程级随机网关 token：随桌面进程启动一次，经 IPC 交给 webview。
/// 网关只监听 127.0.0.1，但本机任意进程与浏览器都能连上，故以不可猜测的高熵 token
/// 上游连续无数据超过该时长才判定断流；推理模型排队或长思考期间仍会持续推送数据或心跳注释
pub const UPSTREAM_READ_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// 网关上游客户端。一次流式回复（长思考 + 长输出）常超过两分钟，reqwest 的 `timeout`
/// 是覆盖读完整个响应体的总时限，会把正常的长回复拦腰切断，因此只限制建连与读取空闲
pub fn gateway_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(UPSTREAM_READ_IDLE_TIMEOUT)
}

/// 区分「本应用发起的请求」与「同机其他来源发起的请求」。
pub fn generate_gateway_token() -> String {
    let mut buf = [0u8; GATEWAY_TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 恒定时间比较：`==` 会在首个相异字节处短路返回，攻击者可据响应时延逐字节猜出 token；
/// 此处逐字节异或累积，判定耗时只与长度相关而不与匹配前缀相关。
fn constant_time_eq(provided: &[u8], expected: &[u8]) -> bool {
    if provided.len() != expected.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in provided.iter().zip(expected.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

async fn handle_session() -> impl IntoResponse {
    Json(SessionResponse {
        authenticated: true,
        remaining: 9999,
    })
}

async fn handle_chat(
    State(state): State<AppState>,
    Json(payload): Json<ClientChatRequest>,
) -> Response {
    let (primary_client, fallback_client) =
        state.select_clients(payload.provider, payload.base_url.as_deref());
    let stream = handle_chat_stream(
        primary_client,
        fallback_client,
        payload,
        state.key_store,
        state.workspace_manager,
        Arc::clone(&state.approvals),
        Arc::clone(&state.mcp_manager),
        Arc::clone(&state.runs),
    );
    let body_stream = stream.map(|res| match res {
        Ok(s) => Ok::<_, axum::Error>(axum::body::Bytes::from(s)),
        Err(e) => Err(e),
    });

    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(body_stream))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Stream initialization failed").into_response())
}

async fn handle_list_keys(State(state): State<AppState>) -> impl IntoResponse {
    let providers = state.key_store.list_configured_providers();
    Json(serde_json::json!({ "configuredProviders": providers }))
}

async fn handle_save_key(
    State(state): State<AppState>,
    Json(payload): Json<SaveKeyRequest>,
) -> impl IntoResponse {
    if !crate::crypto::keys::is_valid_slot(&payload.provider) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid key slot" })));
    }
    if let Some(base_url) = payload.base_url.as_deref() {
        if !crate::gateway::providers::openai_compat::is_valid_base_url(base_url) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid baseUrl" })));
        }
    }
    match state.key_store.set_key_for_endpoint(&payload.provider, &payload.key, payload.base_url.as_deref()) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn handle_delete_key(
    State(state): State<AppState>,
    Path(provider): Path<String>,
) -> impl IntoResponse {
    match state.key_store.delete_key(&provider) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

const DEEPSEEK_BALANCE_URL: &str = "https://api.deepseek.com/user/balance";

fn balance_problem(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": { "code": code } }))).into_response()
}

/// 余额小鲸鱼插件的 DeepSeek 余额代理：Key 只在网关内取用且仅发往原生端点，
/// 成功时原样返回 /user/balance 的 JSON；错误体与网页版 Pages Function 同为
/// `{ error: { code } }`，前端共用一套解析
#[derive(Deserialize)]
struct ReasoningLevelsRequest {
    provider: crate::types::ProviderId,
    model: String,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
}

/// 对话框思考档位选择器的数据源：模型可选档位（由浅到深）与不指定时的默认档；不支持调节时 levels 为空
async fn handle_reasoning_levels(Json(request): Json<ReasoningLevelsRequest>) -> impl IntoResponse {
    let support = crate::gateway::providers::reasoning::reasoning_support(
        request.provider,
        request.base_url.as_deref(),
        &request.model,
    );
    Json(match support {
        Some(support) => serde_json::json!({
            "levels": support.levels.iter().map(|(level, _)| *level).collect::<Vec<_>>(),
            "defaultLevel": support.default,
        }),
        None => serde_json::json!({ "levels": [] }),
    })
}

async fn handle_deepseek_balance(State(state): State<AppState>) -> Response {
    let Some(key) = state.key_store.native_key_for_provider("deepseek") else {
        return balance_problem(StatusCode::BAD_REQUEST, "API_KEY_MISSING");
    };
    let (primary, fallback) = state.select_clients(Some(crate::types::ProviderId::Deepseek), None);
    let send = |client: reqwest::Client| {
        let key = key.clone();
        async move {
            client
                .get(DEEPSEEK_BALANCE_URL)
                .bearer_auth(key)
                .header(header::ACCEPT, "application/json")
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
        }
    };
    // 只在连接层失败时换客户端重试：HTTP 错误说明请求已到达 DeepSeek，换线路无益
    let upstream = match send(primary).await {
        Ok(response) => Ok(response),
        Err(error) => match fallback {
            Some(client) => send(client).await,
            None => Err(error),
        },
    };
    let upstream = match upstream {
        Ok(response) => response,
        Err(_) => return balance_problem(StatusCode::BAD_GATEWAY, "PROVIDER_ERROR"),
    };
    let status = upstream.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return balance_problem(StatusCode::UNAUTHORIZED, "PROVIDER_AUTH_FAILED");
    }
    if !status.is_success() {
        return balance_problem(StatusCode::BAD_GATEWAY, "PROVIDER_ERROR");
    }
    match upstream.json::<serde_json::Value>().await {
        Ok(body) => Json(body).into_response(),
        Err(_) => balance_problem(StatusCode::BAD_GATEWAY, "PROVIDER_ERROR"),
    }
}

#[derive(Deserialize)]
struct ListModelsRequest {
    #[serde(rename = "baseUrl")]
    base_url: String,
    /// 表单里刚输入的 Key；省略时用 slot 对应配置已保存的 Key
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    slot: Option<String>,
}

/// OpenAI 兼容端点的模型列表地址：与对话端点同样剥掉尾部斜杠后拼接
fn models_endpoint(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

/// 解析 `/models` 响应的 `data[].id`，去重并按字母序排列
fn parse_model_ids(body: &serde_json::Value) -> Vec<String> {
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// 自定义模型表单的模型列表代理：webview 直连第三方端点受 CORS 限制，且已保存的 Key 只在网关内；
/// 沿用已存 Key 时同样只发往该配置保存时绑定的端点
async fn handle_list_models(
    State(state): State<AppState>,
    Json(request): Json<ListModelsRequest>,
) -> Response {
    let base_url = request.base_url.trim();
    if !crate::gateway::providers::openai_compat::is_valid_base_url(base_url) {
        return balance_problem(StatusCode::BAD_REQUEST, "INVALID_BASE_URL");
    }
    let typed_key = request.key.as_deref().map(str::trim).filter(|key| !key.is_empty());
    let key = match typed_key {
        Some(key) => Some(key.to_string()),
        None => request
            .slot
            .as_deref()
            .and_then(|slot| state.key_store.get_key_for_endpoint(slot, Some(base_url))),
    };
    let Some(key) = key else {
        return balance_problem(StatusCode::BAD_REQUEST, "API_KEY_MISSING");
    };
    let url = models_endpoint(base_url);
    let (primary, fallback) = state.select_clients(None, Some(base_url));
    let send = |client: reqwest::Client| {
        let key = key.clone();
        let url = url.clone();
        async move {
            client
                .get(url)
                .bearer_auth(key)
                .header(header::ACCEPT, "application/json")
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
        }
    };
    // 只在连接层失败时换客户端重试：HTTP 错误说明请求已到达上游，换线路无益
    let upstream = match send(primary).await {
        Ok(response) => Ok(response),
        Err(error) => match fallback {
            Some(client) => send(client).await,
            None => Err(error),
        },
    };
    let upstream = match upstream {
        Ok(response) => response,
        Err(_) => return balance_problem(StatusCode::BAD_GATEWAY, "PROVIDER_ERROR"),
    };
    let status = upstream.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return balance_problem(StatusCode::UNAUTHORIZED, "PROVIDER_AUTH_FAILED");
    }
    if !status.is_success() {
        return balance_problem(StatusCode::BAD_GATEWAY, "PROVIDER_ERROR");
    }
    match upstream.json::<serde_json::Value>().await {
        Ok(body) => Json(serde_json::json!({ "models": parse_model_ids(&body) })).into_response(),
        Err(_) => balance_problem(StatusCode::BAD_GATEWAY, "PROVIDER_ERROR"),
    }
}

#[derive(Debug, Deserialize)]
pub struct AgentApprovalRequest {
    /// 审批所属运行：只有仍在执行且未取消的运行才接受审批
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(default)]
    pub approved: bool,
    #[serde(rename = "sessionScope", default)]
    pub session_scope: bool,
    pub decision: Option<crate::gateway::agent::permission::ApprovalChoice>,
}

async fn handle_agent_approval(
    State(state): State<AppState>,
    Json(payload): Json<AgentApprovalRequest>,
) -> impl IntoResponse {
    use crate::gateway::agent::permission::{ApprovalChoice, ApprovalDecision};
    // 取消之后迟到的批准、或编号与运行不符的批准一律拒绝，不能让旧审批重新触发执行
    if !state.runs.accepts_approval(&payload.run_id, &payload.request_id) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Run is not active or the request does not belong to it" })),
        );
    }
    let decision = match payload.decision {
        Some(ApprovalChoice::Once) => ApprovalDecision { approved: true, session_scope: false },
        Some(ApprovalChoice::Always) => ApprovalDecision { approved: true, session_scope: true },
        Some(ApprovalChoice::Deny) => ApprovalDecision { approved: false, session_scope: false },
        None => ApprovalDecision { approved: payload.approved, session_scope: payload.approved && payload.session_scope },
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

/// 网关内仍在执行的运行（含 SSE 已断开、仍在收尾的运行）及其正在执行的命令
async fn handle_list_agent_runs(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({ "runs": state.runs.list() }))
}

/// 请求取消运行：返回时运行进入“正在取消”，命令终止并确认后运行才以 cancelled 结束
async fn handle_cancel_agent_run(State(state): State<AppState>, Path(run_id): Path<String>) -> Response {
    match state.runs.cancel(&run_id) {
        Some(snapshot) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "run": snapshot }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Run is not active" }))).into_response(),
    }
}

/// 运行的状态：活跃、已结束（事件可能仍可回填）或从运行记录得知的结局（重启后仍为运行中的记录报告为被中断）
async fn handle_agent_run_state(State(state): State<AppState>, Path(run_id): Path<String>) -> Response {
    match state.runs.state(&run_id) {
        Some(run) => (StatusCode::OK, Json(serde_json::json!({ "state": run }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "RUN_UNKNOWN" }))).into_response(),
    }
}

#[derive(Deserialize)]
struct RunEventsQuery {
    #[serde(default)]
    after: u64,
}

/// 重新连接运行的事件流：从 after 之后回填，再实时推送，直到运行结束。
/// 事件日志已不在内存中时返回 404 与运行状态，客户端据此标记结局，不重放任何操作
async fn handle_agent_run_events(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<RunEventsQuery>,
) -> Response {
    let Some(control) = state.runs.lookup(&run_id) else {
        let body = match state.runs.state(&run_id) {
            Some(run) => serde_json::json!({ "error": "RUN_EVENTS_UNAVAILABLE", "state": run }),
            None => serde_json::json!({ "error": "RUN_UNKNOWN" }),
        };
        return (StatusCode::NOT_FOUND, Json(body)).into_response();
    };
    let body_stream = crate::gateway::agent::run_events::subscribe(Arc::clone(&control.events), query.after)
        .map(|res| res.map(axum::body::Bytes::from));
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(body_stream))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Stream initialization failed").into_response())
}

#[derive(Deserialize)]
struct AgentSupplementRequest {
    id: String,
    text: String,
}

/// 运行中追加补充要求：排队等待下一次调用模型前送达；运行已结束、取消或正在收尾时返回 409
async fn handle_supplement_agent_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(payload): Json<AgentSupplementRequest>,
) -> Response {
    use crate::gateway::agent::run_registry::{Supplement, SupplementRejected};
    match state.runs.supplement(&run_id, Supplement { id: payload.id, text: payload.text }) {
        Ok(()) => (StatusCode::ACCEPTED, Json(serde_json::json!({ "status": "queued" }))).into_response(),
        Err(reason) => {
            let status = if reason == SupplementRejected::Invalid { StatusCode::BAD_REQUEST } else { StatusCode::CONFLICT };
            (status, Json(serde_json::json!({ "error": reason.code() }))).into_response()
        }
    }
}

/// 按工具调用停止命令（界面在命令产生输出前即可停止）
async fn handle_stop_agent_call(
    State(state): State<AppState>,
    Path((run_id, call_id)): Path<(String, String)>,
) -> Response {
    if state.runs.stop_call(&run_id, &call_id) {
        (StatusCode::ACCEPTED, Json(serde_json::json!({ "success": true }))).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Command is not running" }))).into_response()
    }
}

/// 只停止运行中的某条命令，运行继续，模型收到命令被停止的结果
async fn handle_stop_agent_process(
    State(state): State<AppState>,
    Path((run_id, execution_id)): Path<(String, String)>,
) -> Response {
    if state.runs.stop_process(&run_id, &execution_id) {
        (StatusCode::ACCEPTED, Json(serde_json::json!({ "success": true }))).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Process is not running" }))).into_response()
    }
}

#[derive(Deserialize)]
struct ToggleServerRequest {
    enabled: bool,
}

#[derive(Deserialize)]
struct ImportConfigRequest {
    json: String,
}

async fn handle_list_mcp_servers(State(state): State<AppState>) -> impl IntoResponse {
    let servers = state.mcp_manager.list_servers();
    Json(serde_json::json!({ "servers": servers }))
}

async fn handle_save_mcp_server(
    State(state): State<AppState>,
    Json(payload): Json<crate::mcp::McpServerConfig>,
) -> impl IntoResponse {
    match state.mcp_manager.save_server(payload) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn handle_delete_mcp_server(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.mcp_manager.delete_server(&id) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn handle_toggle_mcp_server(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ToggleServerRequest>,
) -> impl IntoResponse {
    match state.mcp_manager.toggle_server(&id, payload.enabled) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn handle_test_mcp_server(
    State(state): State<AppState>,
    Json(payload): Json<crate::mcp::McpServerConfig>,
) -> impl IntoResponse {
    match state.mcp_manager.test_server_connection(&payload).await {
        Ok(tools) => (
            StatusCode::OK,
            Json(serde_json::json!({ "success": true, "tools": tools })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn handle_import_mcp_config(
    State(state): State<AppState>,
    Json(payload): Json<ImportConfigRequest>,
) -> impl IntoResponse {
    match state.mcp_manager.import_claude_config(&payload.json) {
        Ok(count) => (
            StatusCode::OK,
            Json(serde_json::json!({ "success": true, "count": count })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn handle_export_mcp_config(State(state): State<AppState>) -> impl IntoResponse {
    match state.mcp_manager.export_claude_config() {
        Ok(config_json) => (
            StatusCode::OK,
            Json(serde_json::json!({ "success": true, "config": config_json })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

/// `/api/*` 的 token 门禁：校验不通过时在流式响应开始之前直接返回 401
async fn require_gateway_token(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let provided = request
        .headers()
        .get(GATEWAY_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    if !constant_time_eq(provided.as_bytes(), state.token.as_bytes()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Missing or invalid gateway token" })),
        )
            .into_response();
    }

    next.run(request).await
}

/// 显式允许的跨域源。网关端口在 28888 起浮动，故按实际选中端口动态构造。
fn allowed_origins(port: u16) -> Vec<HeaderValue> {
    let gateway = [
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
    ];
    gateway
        .iter()
        .map(String::as_str)
        .chain(DEV_SERVER_ORIGINS)
        .chain(WEBVIEW_ORIGINS)
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect()
}

pub fn create_router(state: AppState, dist_path: PathBuf) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins(state.port)))
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(AllowHeaders::list(vec![
            header::CONTENT_TYPE,
            HeaderName::from_static(GATEWAY_TOKEN_HEADER),
        ]));

    let index_html = dist_path.join("index.html");
    let static_service = ServeDir::new(&dist_path).fallback(ServeFile::new(index_html));

    Router::new()
        .route(
            "/api/session",
            get(handle_session).post(handle_session).delete(handle_session),
        )
        .route("/api/chat", post(handle_chat))
        .route("/api/agent/approval", post(handle_agent_approval))
        .route("/api/agent/runs", get(handle_list_agent_runs))
        .route("/api/agent/runs/{run_id}", get(handle_agent_run_state))
        .route("/api/agent/runs/{run_id}/events", get(handle_agent_run_events))
        .route("/api/agent/runs/{run_id}/cancel", post(handle_cancel_agent_run))
        .route("/api/agent/runs/{run_id}/supplements", post(handle_supplement_agent_run))
        .route("/api/agent/runs/{run_id}/processes/{execution_id}/stop", post(handle_stop_agent_process))
        .route("/api/agent/runs/{run_id}/calls/{call_id}/stop", post(handle_stop_agent_call))
        .route("/api/keys", get(handle_list_keys).post(handle_save_key))
        .route("/api/keys/{provider}", delete(handle_delete_key))
        .route("/api/deepseek/balance", post(handle_deepseek_balance))
        .route("/api/reasoning/levels", post(handle_reasoning_levels))
        .route("/api/models", post(handle_list_models))
        .route("/api/mcp/servers", get(handle_list_mcp_servers).post(handle_save_mcp_server))
        .route("/api/mcp/servers/{id}", delete(handle_delete_mcp_server))
        .route("/api/mcp/servers/{id}/toggle", post(handle_toggle_mcp_server))
        .route("/api/mcp/test", post(handle_test_mcp_server))
        .route("/api/mcp/import", post(handle_import_mcp_config))
        .route("/api/mcp/export", get(handle_export_mcp_config))
        // route_layer 只包裹已注册的 /api 路由，静态资源 fallback 不受 token 约束
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_gateway_token,
        ))
        .fallback_service(static_service)
        .layer(cors)
        .with_state(state)
}

pub async fn start_local_server(
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
    mcp_manager: Arc<crate::mcp::McpManager>,
    gateway_token: String,
    preferred_port: u16,
) -> Result<(u16, tokio::task::JoinHandle<()>), String> {
    let dist_path = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("dist");

    let mut selected_port = preferred_port;
    let mut listener = None;

    for offset in 0..10 {
        let port = preferred_port + offset;
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                selected_port = port;
                listener = Some(l);
                break;
            }
            Err(_) => continue,
        }
    }

    let listener = match listener {
        Some(l) => l,
        None => return Err(format!("Could not bind to any port in range {}-{}", preferred_port, preferred_port + 10)),
    };

    let http_client = gateway_client_builder().build().unwrap_or_default();

    let direct_client = gateway_client_builder().no_proxy().build().unwrap_or_default();

    let run_records = key_store.storage_dir().join("run-records");
    let state = AppState {
        key_store,
        workspace_manager,
        http_client,
        direct_client,
        port: selected_port,
        token: gateway_token,
        approvals: Arc::new(crate::gateway::agent::permission::ApprovalRegistry::with_storage(
            crate::crypto::keys::dirs_storage_path().join("agent-approvals.json"),
        )),
        mcp_manager,
        runs: Arc::new(crate::gateway::agent::run_registry::RunRegistry::with_records(run_records)),
    };

    let app = create_router(state, dist_path);

    info!("Yachiyo local server listening on http://127.0.0.1:{}", selected_port);

    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!("Local server error: {}", e);
        }
    });

    Ok((selected_port, handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_token_is_high_entropy_hex() {
        let token = generate_gateway_token();
        assert_eq!(token.len(), GATEWAY_TOKEN_BYTES * 2);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(token, generate_gateway_token(), "两次启动不得产生同一 token");
    }

    #[test]
    fn constant_time_eq_matches_only_on_equal_bytes() {
        assert!(constant_time_eq(b"abcd", b"abcd"));
        assert!(constant_time_eq(b"", b""));
        assert!(!constant_time_eq(b"abcd", b"abce"));
        // 长度不同直接判否：token 形态固定，长度差异本身即不匹配
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"abcd", b""));
    }

    #[test]
    fn allowed_origins_covers_gateway_dev_and_webview() {
        let origins = allowed_origins(28890)
            .iter()
            .map(|value| value.to_str().unwrap().to_string())
            .collect::<Vec<_>>();
        for expected in [
            "http://127.0.0.1:28890",
            "http://localhost:28890",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://tauri.localhost",
            "tauri://localhost",
        ] {
            assert!(origins.iter().any(|o| o == expected), "缺少允许源: {}", expected);
        }
    }

    #[test]
    fn models_endpoint_strips_trailing_slash() {
        assert_eq!(models_endpoint("https://api.example.com/v1/"), "https://api.example.com/v1/models");
        assert_eq!(models_endpoint("https://api.example.com/v1"), "https://api.example.com/v1/models");
    }

    #[test]
    fn parse_model_ids_sorts_dedups_and_skips_invalid() {
        let body = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "qwen-turbo" },
                { "id": "gpt-4o" },
                { "id": " " },
                { "name": "no-id" },
                { "id": 42 },
                { "id": "gpt-4o" }
            ]
        });
        assert_eq!(parse_model_ids(&body), vec!["gpt-4o", "qwen-turbo"]);
        assert!(parse_model_ids(&serde_json::json!({ "models": [] })).is_empty());
    }

    #[test]
    fn domestic_provider_classification() {
        use crate::types::ProviderId;
        assert!(is_domestic_provider(ProviderId::Glm));
        assert!(is_domestic_provider(ProviderId::Deepseek));
        assert!(is_domestic_provider(ProviderId::Stepfun));

        assert!(!is_domestic_provider(ProviderId::Openai));
        assert!(!is_domestic_provider(ProviderId::Claude));
        assert!(!is_domestic_provider(ProviderId::Gemini));
    }
}
