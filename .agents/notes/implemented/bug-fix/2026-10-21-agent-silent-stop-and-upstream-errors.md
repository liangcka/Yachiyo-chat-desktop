# Agent Note: Agent 运行的静默结束与上游错误不可见

Status: implemented

## Problem

1. 某一轮输出因输出 token 预算耗尽被上游截断（`finish_reason: length` 等）时，循环只看到“没有工具调用”，当作正常完成：界面上回复停在半句、没有任何提示，表现为“莫名其妙停止”。截断轮次里的工具参数也可能不完整。
2. 上游返回 400 等错误时，前端统一显示“暂时连接不上，再试一次吧”，用户无法分辨是网络问题、Key 问题还是参数被拒。
3. 对话框选择的思考档位若不被某个模型接受（取值或字段不受支持），整次运行直接失败。

## Decision

- `HttpTurnExecutor` 读流时用 `is_output_limit_stop` 识别各协议的截断标记（Chat Completions `finish_reason: length`、Anthropic `stop_reason: max_tokens`、Gemini `MAX_TOKENS`、Responses `incomplete_details.reason: max_output_tokens`），先按子串过滤再解析。截断时返回 `OUTPUT_TRUNCATED`，循环以 `LoopOutcome::Truncated` 结束，下发 `done { truncated: true }`，界面显示截断提示；子 Agent 报告同样注明。
- 运行失败时网关下发 `UpstreamError`（编码为带 `message` 的 error 事件），`upstream_error_summary` 优先提取上游 JSON 的 `error.message` 并限制在 300 字符。前端把它作为 `errorDetail` 存入状态，错误横幅在通用文案下方显示原因。
- 带档位的请求收到 400 / 422 时，去掉强度字段重发一次，并通过 `notice { code: "REASONING_EFFORT_REJECTED" }` 提示“当前模型不接受所选推理强度，已按默认档位继续”；`effort_rejected` 置位后本次运行（含子 Agent）不再携带该档位。

## Alternatives considered

- 截断时自动续写：需要拼接半截的工具调用或正文，协议差异大；如实标记截断、由用户决定是否继续更可控。
- 给 `TurnOutcome` 增加截断字段：测试与执行器中有数十处结构体字面量，沿用复读检测的错误标记方式改动最小。
- 档位被拒时直接报错：用户只看到运行失败；自动降级加提示既不中断任务，也让用户知道档位没有生效。

## Consequences

- 截断轮次的 token 用量不计入本次运行统计。
- 400 / 422 只在请求带档位时触发重发；不带档位的参数错误仍按失败处理并显示上游原因。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（含 `test_rejected_reasoning_effort_retries_without_it_and_notifies`、`test_truncated_turn_ends_the_run_as_truncated`、`test_output_limit_stop_detection_per_protocol`、`test_upstream_error_summary_prefers_upstream_message`）
- `npm run test:unit`（含 notice 事件与 `errorDetail` 状态测试）
