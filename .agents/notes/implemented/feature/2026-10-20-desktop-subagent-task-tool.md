# Agent Note: 桌面 Agent 子 Agent（task 工具）

Status: implemented

## Problem

大范围检索、通读多个文件、多步系统排查时，每一次工具输出都留在主循环上下文里，后续每一轮都要重新发送；主上下文越滚越大，费用随轮次近似平方增长。主 Agent 也没有办法把一段独立调查交出去。

## Decision

- 新增 `task` 工具（`src-tauri/src/gateway/agent/subagent.rs`），参数 `description`（界面显示的简称）与 `prompt`（完整任务说明）。风险等级为只读，工具本身无需审批。
- `TurnExecutor::fork` 以独立的系统提示词与工具集派生同一模型通道的执行器（`HttpTurnExecutor` 克隆自身，测试执行器默认不支持）。子循环复用 `run_agent_loop_ext`，轮次上限 30，沿用主运行的执行模式、审批注册表与检查点。
- 子 Agent 的系统提示词是一段约 400 字的专用说明，不含角色人设；只看得到任务说明，看不到父对话。
- 子 Agent 工具从主运行本次实际下发的工具集中筛选：`read_file`、`list_directory`、`glob`、`grep`、`git_status`、`git_diff`、`web_fetch`、`web_search`、`run_command`。不给文件写入（留给掌握完整上下文的主 Agent）、MCP 与桌面控制（避免两个循环同时操作界面）、`task`（不允许嵌套）。只读模式、联网开关的限制自动沿用。
- 子循环的事件经过滤 sink：只把权限请求/决议与心跳转发给前端，正文与工具步骤不进入前端消息，否则会被当作主 Agent 的工具调用写进历史、抵消隔离。最后一轮正文作为报告，附带「子 Agent 共调用 N 次工具：read_file×3、grep×2」回填给主 Agent；子任务用量计入本次运行。
- 递归 Future（主循环 → 子 Agent → 主循环）通过显式 `BoxFuture` 返回类型的 `run_nested_loop` 切断，否则编译器推导 Send 时会陷入循环。
- 前端 ToolCard 为 `task` 显示机器人图标与「子 Agent · 简称」。

## Alternatives considered

- 同一轮多个 `task` 并行执行：子 Agent 共享 `&mut` 检查点，并行需要放弃 `run_command` 的检查点保护；且前端同一时刻只能展示一张权限卡，并行审批会互相覆盖。
- 把子 Agent 的工具步骤显示在主消息里：前端历史会把它们当作主 Agent 的调用重放给模型，上下文隔离失效。
- 子 Agent 使用更便宜的模型：需要额外的模型选择设置，暂沿用当前模型。

## Consequences

- 子任务运行期间界面只显示一张执行中的 task 卡片，看不到中间步骤。
- 子 Agent 在完全访问模式下可直接执行 `run_command`，提示词要求只做查询类命令，但约束依赖模型遵守。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（`tests/subagent_tests.rs`：只回传最终报告、子 Agent 看不到父对话、工具步骤不外泄、用量累加、工具筛选、缺参与不支持 fork 的报错）
- `npm run test:unit`（tool-description 新增 task 映射）
