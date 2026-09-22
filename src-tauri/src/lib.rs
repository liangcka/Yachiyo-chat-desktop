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
fn get_workspace_root(state: State<DesktopState>) -> Option<String> {
    state
        .workspace_manager
        .get_workspace_root()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn set_workspace_root(state: State<DesktopState>, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        state.workspace_manager.clear_workspace_root();
        Ok(())
    } else {
        state.workspace_manager.set_workspace_root(PathBuf::from(path))
    }
}

#[tauri::command]
async fn execute_agent_tool(
    state: State<'_, DesktopState>,
    name: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let root = state.workspace_manager.get_workspace_root();
    tools::execute_tool_with_context(&name, &arguments, root.as_deref(), &state.http_client, None).await
}

/// UI 文件树懒加载：结构化目录条目（仅前端调用，不进 agent 工具 schema）
#[tauri::command]
fn list_workspace_entries(
    state: State<DesktopState>,
    path: Option<String>,
) -> Result<Vec<tools::fs::WorkspaceEntry>, String> {
    let Some(root) = state.workspace_manager.get_workspace_root() else {
        return Ok(Vec::new());
    };
    tools::fs::list_workspace_entries(path.as_deref().unwrap_or("."), &root)
}

/// 快速模糊检索工作区文件（用于 @ 引用智能补全浮层）
#[tauri::command]
fn search_workspace_files(
    state: State<DesktopState>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let Some(root) = state.workspace_manager.get_workspace_root() else {
        return Ok(Vec::new());
    };
    tools::fs::search_workspace_files(query.as_deref(), limit, &root)
}


/// diff 审阅基线：读取文件在 HEAD 的内容
#[tauri::command]
async fn read_head_file(
    state: State<'_, DesktopState>,
    path: String,
) -> Result<tools::git::HeadFile, String> {
    let Some(root) = state.workspace_manager.get_workspace_root() else {
        return Ok(tools::git::HeadFile {
            present: false,
            content: String::new(),
        });
    };
    tools::git::read_head_file(&path, &root).await
}

/// 原生系统文件夹选择器（对标 "Open workspace" 对话框）
#[tauri::command]
async fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(t) = title.as_deref() {
        dialog = dialog.set_title(t);
    }
    let res = dialog.pick_folder().await;
    Ok(res.map(|h| h.path().to_string_lossy().to_string()))
}

/// 退出并完全关闭桌面端应用（销毁窗口并终止后台进程）
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 最小化当前窗口
#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// 切换窗口最大化 / 还原状态
#[tauri::command]
fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// 查询当前窗口是否处于最大化状态
#[tauri::command]
fn is_window_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

/// 在系统默认外部独立浏览器中打开指定链接（避免在 IDE 内置视图或应用内打开）
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https schemes are permitted".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .raw_arg(format!("/c start \"\" \"{}\"", url))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open system browser: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open system browser: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open system browser: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported operating system".into())
    }
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
            list_workspace_entries,
            read_head_file,
            pick_folder,
            exit_app,
            open_external_url,
            minimize_window,
            toggle_maximize_window,
            is_window_maximized,
            search_workspace_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
