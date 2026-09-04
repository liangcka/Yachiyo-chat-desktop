# 阶段一：Agent 内核详细设计

> **状态：已实施（2026-09-02）**。架构决策与实施记录见 [Agent Note: 阶段一 Agent 内核](../.agents/notes/proposed/architecture/2026-09-02-agent-kernel.md)。

依据 [IDE\_GAP\_ANALYSIS.md](./IDE_GAP_ANALYSIS.md) 的演进路线，本文档定义阶段一（A1 多步 Agent 循环 / A2 原生 function calling / A3 结构化工具协议 / A4 权限门与 checkpoint）的详细设计。

## 0. 已确认的决策

| 决策项   | 结论                                                             |
| :---- | :------------------------------------------------------------- |
| 落地端   | 仅桌面端（Rust 网关）；云端 Web/移动端保持纯聊天，协议向后兼容、零改动                       |
| 循环位置  | Rust 网关侧（方案 A）：一次 `/api/chat` 的 SSE 响应承载完整多轮 Agent 运行          |
| 权限门粒度 | 读写分级：读类自动放行；写类（write\_file / run\_command）每次弹卡确认，支持"本会话不再询问同类" |
| 工具协议  | 全部 6 家 Provider 走原生 function calling；文本协议不保留降级，构建失败显式报错        |

## 1. 总体数据流

```
用户在桌面端开启 Agent 模式，输入任务
  │
  ▼
POST /api/chat  { agent: { enabled: true, maxTurns: 12 }, messages, ... }
  │
  ▼
Rust 网关 AgentRuntime 接管，进入循环（turn 1..N）：
  │
  │  ┌──────────────────────────────────────────────┐
  ├─►│ 构建带 tools 的上游请求（原生 function calling） │
  │  │ 流式接收：thought/delta 事件透传给前端           │
  │  │ 解析出 tool_calls → 下发 ToolCall 事件           │
  │  │                                              │
  │  │ 读类工具 → 直接执行 → ToolResult 事件           │
  │  │ 写类工具 → PermissionRequest 事件 → 阻塞等待    │
  │  │      ▲                                        │
  │  │      └── POST /api/agent/approval（前端回传）    │
  │  │                                              │
  │  │ 工具结果回填为 role:"tool" 消息 → 下一轮        │
  │  └──────────────────────────────────────────────┘
  │
  ▼
模型不再调用工具 → 最终答复流式透传
  │
  ▼
Done { usage: 全部轮次累计 }
```

## 2. 协议契约

### 2.1 SSE 事件扩展（`ClientStreamEvent` 新增 5 种）

| 事件                    | 载荷                                          | 说明                           |
| :-------------------- | :------------------------------------------ | :--------------------------- |
| `tool_call`           | `{ id, name, arguments }`                   | 模型请求调用某工具                    |
| `tool_result`         | `{ id, name, output, isError, durationMs }` | 工具执行结果（UI 收 2KB 预览，模型收全量截断版） |
| `permission_request`  | `{ requestId, toolName, arguments }`        | 写类操作待批准，流阻塞等待                |
| `permission_resolved` | `{ requestId, approved }`                   | 门裁决通知（放行/拒绝/超时）              |
| `turn`                | `{ index, usage }`                          | 轮次边界，UI 可展示"第 N 步"           |

现有 `delta` / `thought` / `sources` / `done` / `error` 语义不变，协议向后兼容。

### 2.2 请求模型扩展

- `ClientChatRequest` 新增 `agent?: { enabled: boolean, maxTurns?: number }`

- `ClientHistoryMessage.role` 扩展 `"tool"`；新增 `toolCalls`（assistant 消息携带）与 `toolCallId`（tool 消息）字段——历史会话重放时多轮工具链不丢

### 2.3 控制通道

