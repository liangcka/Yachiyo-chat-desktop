# Agent Note: 桌面端 Agent 无工作区通用运行与自动 Agent 模式

Status: implemented

## Problem

1. **无工作区时的硬阻断与虚假网络报错**：
   在桌面端处于“无项目”（未打开或未绑定任何本地工作区）状态下，开启 Agent 模式发送问题（如「你能长任务运行吗」），由于 Rust 后端在 `run_agent_chat_stream` 初始阶段强制要求 `workspace_root` 必须存在，直接产生 SSE 错误 `WORKSPACE_REQUIRED`。前端 `chat-client.ts` 未对该错误类型做特定映射，一律归为通用异常并提示“暂时连接不上，再试一次吧。”，用户误以为是网络或后端服务崩溃，无法享受通用长任务思考、算法解答与网络搜索等能力。
2. **缺乏自主判断调用的自动 Agent 模式**：
   原有设计中 Agent 模式仅有开（`true`）与关（`false`）两态。开启时强行绑定工作区，关闭时则失去一切工具执行能力，用户每次需要手动评估当前对话是否需要工具，交互割裂且与现代主流 AI 编程助手（如 Copilot / Cursor）自动决策工具调用的体验存在差距。

## Decision

1. **Rust 后端支持解绑工作区与安全软拦截**：
   - `src-tauri/src/gateway/agent/runtime.rs`：移除 `run_agent_chat_stream` 中因 `workspace_root.is_none()` 导致的硬性中断；`run_agent_loop` 适配 `Option<&Path>` 与可选的 `Option<CheckpointStore>`。
   - `src-tauri/src/tools/mod.rs`：`execute_tool_with_context` 与 `process_tool_output` 支持 `workspace_root: Option<&Path>`。在无工作区时，对文件读写（`read_file`, `write_file`, `list_directory`, `search_files`, `file_outline`）与终端命令（`run_command`）进行安全拦截并返回友好提示给模型，非工作区依赖工具（如 `web_fetch`, `todo_write`）照常运行；工具输出超限安全降级为内存截断。
   - `src-tauri/src/gateway/prompt.rs`：针对 `workspace_root.is_none()` 注入专属系统提示词指导准则，告知模型当前未绑定项目目录，引导其在需要操作文件时明确提醒用户打开项目，其余通用任务直接发挥全部推理与问答能力。
2. **三态自动 Agent 模式（`auto` | `on` | `off`）**：
   - 扩展 `src-tauri/src/types.rs` 与 `src/services/chat-client.ts`：`AgentRequestConfig` / `StreamChatRequest.agent` 增加 `auto?: boolean` 字段。
   - `src/app/use-chat-controller.ts`：引入 `agentMode: "auto" | "on" | "off"` 状态，并保留 `agentEnabled: boolean` getter 向下兼容既有逻辑；默认模式设为 `"auto"` 并持久化至 `localStorage`（支持无损向前兼容）。
   - UI 交互与视觉指示（`DesktopChatArea.tsx`, `desktop.css`）：
     - 顶部药丸 Badge 支持动态展示 `⚡ 自动 Agent`（微亮翡翠绿点）、`● Agent 模式`（主色高亮点）与普通聊天模式；
     - 底部输入区动作栏 Agent 按钮支持三态循环点击切换（`⚡ Agent` -> `Agent (开启)` -> `Agent (关闭)`），并在 Tooltip 中展示清晰的操作状态提示。
3. **精准错误码映射与国际化**：
   - `src/services/chat-client.ts` 错误枚举增加 `WORKSPACE_REQUIRED`；
   - `src/i18n/messages.ts` 与 `src/App.tsx` 映射为友好文案“此任务需要先选择或打开一个项目工作区。”，消除误导性断网提示。

## Consequences

- **收益**：
  - 彻底解决了无项目状态下开启 Agent 导致虚假网络断连的体验 Bug，在无工作区状态下也能完整进行长任务问答、代码演算和联网搜索；
  - 默认提供“自动 Agent”模式，日常对话无需频繁手动开关 Agent，AI 可根据意图自主决定是否调用工具；
  - 保留明确的手动强制启用（`on`）与安全纯文本（`off`）选择权。
- **验证**：
  - `cargo test --manifest-path src-tauri/Cargo.toml`：52 项测试全部通过（含新增的无工作区纯文本补全与工具拦截回归测试）；
  - `npm run typecheck`：通过（覆盖 `tsconfig.app.json`, `tsconfig.node.json`, `functions/tsconfig.json`）；
  - `npm run test:unit`：40 个测试文件、360 项单元测试全部通过；
  - `npm run lint`：通过（0 errors）。
