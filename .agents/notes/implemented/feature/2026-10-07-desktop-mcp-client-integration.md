# Agent Note: 桌面端 MCP (Model Context Protocol) 客户端集成

Status: implemented

## Problem
Yachiyo Chat 桌面端已具备本地 Agent 循环与内置工具（文件读写、目录浏览、Git 差异、终端命令等），但工具能力局限于内置几项，无法灵活对接外部丰富多样的生态工具（如 SQLite 数据库查询、PostgreSQL、GitHub API、各类三方专业 API）。
业界普遍采用 Anthropic 的 Model Context Protocol (MCP) 开放标准。为了使八千代具备可无限扩展的外部工具调用能力，需要在桌面端引入原生 MCP 客户端架构。

## Decision
1. **客户端模式 (MCP Client)**：
   - Yachiyo Chat 作为 MCP 客户端消费外部 MCP Servers，动态发现并向大模型暴露工具 Schema，在模型决策时转发执行并将结果回填上下文。
2. **双协议传输支持 (Dual Transport)**：
   - **Stdio 协议**：通过异步子进程管道（`tokio::process::Command`）通信，按行进行 JSON-RPC 2.0 序列化/反序列化。针对 Windows 平台默认启用 `CREATE_NO_WINDOW` 标志防止弹出控制台黑框。
   - **SSE / HTTP 协议**：基于 `reqwest` 支持现代 MCP SSE 规范以及 Streamable HTTP 规范连接远端 MCP Server。
3. **命名空间与安全权限隔离**：
   - 工具名统一映射为 `mcp__{server_id}__{tool_name}`，保障与 OpenAI / Claude / Gemini 函数命名规则兼容且避免与内置工具及不同服务间命名冲突。
   - 所有 MCP 外部调用默认接入 `ApprovalRegistry` 审批机制，展示所属服务与调用入参，经用户批准后方可执行。
4. **图形化配置与标准格式兼容**：
   - 配置文件保存在用户应用数据目录 `mcp_servers.json`，与 Claude Desktop 规范（`claude_desktop_config.json`）格式保持输入兼容，支持一键 JSON 导入/导出。
   - 在桌面端设置面板中提供独立的「MCP 服务」管理界面，支持添加、编辑、测试连接（动态获取工具列表）、启停控制与删除。

## Alternatives considered
- **仅支持 Stdio 本地子进程**：虽然简单，但无法连接局域网或远程部署的 MCP Server。因此同时支持 Stdio 与 SSE/HTTP。
- **引入庞大的第三方 MCP SDK Crate**：目前 Rust 生态中部分 MCP 第三方 crate 处于不稳定或依赖过重阶段。MCP 核心本质为基于 Stdio/SSE 的 JSON-RPC 2.0，基于既有的 `tokio`、`serde_json` 和 `reqwest` 进行轻量原生实现更加可控、干净且无额外体积负担。

## Acceptance criteria
1. Rust 侧实现 `McpManager` 与 `StdioClient` / `SseClient`，支持 `initialize`, `tools/list`, `tools/call`。
2. 在 Agent 多轮循环中动态合并启用的 MCP 工具 Schema，支持模型触发调用与权限校验。
3. 提供 Tauri IPC 命令（增删改查、测试、启停、配置导入导出）。
4. 前端设置模态框提供专属 MCP 管理面板与友好的连接测试反馈。
5. 所有单元测试、类型检查和代码规范检查通过。

## Risks & Mitigations
- **子进程挂死或未退出**：增加超时控制（如 30 秒执行超时），在应用退出或测试断开时保证子进程及时清理。
- **外部服务器异常输出撑爆上下文**：MCP 工具返回结果接入与内置工具一致的 `process_tool_output` 截断与落地防爆机制。