| 通道 | 设计                                                                                                                         |
| :- | :------------------------------------------------------------------------------------------------------------------------- |
| 批准 | `POST /api/agent/approval { requestId, approved, sessionScope? }`；`sessionScope:true` 记入会话级放行集（会话 = 本次 `/api/chat` 请求生命周期） |
| 取消 | 前端断开 SSE（现有 AbortController）；网关靠流 Drop 检测，循环在轮间与权限等待处响应                                                                    |
| 保活 | 等待批准期间网关每 5s 发 SSE 注释 `: ping`；现有 chat-client 跳过注释且每次 read 重置 15s 不活跃计时器，天然兼容                                              |

### 2.4 顺带移除的历史遗留

1. `parse_tool_call` 文本/XML 假协议（`gateway/mod.rs` L23-L109）
2. 第二轮"八千代汇报"硬编码 hack（`gateway/mod.rs` L381-L393）
3. `max_characters` 1000/2000 字符硬截断 bug（`gateway/mod.rs` L248-L252）

## 3. Rust 侧设计

### 3.1 模块结构

```
src-tauri/src/gateway/
  mod.rs            入口薄化：agent.enabled → 委托 AgentRuntime；否则走现有纯聊天路径
  agent/
    mod.rs          AgentRuntime —— 循环状态机（核心）
    permission.rs   PermissionGate —— requestId ↔ oneshot 批准通道 + 会话级放行记忆
    checkpoint.rs   CheckpointStore —— 写前文件影子备份与回滚
  providers/
    openai_compat.rs   + tools 构建 + delta.tool_calls 流式聚合（按 index 拼接 arguments）
    anthropic.rs        + tools 定义 + tool_use 块解析（content_block_start / input_json_delta / content_block_stop）
    gemini.rs           + functionDeclarations + functionCall part 解析
  stream.rs         ExtractedDelta 扩展 tool_calls 增量字段
tools/
  mod.rs            工具注册表加风险分级：read（自动放行）/ write（需批准）
```

### 3.2 循环状态机（伪码）

```rust
let mut messages = request.messages;          // 统一内部表示 AgentMessage
let mut cancelled = CancelGuard::new();        // SSE 流 Drop 时置位
for turn in 0..max_turns {
    if cancelled { break; }
    let built = build_upstream_request_with_tools(&messages, &tools_schema)?;
    let (text_out, tool_calls, usage) = stream_turn(built).await; // 透传 thought/delta
    accumulated_usage += usage;
    if tool_calls.is_empty() { return final_answer; }
    for call in tool_calls {
        emit ToolCall;
        if gate.needs_approval(&call)? {
            let ok = gate.await_approval(req_id, 5min).await?; // 阻塞 + ping 保活
            if !ok { 回填"用户拒绝"的 tool 消息; continue; }
        }
        checkpoint.backup_before_write(&call)?;
        let result = execute_tool(...).await;      // 沿用现有沙箱
        emit ToolResult;
        messages.push(AgentMessage::Tool { call, result_truncated });
    }
}
```

关键约束：

- **usage 跨轮累计**（现有逻辑推广到循环）

- **工具输出截断**：`read_file` 64KB / `run_command` 16KB / `web_fetch` 32KB，回填模型时截断并注明；`tool_result` SSE 事件的 UI 预览压到 2KB

- **max\_turns 默认 12**，防失控循环

- **断流取消**：轮间与权限等待处检查 cancelled；进行中的工具让其自然完成（shell 自带 30s 超时）

### 3.3 Provider 适配的统一内部表示

循环内部不感知 provider 差异——统一 `AgentMessage` 枚举（`User` / `Assistant { text, toolCalls }` / `Tool { toolCallId, name, content }`），构建上游请求时按 provider 转换：

| Provider                                | tools 字段                                  | tool 结果回填                         |
| :-------------------------------------- | :---------------------------------------- | :-------------------------------- |
| OpenAI 兼容系（Stepfun/DeepSeek/GLM/OpenAI） | `tools` 数组 + `tool_choice:"auto"`         | `role:"tool"` + `tool_call_id`    |
| Anthropic                               | `tools:[{name,description,input_schema}]` | `user` 角色消息内嵌 `tool_result` block |
| Gemini                                  | `functionDeclarations`                    | `functionResponse` part           |

