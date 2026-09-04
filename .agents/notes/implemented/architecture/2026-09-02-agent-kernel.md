# Agent Note: 阶段一 Agent 内核（多步循环 / 原生 function calling / 结构化工具协议 / 权限门）

Status: implemented

## Problem

旧链路的工具调用是"四层手写假协议"：Rust 网关把工具调用塞进 markdown 代码块（\`\`\`tool\_call 文本）→ SSE 透传 → 前端 `MessageBubble` 用正则解析文本再渲染卡片。契约脆弱，任一层变动全链路断裂；且仅支持"流结束后解析单个工具调用 → 执行一次 → 第二轮汇报"，无法链式完成多步任务；写文件、执行命令前无人工审批，也无破坏性操作的回滚能力。

## Proposal

完整设计见 [docs/PHASE1\_AGENT\_KERNEL\_DESIGN.md](../../../docs/PHASE1_AGENT_KERNEL_DESIGN.md)。落地要点：

**Rust 侧循环架构（`src-tauri/src/gateway/agent/`）**

- `runtime.rs`：`run_agent_loop` 承载 turn 1..N 多步循环（默认上限 12 轮）；`TurnExecutor` trait 注入单轮上游执行（各 Provider 的原生 function calling 请求构建与流式解析实现该 trait），循环内核只依赖 `AgentMessage` 统一模型，与具体厂商解耦。

- `permission.rs`：`ApprovalRegistry` 全局批准注册表。写类工具（write\_file / run\_command）在流内下发 `permission_request` 事件并阻塞等待；前端通过 `POST /api/agent/approval`（本地网关 HTTP 路由）回填批准/拒绝，支持"本会话不再询问同类"（session\_scope）。

- `checkpoint.rs`：`CheckpointStore` 写前影子备份。写类工具执行前备份原文件，运行异常或用户拒绝后可整体回滚，兜底 Agent 破坏性操作。

- `stream_agg.rs`：跨 SSE chunk 的工具调用增量聚合器（按 index 拼接 id/name/arguments）。

**SSE 协议扩展（5 个新事件）**

`tool_call` / `tool_result` / `permission_request` / `permission_resolved` / `turn`。现有 `delta` / `thought` / `sources` / `done` / `error` 语义不变，协议向后兼容；云端 Web/移动端零改动保持纯聊天。

**前端结构化消费**

- `ToolStep` 随 assistant 消息持久化（`ChatMessage.toolSteps`），历史消息重放时展开为 assistant(toolCalls) + tool 结果消息序列。

- `MessageBubble` 删除 \`\`\`tool\_call 正则解析，按 `toolSteps` 结构化渲染 ToolCard；`PermissionCard` 承载写类授权（拒绝 / 批准一次 / 批准并本会话不再询问）；`DesktopChatArea` 挂载授权卡片与 Agent 模式开关（仅桌面视图）。

**移除的三个历史遗留**（决策依据：IDE 差距分析 A1-A4 与设计文档"已确认的决策"表）

1. 文本假协议：Rust 侧注入与前端正则解析全部删除，历史消息里的旧 \`\`\`tool\_call 文本按普通文本渲染，不做数据迁移。
2. 二轮汇报：旧的"流结束后解析单工具 → 执行一次 → 追加汇报轮"机制由多步循环内核替代。
3. `max_characters` 截断：网关侧旧的全局输出截断移除，改为 `truncate_tool_output`（模型收截断版、UI 收 2KB 预览）的双通道输出。

**跨任务决策补录**

- **serde\_json** **`preserve_order`** **feature**：`src-tauri/Cargo.toml` 启用该 feature，使 `serde_json::Value::Object` 保持 `IndexMap` 插入序。工具调用的 arguments 对象从模型 JSON 原样透传给前端与工具执行层，保序后 UI 预览与日志输出的字段顺序与上游一致，且 tool\_call 流式增量聚合按原始顺序拼接不依赖排序稳定；默认 BTreeMap 按字典序重排字段会破坏这一可读性契约。

- **UTF-8 跨 chunk 边界（已知事项，暂不修复）**：`runtime.rs` 上游流读取对每个 HTTP chunk 独立执行 `std::str::from_utf8`，多字节 UTF-8 字符恰好跨 chunk 边界时该 chunk 会被 `if let Ok` 静默丢弃。记录为已知缺陷：SSE 事件以 `\n\n` 分帧且载荷以 ASCII 为主，实际触发概率低；后续修复方向是字节缓冲 + `String::from_utf8_lossy` 或增量解码器，需在专门任务中处理并补多字节边界测试。

## Alternatives considered

- **循环位置**：前端驱动多轮（每次工具调用后再发一次请求）——被否决：会话状态撕裂、网络往返放大、云端与桌面双实现；选定 Rust 网关侧单次 SSE 承载完整运行。

- **工具协议降级**：保留文本协议作为不支持 function calling 厂商的降级路径——被否决：双协议并存是当前痛点根源；全部 6 家 Provider 走原生 function calling，构建失败显式报错。

- **权限审批通道**：复用 Tauri IPC command——被否决：审批需要与 SSE 流同源的本地 HTTP 网关上下文，走 `/api/agent/approval` 路由与前端 `apiFetch` 基础设施一致。

## Acceptance criteria

- 桌面端开启 Agent 模式后，多步工具调用链（读→写→汇报）在一次 SSE 流内闭环完成。

- 写类工具触发授权卡片，拒绝/批准/会话级批准三种路径行为正确；批准后可回滚。

- 前端按 `toolSteps` 渲染工具卡片，旧文本不再解析为卡片；历史旧消息按纯文本渲染。

- 全量门禁通过：`npm run typecheck && npm run lint && npm run test:unit && npm run test:functions && npm run test:desktop`。

## Risks

- 协议演进需保持 5 事件向后兼容（云端路径零改动的红线依赖于此）。

- 会话级批准（session\_scope）在长会话中的权限面扩大，依赖 CheckpointStore 回滚兜底。

- UTF-8 跨 chunk 边界缺陷（见上文已知事项）在极端分帧下可能导致个别事件丢失。

## 终审结论（2026-09-02）

- Merge readiness：**Ready with follow-ups**。

- 合并前已修复：停止（stopped）/ 失败（failed）终态下前端 reducer 残留 `pendingPermission` 的问题——Rust 侧 `gate.cancel` 虽已清理 pending（无误执行风险），但权限卡片会残留在输入区上方，点击后 POST 404 被静默吞掉；现 `chatReducer` 的 `stopped`/`failed` 分支与 send-started / conversation-selected 同模式清除该状态。

- 遗留 follow-up 清单（按优先级）：

  - **P0**：checkpoint 回滚闭环未接线（`rollback_all` 无生产调用方，且 `.yachiyo/checkpoints/` 无清理机制）；UTF-8 跨 chunk 增量解码（`runtime.rs` 与纯聊天路径共有的丢字节缺陷）。

  - **P1**：三处测试盲区——权限等待中的取消路径（`runtime.rs` select 分支）、`/api/agent/approval` HTTP 路由集成测试、`makeRequestMessages` 的 toolSteps 历史展开逻辑单测。

  - **P2**：PermissionCard 焦点管理等 a11y 增强；`turn` 事件接入真实逐轮 usage；Agent 模式与联网搜索的互斥提示；停止后未决 ToolStep 徽章显示"完成"的语义瑕疵；事件通道背压评估。

