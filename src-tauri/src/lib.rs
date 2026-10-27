pub mod asset_files;
pub mod computer;
pub mod control_overlay;
pub mod crypto;
pub mod gateway;
pub mod mcp;
pub mod server;
pub mod tools;
pub mod types;

use crypto::keys::KeyStore;
use server::http::{generate_gateway_token, start_local_server};
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
    pub mcp_manager: Arc<mcp::McpManager>,
    pub http_client: reqwest::Client,
    pub server_port: AtomicU16,
    pub gateway_token: String,
}

/// 桌面端 IPC 工具白名单：与前端 `executeDesktopAgentTool` 的实际调用点对齐
/// （编辑器读写与 diff 审阅、终端面板手敲命令、Git 状态）。
/// webview 一旦被注入脚本劫持，也无法凭 IPC 触发未在白名单内的工具。
const IPC_TOOL_WHITELIST: [&str; 5] = [
    "read_file",
    "write_file",
    "git_status",
    "git_diff",
    "run_command",
];

#[tauri::command]
fn get_server_port(state: State<DesktopState>) -> u16 {
    state.server_port.load(Ordering::SeqCst)
}

/// 本地 HTTP 网关的鉴权 token，由前端注入 `x-yachiyo-gateway-token` 请求头
#[tauri::command]
fn get_gateway_token(state: State<DesktopState>) -> String {
    state.gateway_token.clone()
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
    if !IPC_TOOL_WHITELIST.contains(&name.as_str()) {
        return Err(format!(
            "工具 '{}' 不在桌面端界面工具白名单内，请通过 Agent 对话流程调用。",
            name
        ));
    }
    let root = state.workspace_manager.get_workspace_root();
    let _lease = if tools::tool_risk(&name) == Some(tools::ToolRisk::Write) {
        root.as_deref().map(|root| state.workspace_manager.acquire_workspace(root)).transpose()?
    } else { None };
    tools::execute_tool_with_context(
        &name,
        &arguments,
        root.as_deref(),
        &state.http_client,
        None,
        tools::ToolAuthorization::HumanInitiated,
    )
    .await
}

#[tauri::command]
async fn list_checkpoints(workspace: String) -> Result<Vec<gateway::agent::checkpoint::Checkpoint>, String> {
    tauri::async_runtime::spawn_blocking(move || gateway::agent::checkpoint::CheckpointStore::list(std::path::Path::new(&workspace)))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restore_checkpoint(state: State<'_, DesktopState>, workspace: String, id: String) -> Result<(), String> {
    let root = PathBuf::from(workspace);
    let lease = state.workspace_manager.acquire_workspace(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        gateway::agent::checkpoint::CheckpointStore::restore(&root, &id)
    }).await.map_err(|e| e.to_string())?
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

/// 把拖入的文件或消息里引用的本地视频加入 asset 协议 scope，只返回成功放行的普通文件
#[tauri::command]
fn allow_asset_files(app: tauri::AppHandle, paths: Vec<String>) -> Vec<asset_files::AssetFile> {
    let scope = app.asset_protocol_scope();
    paths
        .iter()
        .filter_map(|path| asset_files::inspect_asset_file(path))
        .filter(|file| scope.allow_file(&file.path).is_ok())
        .collect()
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
        // 用解析后重新序列化的 URL 拼命令行：双引号已被百分号编码，无法闭合引号注入额外命令
        std::process::Command::new("cmd")
            .raw_arg(format!("/c start \"\" \"{}\"", parsed.as_str()))
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

/// GitHub Releases 最新正式版接口（不含草稿与预发布）
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/liangcka/Yachiyo-chat-desktop/releases/latest";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    latest_tag: Option<String>,
    release_url: Option<String>,
}

/// 查询当前版本与 GitHub 最新正式版；版本比较交给前端，网络失败直接返回错误由前端静默处理
#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let response = state
        .http_client
        .get(LATEST_RELEASE_API)
        .header(reqwest::header::USER_AGENT, "yachiyo-desktop")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    // 仓库尚无正式版时接口返回 404，视为“已是最新”
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo { current_version, latest_tag: None, release_url: None });
    }
    let body: serde_json::Value = response
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(UpdateInfo {
        current_version,
        latest_tag: body["tag_name"].as_str().map(str::to_string),
        release_url: body["html_url"].as_str().map(str::to_string),
    })
}

#[tauri::command]
fn list_mcp_servers(state: State<DesktopState>) -> Vec<mcp::McpServerConfig> {
    state.mcp_manager.list_servers()
}

#[tauri::command]
fn get_mcp_server(state: State<DesktopState>, id: String) -> Option<mcp::McpServerConfig> {
    state.mcp_manager.get_server(&id)
}

#[tauri::command]
fn save_mcp_server(
    state: State<DesktopState>,
    config: mcp::McpServerConfig,
) -> Result<(), String> {
    state.mcp_manager.save_server(config)
}

