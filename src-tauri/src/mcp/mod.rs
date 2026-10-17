pub mod client;
pub mod manager;
pub mod types;

pub use manager::McpManager;
pub use types::{
    McpContentItem, McpServerConfig, McpServerStatus, McpTool, McpToolCallResult,
    McpTransportConfig,
};
