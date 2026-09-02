use crate::crypto::keys::KeyStore;
use crate::gateway::handle_chat_stream;
use crate::tools::WorkspaceManager;
use crate::types::ClientChatRequest;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{error, info};

#[derive(Clone)]
pub struct AppState {
    pub key_store: Arc<KeyStore>,
    pub workspace_manager: Arc<WorkspaceManager>,
    pub http_client: reqwest::Client,
    pub port: u16,
    pub approvals: Arc<crate::gateway::agent::permission::ApprovalRegistry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponse {
    pub authenticated: bool,
    pub remaining: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveKeyRequest {
    pub provider: String,
    pub key: String,
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
    let stream = handle_chat_stream(
        state.http_client,
        payload,
        state.key_store,
        state.workspace_manager,
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
    match state.key_store.set_key(&payload.provider, &payload.key) {
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

pub fn create_router(state: AppState, dist_path: PathBuf) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    let index_html = dist_path.join("index.html");
    let static_service = ServeDir::new(&dist_path).fallback(ServeFile::new(index_html));

    Router::new()
        .route(
            "/api/session",
            get(handle_session).post(handle_session).delete(handle_session),
        )
        .route("/api/chat", post(handle_chat))
        .route("/api/agent/approval", post(handle_agent_approval))
        .route("/api/keys", get(handle_list_keys).post(handle_save_key))
        .route("/api/keys/{provider}", delete(handle_delete_key))
        .fallback_service(static_service)
        .layer(cors)
        .with_state(state)
}

pub async fn start_local_server(
    key_store: Arc<KeyStore>,
    workspace_manager: Arc<WorkspaceManager>,
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

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let state = AppState {
        key_store,
        workspace_manager,
        http_client,
        port: selected_port,
        approvals: Arc::new(crate::gateway::agent::permission::ApprovalRegistry::new()),
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
