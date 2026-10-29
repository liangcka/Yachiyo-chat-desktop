# Agent Note: 停止任务时立即断开进行中的上游请求

Status: implemented

## Problem

桌面 Agent 循环在独立的 tokio 任务中运行，用户点停止后前端中断 fetch，SSE 流被丢弃并置位取消标志。但循环只在每轮开始、每个工具调用前和等待审批时检查该标志，正在进行的上游流式请求（长时间思考或数万 token 的输出）会一直读到结束，厂商按完整输出计费。

## Decision

`run_agent_loop_ext` 用 `tokio::select!` 让 `executor.execute` 与 `wait_cancelled` 竞争：取消标志置位后立即返回 `LoopOutcome::Cancelled` 并丢弃上游请求 Future，reqwest 随之关闭连接，厂商停止生成。子 Agent 复用同一循环内核与同一取消标志，同样生效。`wait_cancelled` 以 200ms 周期轮询标志。

## Alternatives considered

- 给 `TurnExecutor::execute` 增加取消参数，在读流循环里检查：要改所有执行器实现与测试替身，且仍要在重试等待等多处补检查；在循环内核统一 select 一处即可覆盖。
- 把 `AtomicBool` 换成 `CancellationToken`：调用链与测试中大量以 `&AtomicBool` 传参，改动面大；200ms 轮询的开销可以忽略。

## Consequences

- 取消标志置位后（显式取消接口；2026-10-28 起 SSE 断开不再取消运行），上游连接在 200ms 内断开。
- 有副作用的工具不靠丢弃 Future 停止：命令在执行器内部终止整棵进程树并确认退出，MCP 调用给予收尾时间后才标记结果未知，见 [命令执行与可信取消](../architecture/2026-10-28-agent-command-execution-and-cancellation.md)。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（含 `test_cancel_drops_in_flight_upstream_turn`）