Provider 构建时不支持 tools 则显式报错，不静默降级。

### 3.4 权限门与 Checkpoint

- **PermissionGate**：`HashMap<requestId, oneshot::Sender<bool>>`；`sessionScope` 批准记入会话级放行集

- **等待超时 5 分钟**，超时视为拒绝（模型收到 `isError` 的 tool 结果，可自行改道）

- **CheckpointStore**：`write_file` 执行前，若目标存在 → 复制到 `{workspace}/.yachiyo/checkpoints/{run_id}/`，附 manifest（原路径、备份路径、序号）；UI 提供"回滚本次运行全部写入"（按 manifest 逆序恢复）。`run_command` 不做快照（有权限门前置）。`.yachiyo/` 自动追加 `.gitignore`

## 4. 前端改造

| 层                         | 变更                                                                                                                                  |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------- |
| `services/chat-client.ts` | `StreamChatOptions` 新增 `onToolCall` / `onToolResult` / `onPermissionRequest` / `onTurn` 回调；SSE 解析器加新事件类型与载荷校验（沿用现有严格校验风格）           |
| `domain/chat`             | 消息 chunk 新增结构化 `"tool"` 块，取代 MessageBubble 的   ` ```tool_call` \` 正则解析                                                              |
| `app/chat-reducer`        | 新增 `tool-call` / `tool-result` / `permission-request` 动作；PermissionCard 状态机（pending → approved / denied / timeout）                  |
| UI 组件                     | 消息流内渲染 **ToolCard**（读=蓝卡折叠 / 写=橙卡）与 **PermissionCard**（批准 / 拒绝 / 本会话不再询问）；批准动作 `POST /api/agent/approval`，origin 获取复用 `api-origins` |
| 入口                        | 桌面端输入区新增 **Agent 模式开关**；云端口径不变                                                                                                      |

## 5. 错误处理矩阵

| 故障                 | 行为                                                     |
| :----------------- | :----------------------------------------------------- |
| 某轮上游请求失败           | `error` 事件即止；已执行的 ToolResult 前端保留展示；重试走现有 retryable 机制 |
| 权限等待超时             | 视为拒绝，回填 `isError` tool 结果，循环继续（模型可改道）                  |
| 工具执行失败             | `isError` 回填，模型自行调整重试——循环的固有容错方式                       |
| 用户断流/取消            | Drop guard 置位，轮间与权限等待处响应；进行中工具自然完成                     |
| 上下文膨胀              | 工具输出截断策略；超长循环由 max\_turns 兜底                           |
| Provider 不支持 tools | 构建时显式报错                                                |

## 6. 测试策略

- **Rust 单测**（`npm run test:desktop`）：AgentRuntime 注入 mock provider SSE 序列，覆盖：纯文本终止 / 单工具 / 多轮链式 / 权限拒绝 / 超时 / 取消 / 输出截断 / usage 累计 / checkpoint 备份与回滚

- **前端单测**（`npm run test:unit`）：chat-client 新事件解析（含畸形载荷拒绝）、reducer 新动作、PermissionCard 交互

- **既有测试**：MessageBubble 旧 tool 正则相关用例同步更新

- **门禁**：`npm run typecheck && npm run lint && npm run test:unit && npm run test:desktop`

## 7. 人设保持

Agent 模式下的 system prompt（`gateway/prompt.rs`）切换为"八千代 Agent 形态"：保留角色语气，叠加工具使用规范（何时读、何时改、写前说明意图）。纯聊天模式提示词不变。

## 8. 明确不在本阶段

- 会话级跨请求的任务状态、任务规划面板（A5，阶段三）

- 编辑器 / diff 审阅 UI（阶段二）

- 断线后的运行恢复（webview 重载即取消，会话恢复留待任务面板）

- 云端工具能力（A6）