#[tauri::command]
fn delete_mcp_server(state: State<DesktopState>, id: String) -> Result<(), String> {
    state.mcp_manager.delete_server(&id)
}

#[tauri::command]
fn toggle_mcp_server(
    state: State<DesktopState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    state.mcp_manager.toggle_server(&id, enabled)
}

#[tauri::command]
async fn test_mcp_server(
    state: State<'_, DesktopState>,
    config: mcp::McpServerConfig,
) -> Result<Vec<mcp::McpTool>, String> {
    state.mcp_manager.test_server_connection(&config).await
}

#[tauri::command]
async fn get_mcp_server_status(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<mcp::McpServerStatus, String> {
    state.mcp_manager.get_server_status(&id).await
}

#[tauri::command]
fn import_claude_mcp_config(state: State<DesktopState>, json: String) -> Result<usize, String> {
    state.mcp_manager.import_claude_config(&json)
}

#[tauri::command]
fn export_claude_mcp_config(state: State<DesktopState>) -> Result<String, String> {
    state.mcp_manager.export_claude_config()
}

#[derive(serde::Serialize)]
struct ComputerControlState {
    supported: bool,
    enabled: bool,
    reason: Option<String>,
}

#[tauri::command]
fn get_computer_control_state(state: State<DesktopState>) -> ComputerControlState {
    ComputerControlState {
        supported: computer::is_supported(),
        enabled: state.mcp_manager.computer_control_enabled(),
        reason: computer::availability().err(),
    }
}

#[tauri::command]
fn set_computer_control_enabled(state: State<DesktopState>, enabled: bool) -> Result<(), String> {
    state.mcp_manager.set_computer_control_enabled(enabled)
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

    let mcp_manager = Arc::new(mcp::McpManager::new(None, http_client.clone()));

    // token 在构建状态前同步生成，避免前端在网关就绪前来取不到凭据的竞态
    let gateway_token = generate_gateway_token();

    let desktop_state = DesktopState {
        key_store: Arc::clone(&key_store),
        workspace_manager: Arc::clone(&workspace_manager),
        mcp_manager: Arc::clone(&mcp_manager),
        http_client,
        server_port: AtomicU16::new(28888),
        gateway_token: gateway_token.clone(),
    };

    let ks_for_server = Arc::clone(&key_store);
    let wm_for_server = Arc::clone(&workspace_manager);
    let mcp_for_server = Arc::clone(&mcp_manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        // 应用内更新：安装包签名由发布流程生成，公钥写在 tauri.conf.json
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // 记住主窗口位置与尺寸；全屏控制遮罩窗口每次按需显示，不参与记忆
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["control_overlay"])
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(desktop_state)
        .manage(control_overlay::ControlOverlayState::default())
        .setup(move |app| {
            // 上次若在电脑控制中途被强制结束，系统光标会停留在空白状态，启动时先恢复
            computer::recover_system_cursor();
            // 同步完成端口绑定再进入事件循环：前端经 get_server_port 拼网关地址，
            // 若异步绑定尚未完成，端口漂移（28888 被占用）时首批请求会打到错误端口
            match tauri::async_runtime::block_on(start_local_server(
                ks_for_server,
                wm_for_server,
                mcp_for_server,
                gateway_token,
                28888,
            )) {
                Ok((port, _handle)) => {
                    let state = app.state::<DesktopState>();
                    state.server_port.store(port, Ordering::SeqCst);
                    info!("Yachiyo local HTTP backend ready on port {}", port);
                }
                Err(e) => {
                    eprintln!("Failed to start local HTTP server: {}", e);
                }
            }

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
            get_gateway_token,
            list_configured_keys,
            save_api_key,
            delete_api_key,
            get_workspace_root,
            set_workspace_root,
            execute_agent_tool,
            list_checkpoints,
            restore_checkpoint,
            list_workspace_entries,
            read_head_file,
            pick_folder,
            exit_app,
            open_external_url,
            check_for_update,
            minimize_window,
            toggle_maximize_window,
            is_window_maximized,
            allow_asset_files,
            search_workspace_files,
            list_mcp_servers,
            get_mcp_server,
            save_mcp_server,
            delete_mcp_server,
            toggle_mcp_server,
            test_mcp_server,
            get_mcp_server_status,
            import_claude_mcp_config,
            export_claude_mcp_config,
            get_computer_control_state,
            set_computer_control_enabled,
            control_overlay::show_control_overlay,
            control_overlay::hide_control_overlay,
            control_overlay::get_control_overlay_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // 托盘退出等路径不会经过遮罩的隐藏流程，退出前确保系统光标已恢复
            if let tauri::RunEvent::Exit = event {
                computer::restore_system_cursor();
            }
        });
}
