use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

#[derive(Debug, Deserialize)]
pub struct InboundHttpRequest {
    pub r#type: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OutboundResponseStart {
    pub r#type: &'static str,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub status: u16,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct OutboundResponseChunk {
    pub r#type: &'static str,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub data: String,
}

#[derive(Debug, Serialize)]
pub struct OutboundResponseEnd {
    pub r#type: &'static str,
    #[serde(rename = "requestId")]
    pub request_id: String,
}

pub struct RelayClient {
    relay_url: String,
    device_id: String,
    device_key: String,
    local_port: u16,
    is_running: Arc<AtomicBool>,
}

impl RelayClient {
    pub fn new(
        relay_url: String,
        device_id: String,
        device_key: String,
        local_port: u16,
    ) -> Self {
        Self {
            relay_url,
            device_id,
            device_key,
            local_port,
            is_running: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    pub async fn start_loop(&self) {
        let mut backoff = Duration::from_secs(2);
        let max_backoff = Duration::from_secs(60);

        while self.is_running.load(Ordering::SeqCst) {
            info!("Connecting to Cloudflare Relay DO at {}...", self.relay_url);

            let ws_req = match Request::builder()
                .uri(&self.relay_url)
                .header("x-device-id", &self.device_id)
                .header("x-device-key", &self.device_key)
                .header("Host", url::Url::parse(&self.relay_url).map(|u| u.host_str().unwrap_or("").to_string()).unwrap_or_default())
                .header("Upgrade", "websocket")
                .header("Connection", "Upgrade")
                .header("Sec-WebSocket-Key", tokio_tungstenite::tungstenite::handshake::client::generate_key())
                .header("Sec-WebSocket-Version", "13")
                .body(())
            {
                Ok(r) => r,
                Err(e) => {
                    error!("Invalid WebSocket URI: {}", e);
                    tokio::time::sleep(backoff).await;
                    continue;
                }
            };

            match connect_async(ws_req).await {
                Ok((ws_stream, _)) => {
                    info!("Successfully connected to Cloudflare Relay!");
                    backoff = Duration::from_secs(2);

                    let (mut write, mut read) = ws_stream.split();
                    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(128);

                    // Forward outbound messages from local handler to WebSocket
                    let write_task = tokio::spawn(async move {
                        while let Some(msg) = rx.recv().await {
                            if let Err(e) = write.send(Message::Text(msg.into())).await {
                                warn!("WebSocket send error: {}", e);
                                break;
                            }
                        }
                    });

                    let http_client = reqwest::Client::new();
                    let local_base = format!("http://127.0.0.1:{}", self.local_port);

                    while let Some(msg_res) = read.next().await {
                        match msg_res {
                            Ok(Message::Text(text)) => {
                                if let Ok(inbound) = serde_json::from_str::<InboundHttpRequest>(&text) {
                                    let tx_clone = tx.clone();
                                    let client_clone = http_client.clone();
                                    let url_clone = format!("{}{}", local_base, inbound.url);

                                    tokio::spawn(async move {
                                        Self::handle_inbound_request(
                                            client_clone,
                                            inbound,
                                            url_clone,
                                            tx_clone,
                                        )
                                        .await;
                                    });
                                }
                            }
                            Ok(Message::Ping(_)) => {
                                let _ = tx.send(serde_json::to_string(&serde_json::json!({ "type": "pong" })).unwrap()).await;
                            }
                            Ok(Message::Close(_)) => {
                                info!("Relay closed connection");
                                break;
                            }
                            Err(e) => {
                                warn!("WebSocket connection error: {}", e);
                                break;
                            }
                            _ => {}
                        }
                    }

                    write_task.abort();
                }
                Err(e) => {
                    warn!("Failed to connect to relay (will retry in {:?}): {}", backoff, e);
                }
            }

            tokio::time::sleep(backoff).await;
            backoff = std::cmp::min(backoff * 2, max_backoff);
        }
    }

    async fn handle_inbound_request(
        client: reqwest::Client,
        inbound: InboundHttpRequest,
        target_url: String,
        tx: tokio::sync::mpsc::Sender<String>,
    ) {
        let method = match inbound.method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "DELETE" => reqwest::Method::DELETE,
            _ => reqwest::Method::GET,
        };

        let mut req_builder = client.request(method, &target_url);
        for (k, v) in inbound.headers {
            if !k.eq_ignore_ascii_case("host") {
                req_builder = req_builder.header(&k, &v);
            }
        }

        if let Some(body) = inbound.body {
            req_builder = req_builder.body(body);
        }

        let res = match req_builder.send().await {
            Ok(r) => r,
            Err(e) => {
                let start = OutboundResponseStart {
                    r#type: "http_response_start",
                    request_id: inbound.request_id.clone(),
                    status: 502,
                    headers: HashMap::new(),
                };
                let _ = tx.send(serde_json::to_string(&start).unwrap()).await;
                let chunk = OutboundResponseChunk {
                    r#type: "http_response_chunk",
                    request_id: inbound.request_id.clone(),
                    data: format!("Gateway Error: {}", e),
                };
                let _ = tx.send(serde_json::to_string(&chunk).unwrap()).await;
                let end = OutboundResponseEnd {
                    r#type: "http_response_end",
                    request_id: inbound.request_id,
                };
                let _ = tx.send(serde_json::to_string(&end).unwrap()).await;
                return;
            }
        };

        let status = res.status().as_u16();
        let mut resp_headers = HashMap::new();
        for (k, v) in res.headers() {
            if let Ok(v_str) = v.to_str() {
                resp_headers.insert(k.to_string(), v_str.to_string());
            }
        }

        let start_msg = OutboundResponseStart {
            r#type: "http_response_start",
            request_id: inbound.request_id.clone(),
            status,
            headers: resp_headers,
        };
        let _ = tx.send(serde_json::to_string(&start_msg).unwrap()).await;

        let mut stream = res.bytes_stream();
        while let Some(chunk_res) = stream.next().await {
            if let Ok(chunk) = chunk_res {
                if let Ok(text) = std::str::from_utf8(&chunk) {
                    let chunk_msg = OutboundResponseChunk {
                        r#type: "http_response_chunk",
                        request_id: inbound.request_id.clone(),
                        data: text.to_string(),
                    };
                    let _ = tx.send(serde_json::to_string(&chunk_msg).unwrap()).await;
                }
            }
        }

        let end_msg = OutboundResponseEnd {
            r#type: "http_response_end",
            request_id: inbound.request_id,
        };
        let _ = tx.send(serde_json::to_string(&end_msg).unwrap()).await;
    }
}
