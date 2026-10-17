use std::collections::HashMap;
use tempfile::tempdir;
use yachiyo_desktop_lib::mcp::types::{
    McpContentItem, McpServerConfig, McpToolCallResult, McpTransportConfig,
};
use yachiyo_desktop_lib::mcp::McpManager;

#[test]
fn test_mcp_config_serialization() {
    let config = McpServerConfig {
        id: "sqlite".to_string(),
        name: "SQLite Database".to_string(),
        description: Some("本地数据库查询".to_string()),
        enabled: true,
        transport: McpTransportConfig::Stdio {
            command: "uvx".to_string(),
            args: vec!["mcp-server-sqlite".to_string(), "--db-path".to_string(), "app.db".to_string()],
            env: HashMap::from([("ENV_VAR".to_string(), "val".to_string())]),
        },
    };

    let json = serde_json::to_string_pretty(&config).expect("serialize");
    let deserialized: McpServerConfig = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(deserialized.id, "sqlite");
    assert_eq!(deserialized.name, "SQLite Database");
    assert!(deserialized.enabled);
    match deserialized.transport {
        McpTransportConfig::Stdio { command, args, env } => {
            assert_eq!(command, "uvx");
            assert_eq!(args.len(), 3);
            assert_eq!(env.get("ENV_VAR").unwrap(), "val");
        }
        _ => panic!("Expected stdio transport"),
    }
}

#[test]
fn test_mcp_tool_result_to_plain_text() {
    let result = McpToolCallResult {
        content: vec![
            McpContentItem::Text { text: "查询返回 2 条记录".to_string() },
            McpContentItem::Image {
                data: "abc".to_string(),
                mime_type: "image/png".to_string(),
            },
        ],
        is_error: false,
    };
    let text = result.to_plain_text();
    assert!(text.contains("查询返回 2 条记录"));
    assert!(text.contains("[二进制图片数据: image/png]"));
}

#[tokio::test]
async fn test_mcp_manager_crud_and_persistence() {
    let dir = tempdir().expect("tempdir");
    let storage_file = dir.path().join("mcp_servers.json");
    let http = reqwest::Client::new();

    let manager = McpManager::new(Some(storage_file.clone()), http.clone());
    assert_eq!(manager.list_servers().len(), 0);

    // 1. 添加
    let server1 = McpServerConfig {
        id: "git_ext".to_string(),
        name: "Git 扩展".to_string(),
        description: Some("高级 Git 操作".to_string()),
        enabled: true,
        transport: McpTransportConfig::Stdio {
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "@modelcontextprotocol/server-git".to_string()],
            env: HashMap::new(),
        },
    };
    assert!(manager.save_server(server1.clone()).is_ok());
    assert_eq!(manager.list_servers().len(), 1);

    // 2. 状态切换
    assert!(manager.toggle_server("git_ext", false).is_ok());
    assert!(!manager.get_server("git_ext").unwrap().enabled);

    // 3. 校验非法 ID
    let invalid_server = McpServerConfig {
        id: "git ext with spaces!".to_string(),
        name: "Invalid".to_string(),
        description: None,
        enabled: true,
        transport: McpTransportConfig::Sse {
            url: "http://localhost:8080/sse".to_string(),
            headers: HashMap::new(),
        },
    };
    assert!(manager.save_server(invalid_server).is_err());

    // 4. 重载验证落盘
    let manager2 = McpManager::new(Some(storage_file.clone()), http);
    let list = manager2.list_servers();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "git_ext");
    assert!(!list[0].enabled);

    // 5. 删除
    assert!(manager2.delete_server("git_ext").is_ok());
    assert_eq!(manager2.list_servers().len(), 0);
}

#[tokio::test]
async fn test_mcp_claude_desktop_import_export() {
    let dir = tempdir().expect("tempdir");
    let storage_file = dir.path().join("mcp_servers.json");
    let http = reqwest::Client::new();
    let manager = McpManager::new(Some(storage_file), http);

    let claude_json = r#"{
        "mcpServers": {
            "fetch": {
                "command": "uvx",
                "args": ["mcp-server-fetch"]
            },
            "remote_db": {
                "url": "http://127.0.0.1:9000/sse"
            }
        }
    }"#;

    let imported_count = manager.import_claude_config(claude_json).expect("import");
    assert_eq!(imported_count, 2);

    let servers = manager.list_servers();
    assert_eq!(servers.len(), 2);

    let fetch_server = manager.get_server("fetch").expect("fetch exists");
    match fetch_server.transport {
        McpTransportConfig::Stdio { command, args, .. } => {
            assert_eq!(command, "uvx");
            assert_eq!(args, vec!["mcp-server-fetch"]);
        }
        _ => panic!("Expected stdio"),
    }

    let remote_server = manager.get_server("remote_db").expect("remote_db exists");
    match remote_server.transport {
        McpTransportConfig::Sse { url, .. } => {
            assert_eq!(url, "http://127.0.0.1:9000/sse");
        }
        _ => panic!("Expected sse"),
    }

    let exported = manager.export_claude_config().expect("export");
    assert!(exported.contains("fetch"));
    assert!(exported.contains("remote_db"));
}

#[tokio::test]
async fn test_mcp_tool_execution_guards() {
    let dir = tempdir().expect("tempdir");
    let storage_file = dir.path().join("mcp_servers.json");
    let http = reqwest::Client::new();
    let manager = McpManager::new(Some(storage_file), http);

    // 非法名称格式
    assert!(manager.execute_tool("invalid_tool", &serde_json::json!({})).await.is_err());

    // 未知服务
    assert!(manager.execute_tool("mcp__nonexistent__query", &serde_json::json!({})).await.is_err());

    // 服务被禁用
    let disabled_server = McpServerConfig {
        id: "test_disabled".to_string(),
        name: "Disabled Server".to_string(),
        description: None,
        enabled: false,
        transport: McpTransportConfig::Sse {
            url: "http://127.0.0.1:9999/sse".to_string(),
            headers: HashMap::new(),
        },
    };
    manager.save_server(disabled_server).unwrap();
    let res = manager.execute_tool("mcp__test_disabled__do_something", &serde_json::json!({})).await;
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("已被禁用"));
}

#[test]
fn test_default_windows_mcp_config() {
    let cfg = McpManager::default_windows_mcp_config();
    assert_eq!(cfg.id, "windows_mcp");
    assert!(cfg.enabled);
    match cfg.transport {
        McpTransportConfig::Stdio { command, args, .. } => {
            assert_eq!(command, "npx");
            assert!(args.contains(&"@modelcontextprotocol/server-windows".to_string()));
        }
        _ => panic!("Expected stdio transport"),
    }
}
