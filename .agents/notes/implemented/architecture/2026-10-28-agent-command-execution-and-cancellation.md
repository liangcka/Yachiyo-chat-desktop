# Agent Note: 命令执行、验证证据与可信取消

Status: implemented

## Problem

- `run_command` 等待完整输出后返回字符串，非零退出只在文字末尾追加退出码，工具结果仍是成功；界面与模型都无法可靠判断测试是否失败。
- 命令期间没有任何输出，长命令看起来像卡住；默认 30 秒超时对测试与构建过短。
- `kill_on_drop` 只结束直接子进程（Windows 上是 PowerShell），shell 派生的子进程会留在后台；取消时命令不受影响，要等它跑完或超时。
- 前端停止即中断 fetch，网关随 SSE 断开取消运行，界面立即显示“已停止”，但命令与 MCP 调用可能仍在执行。
- 审批只凭 requestId 回填；验证结果只能从模型回复或计划清单推断。

## Decision

**受管命令执行（`tools/process.rs`）。** 命令以独立进程组（Unix `process_group(0)`）或带“关闭即终止”限制的作业对象（Windows，`taskkill /T` 兜底）启动。执行结果为结构化的 `CommandOutcome`：执行编号、命令、工作目录、退出码、耗时、结束原因（exited / timed_out / cancelled / spawn_failed / blocked）、是否确认整棵进程树退出、是否终止了残留后台进程、输出字节数与截断信息。只有“主进程退出码 0 且确认退出”才算成功；`run_command` 在 Agent 循环、界面终端与 `execute_tool_with_context` 中都以失败返回其余情况。

- 超时与取消先发终止信号，宽限 3 秒后强制结束，再在 2 秒内确认进程组/作业为空；无法确认时 `exitConfirmed=false`，界面与模型都标记结果未知。主进程退出后仍存活的后台进程随命令一并终止并说明原因。
- stdout/stderr 增量读取并做跨分块 UTF-8 解码；每 100ms 合并推送一次 `tool_output` 事件，单次超过 16KB 只推末尾并标注跳过字节数。完整输出 1MiB 内保存在内存，超出后写入 `.yachiyo/spill/command-*.log`，模型只收首尾与日志路径。默认超时 120 秒，上限 1800 秒。
- 回填模型的文本以“命令 / 工作目录 / 结果”开头，结论不会被长输出淹没；界面预览保留结论并取输出末尾。

**运行控制面（`RunRegistry`）。** 每个活跃运行持有取消标志与进程表。`POST /api/agent/runs/{runId}/cancel` 置位取消标志并返回“正在取消”快照；`/calls/{callId}/stop` 与 `/processes/{executionId}/stop` 只停止单条命令，运行继续，模型收到命令被停止的结果；`GET /api/agent/runs` 列出运行状态与正在执行的命令。（2026-10-28 阶段五起，SSE 断开不再置位取消标志，只有显式取消接口能取消运行，见 `2026-10-28-agent-run-reconnect-and-recovery.md`。）

**取消语义。** 循环停止调度新工具；模型请求与只读并发工具直接放弃等待（无副作用）；命令在执行器内部终止并确认后记录结果；MCP 调用不丢弃 Future，发出 `run_status: cancelling` 并最多等待 10 秒，仍未返回则以 `done.unknown` 报告结果未知。运行结束时 `done.reason = "cancelled"`。

**审批绑定运行与调用。** 审批编号为 `{runId}-{callId}`，`permission_request` 携带 `callId`；`/api/agent/approval` 必须给出 `runId`，运行已结束、已取消或编号不属于该运行时返回 409。循环在收到决定后再次检查取消标志，取消与批准同时到达时不执行。审批超时与拒绝分开：`permission_resolved.reason` 为 approved / denied / timeout，超时的工具结果明确说明未执行。

**前端状态。** 收到 `run_started` 的运行停止时走显式取消：消息显示“正在取消”及仍在等待的操作，停止按钮不可再点，连接保持到收到 `done(cancelled)`；随后记录 `cancellation.confirmed` 与无法确认的操作。取消接口不可用或 20 秒内未收尾时才断开连接，并把未收到结果的工具标为结果未知（断开连接不会取消网关中的运行）。命令卡片展示实时输出末尾、退出码与结束原因、完整日志路径，运行中可单独停止。

**验证证据（`domain/verification.ts`）。** 只依据 `ToolStep.result.command`：识别测试、构建、类型检查与静态检查命令（2026-10-28 起也识别在命令开头执行的项目测试/检查脚本，如 `sh test.sh`；读取脚本不算），同一命令以最后一次为准；退出码非 0 或超时为失败，取消、未确认退出或缺少结构化记录为未完成；验证之后本次运行又成功修改了文件则标记需要重新验证。修改了文件却没有运行验证时明确显示“未运行验证命令”。模型回复与计划清单都不参与判定。

## Alternatives considered

- 对命令 Future 套 `select` 后丢弃：只能断开等待，进程树仍在运行，正是需要消除的“伪装停止”。
- 仅靠 `taskkill /T` 或进程组：Windows 上 PowerShell 退出后孙进程脱离父子链，作业对象才能覆盖；作业分配前派生的进程再由 `taskkill` 兜底。
- 输出全部保存在内存或逐条推送：大日志会占满内存，高频小块输出会让界面逐条重渲。
- 由前端按命令文本判断失败：无法区分超时、取消与未确认退出，也会被模型的总结误导。
- 停止单条命令时结束整个运行：用户常常只想停掉误启动的常驻进程，运行应继续让模型处理。

## Consequences

- 需要常驻的服务不能通过 `run_command` 启动：主进程退出后残留进程会被终止，结果中会说明。
- 验证状态目前以本次运行中文件工具的修改判定是否过期；命令造成的改动要等运行级差异（阶段三）接入后才能纳入。
- Windows 作业对象代码在本环境通过 `x86_64-pc-windows-gnu` 编译检查，真实进程树行为未在 Windows 上执行验证。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：新增 `process_tests`（非零退出、超时与取消终止整棵进程树并确认退出、进程表查询与按执行编号/调用停止、残留后台进程终止、增量输出先于结束、超大输出首尾与完整日志、拦截与无法启动）与 `command_lifecycle_tests`（循环内失败命令传给界面与模型、长命令输出先于结果、运行取消终止命令且不再调度新轮次、审批超时与拒绝区分、取消后迟到的批准不执行、登记表拒绝跨运行与已取消运行的审批、真实 HTTP 网关的取消接口与迟到审批）。
- `cargo check --lib --target x86_64-pc-windows-gnu`：通过。
- `npm run test:unit`：新增取消流程控制器测试（正在取消→已取消且不提前断开、取消接口失败时标记未确认、审批携带 runId 且取消后不回填、增量输出只保留末尾并被结构化结果取代）、chat-client 新事件解析、验证投影、命令卡片与验证结论界面测试。
- `npm run typecheck`、`npm run lint`。
