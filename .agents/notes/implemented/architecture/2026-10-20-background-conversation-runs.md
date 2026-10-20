# Agent Note: 对话后台运行与多会话并发

Status: implemented

## Problem

聊天控制器只有一个 `activeRef` 运行槽，`selectConversation` / `newConversation` 开头都会 `stop()`：切换或新建对话会直接中断正在运行的 Agent 任务。发送锁 `sendingRef` 是全局布尔值，并且在整个流式期间保持为真，一个会话在跑时其他会话也无法发送。桌面网关的工作区租约是独占的，两个对话在同一项目里同时运行时第二个直接报 `WORKSPACE_BUSY`。

## Decision

- 运行按会话 id 存放在 `runsRef: Map<conversationId, ActiveRun>`。`isRunAlive(run)` 判断运行是否仍有效，`isForeground(conversationId)` 判断会话是否正显示在界面上。
- 流式回调始终更新运行缓冲并按 250ms 节流写入存储；只有前台会话才派发 reducer 动作（增量、工具步骤、权限卡）。后台会话的权限请求暂存在 `run.pendingPermission`。
- 切换会话不再停止任何运行。`selectConversation` 先等待持久化队列落盘，再读取消息；目标会话有活跃运行时，用内存缓冲生成实时快照（`withLiveRun`）替换存储中可能落后的那条消息，并以 `conversation-selected { running, pendingPermission }` 恢复 `streaming` 阶段与权限卡。没有活跃运行却仍为 `streaming` 的残留消息按 `stopped` 显示。
- 发送锁改为 `Map<conversationId, token>`，由 `withSendingLock` 统一加锁；`stop()` 只停当前会话，新增 `stopConversation(id)`（删除会话前调用）。压缩任务记录所属会话，只在前台时派发界面动作；压缩期间用户切走时，消息照常发出，运行直接转入后台。`makeRequestMessages` / `startAssistant` 显式接收发起运行时的会话快照，避免运行开始后切换会话读到别的会话的摘要与语言。
- 控制器暴露 `runningConversations: Map<id, "streaming" | "approval">`，侧栏据此显示运行中（蓝色呼吸点）与等待确认（琥珀色点）。非前台会话结束时回调 `onBackgroundRunFinished`，App 弹出完成/失败提示（用户主动停止的不提示）。
- `conversation-selected` 保留 `userMemory`：此前切换会话会把跨会话长期记忆从状态里丢掉，之后的请求不再注入记忆前缀。
- Rust `WorkspaceManager` 区分共享租约与独占租约：Agent 运行取 `acquire_shared_workspace`，多个对话可同时在同一项目中工作；检查点恢复与界面写入仍取独占租约，须等所有运行结束。

## Alternatives considered

- 每个会话一个独立的 `useChatController` 实例：界面状态、分页窗口与压缩逻辑都要成倍复制，且组件卸载会中断运行。
- 后台运行只写存储、切回时纯靠存储恢复：部分持久化有 250ms 节流，切回瞬间会丢失最新几段增量，且无法恢复待审批的权限卡。
- 同一项目仍保持独占：双任务最常见的场景就是同一项目里一边改代码一边查问题，独占会让第二个对话直接失败。

## Consequences

- 同一项目中并发的两个运行各自按轮次做工作区快照；一个运行的快照可能包含另一个运行的写入，恢复某个检查点也会回滚另一运行的改动。
- 后台失败的消息落盘为 `failed`，切回时不会恢复错误横幅，可用重新生成。
- 选择会话时不再触发 AI 标题升级（见同日的费用 Note）。

## Verification

- `npm run typecheck`、`npm run lint`、`npm run test:unit`（新增后台运行、切回接续实时进度、压缩期间切走仍在原会话完成发送的用例）
- `cargo test --manifest-path src-tauri/Cargo.toml`（新增 `concurrent_agent_runs_share_workspace_but_block_exclusive_access`）
