# Agent Note: 运行身份与工作区归属

Status: implemented

## Problem

桌面 Agent 的目标项目原本由“界面当前选中的项目”隐式决定，存在三条串项目的路径：

- 聊天控制器在落盘、@ 引用展开等异步准备完成后，才读取 `projectManager.activeProject` 与执行模式填入请求；准备期间切换项目或模式会改变已提交任务的目标。
- 网关收到 `agent.workspace` 后调用 `WorkspaceManager::set_workspace_root` 改写全局根；请求未带工作区时回退到全局根。界面 IPC（编辑器读写、审阅、文件树、@ 检索、终端）全部读取这个全局根，后台运行或界面切换都会让它们落到另一个项目。
- 编辑器标签只以相对路径为键，切换项目后保存同名标签会写进另一个项目；`ProjectManager.switchProject` 在原生切换失败后仍更新前端状态，且没有乱序保护。

Rust 内部虽有 `run_id`，但前端没有对应的运行身份，审批、检查点与消息之间无法关联。

## Decision

**会话即任务，工作区记在会话上。** `Conversation.workspace` 记录任务归属：字符串为原生层返回的规范路径，`null` 表示明确不绑定项目，缺省是早于该字段的旧会话。归属判定集中在 `domain/chat.ts` 的 `workspaceBinding` / `runWorkspaceFor`：

- 空白会话（pending）在用户按下发送的同步阶段读取当前项目并持久化绑定（`ChatRepository.setConversationWorkspace`）。
- 已绑定会话一律使用记录值；旧会话（legacy）按未绑定运行，不采用当前项目，界面显示“未绑定项目”并提供绑定入口。
- 已绑定到某个项目的会话不能改绑到另一个项目（仓储层事务内校验），运行中或发送中也不允许改绑。

**运行身份在提交时固定。** `startAssistant` 在同步阶段生成 `AgentRunRecord { id, workspace, executionMode, startedAt }`，随 assistant 消息持久化（`ChatMessage.run`）；执行模式取自发送入口时刻的值。请求携带 `agent.runId`、`agent.conversationId` 与绑定的 `workspace`；@ 引用通过 `createDesktopFileReader(workspace)` 读取任务所属项目。

**网关以请求为唯一来源。** `run_agent_chat_stream` 用 `resolve_run_workspace` 解析请求工作区（缺省即未绑定，目录不可用返回 `WORKSPACE_UNAVAILABLE`），不再读写全局根。`RunRegistry` 登记活跃运行，同一 `runId` 同时只能有一个运行（`RUN_ALREADY_ACTIVE`），登记凭据与工作区租约一同归执行任务持有，SSE 断开后仍保留到运行真正结束。流的第一个事件是 `run_started`，回报网关采用的运行编号与规范工作区；`GET /api/agent/runs` 列出活跃运行。

**界面操作显式携带工作区。** `execute_agent_tool`、`list_workspace_entries`、`search_workspace_files`、`read_head_file` 均接受 `workspace` 参数并重新规范化；省略即不针对任何项目。`WorkspaceManager` 的全局根只表示界面当前浏览的项目，工具执行不读取它。界面读取 `read_file` 由 `ui_tool_arguments` 强制返回完整原文，模型侧仍按 2000 行分页带行号。

**原生切换先于前端状态。** `set_workspace_root` 返回规范路径（Windows 去掉 `\\?\` 前缀）；`ProjectManager.switchProject` 只在原生成功后更新状态，并以递增序号丢弃较早返回的结果，失败时记录 `switchError` 由桌面布局提示。项目选择器与侧栏在切换失败时不新建对话。打开已绑定会话时把界面项目对齐到该会话的项目；对齐失败不影响任务归属。

**编辑器与审阅按工作区隔离。** 编辑器标签以“工作区 + 路径”为键，只显示当前项目的标签，其他项目的标签与未保存内容保留在内存；保存写回标签所属项目，Monaco model 同样按标签键缓存。审阅面板、文件树、终端、检查点都使用当前项目并在切换时重挂载。

## Alternatives considered

- 后端维护“已打开工作区”白名单并拒绝其他路径：界面 IPC 本就能以人工发起身份执行命令，白名单不提升安全边界，反而让重启后的旧会话在项目重新打开前无法运行。
- 由网关生成运行编号：重连与重复提交需要客户端事先持有的幂等键，因此由前端生成、网关校验格式与唯一性。
- 切换会话不对齐界面项目：文件树、编辑器与审阅会显示另一个项目，用户很难判断任务实际修改的位置。
- 旧会话默认采用当前项目：无法区分用户本意，可能把历史任务的后续操作写进无关项目。

## Consequences

- 任务目标不再受界面项目、全局根或后台运行影响；运行编号可以关联消息、审批编号与检查点清单（`{runId}-{callId}`）。
- 旧会话首次需要项目操作时，工具会返回“当前任务未绑定项目”，工具卡片与输入区提供绑定入口。
- 同一项目中的多个运行仍共享工作区与整目录检查点，并发写入的隔离不在本 Note 范围内（见后台运行 Note 的 Consequences）。
- Web 端没有原生层，`setDesktopWorkspaceRoot` 按原样接受路径，项目只是界面标识。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：新增 `run_identity_tests`（运行工作区取自请求且不改写界面项目、缺省不回退、目录不可用拒绝、重复与非法运行编号、原生切换失败保持原值、长文件界面读取为完整原文）。
- `npm run test:unit`：新增 `use-chat-controller.workspace.test.tsx`（提交后切项目仍用原项目、@ 引用读取任务项目、旧会话不偷用当前项目与显式绑定、切回已绑定任务、对齐失败不改归属、执行模式固定、禁止改绑、网关规范路径写入运行记录），以及项目切换失败/乱序、编辑器跨项目标签、仓储绑定约束、项目选择器失败不新建对话等用例。
- `npm run typecheck`、`npm run lint`。
