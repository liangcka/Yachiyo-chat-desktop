pub mod crypto;
pub mod gateway;
pub mod server;
pub mod tools;
pub mod types;

use crypto::keys::KeyStore;
use server::http::start_local_server;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
use tools::WorkspaceManager;
use tracing::info;

pub struct DesktopState {
    pub key_store: Arc<KeyStore>,
    pub workspace_manager: Arc<WorkspaceManager>,
    pub http_client: reqwest::Client,
    pub server_port: AtomicU16,
}

#[tauri::command]
fn get_server_port(state: State<DesktopState>) -> u16 {
    state.server_port.load(Ordering::SeqCst)
}

#[tauri::command]
fn list_configured_keys(state: State<DesktopState>) -> Vec<String> {
    state.key_store.list_configured_providers()
}

#[tauri::command]
fn save_api_key(state: State<DesktopState>, provider: String, key: String) -> Result<(), String> {
    state.key_store.set_key(&provider, &key)
}

#[tauri::command]
fn delete_api_key(state: State<DesktopState>, provider: String) -> Result<(), String> {
    state.key_store.delete_key(&provider)
}

#[tauri::command]
fn get_workspace_root(state: State<DesktopState>) -> String {
    state.workspace_manager.get_workspace_root().to_string_lossy().to_string()
}

#[tauri::command]
fn set_workspace_root(state: State<DesktopState>, path: String) -> Result<(), String> {
    state.workspace_manager.set_workspace_root(PathBuf::from(path))
}

#[tauri::command]
async fn execute_agent_tool(
    state: State<'_, DesktopState>,
    name: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let root = state.workspace_manager.get_workspace_root();
    tools::execute_tool(&name, &arguments, &root, &state.http_client).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    info!("Starting Yachiyo Desktop App...");

    let key_store = Arc::new(KeyStore::new());
    let workspace_manager = Arc::new(WorkspaceManager::new(None));
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let desktop_state = DesktopState {
        key_store: Arc::clone(&key_store),
        workspace_manager: Arc::clone(&workspace_manager),
        http_client,
        server_port: AtomicU16::new(28888),
    };

    let ks_for_server = Arc::clone(&key_store);
    let wm_for_server = Arc::clone(&workspace_manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(desktop_state)
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // 启动后台本地 HTTP 服务
            tauri::async_runtime::spawn(async move {
                match start_local_server(ks_for_server, wm_for_server, 28888).await {
                    Ok((port, _handle)) => {
                        let state = app_handle.state::<DesktopState>();
                        state.server_port.store(port, Ordering::SeqCst);
                        info!("Yachiyo local HTTP backend ready on port {}", port);
                    }
                    Err(e) => {
                        eprintln!("Failed to start local HTTP server: {}", e);
                    }
                }
            });

            // 系统托盘菜单
            let quit_i = MenuItem::with_id(app, "quit", "退出 Yachiyo Chat", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_port,
            list_configured_keys,
            save_api_key,
            delete_api_key,
            get_workspace_root,
            set_workspace_root,
            execute_agent_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
