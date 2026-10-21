# Agent Note: 对话框思考档位选择器

Status: implemented

## Problem

桌面 Agent 的思考深度此前固定：Claude、OpenAI 沿用模型默认档，Gemini 固定 low，多数 OpenAI 兼容厂商不传强度字段。用户无法按任务调高或调低思考深度；而各厂商、各型号接受的强度取值差异很大（有的只有三档，有的完全不支持），盲目下发会直接 400。

## Decision

- 界面统一五档：轻度 / 中 / 高 / 极高 / Ultra（`low` / `medium` / `high` / `xhigh` / `max`），类型为 `ReasoningLevel`（Rust `types.rs` 与前端 `services/reasoning-effort.ts`）。
- 能力表只在桌面网关维护：`gateway/providers/reasoning.rs` 的 `reasoning_support` 按厂商、端点与型号给出可选档位、原生取值与默认档，只收录已核实取值的模型，其余返回 None（Claude Haiku 4.5、GPT-4.1、Kimi K2.x、MiMo、自定义未知端点等）。
- 前端经 `POST /api/reasoning/levels` 查询档位渲染滑杆；不支持时按钮禁用并提示“当前模型不支持调节推理强度”。选择按 `厂商|端点|型号` 记在 localStorage，未选择或重置时请求不带 `reasoningEffort`，各厂商默认规则保持不变。
- 网关收到 `reasoningEffort` 后用 `native_effort` 换算原生取值（模型不提供该档时忽略），`HttpTurnExecutor` 构造请求体后由 `apply_agent_effort` 写入：Chat Completions 的 `reasoning_effort`、Responses 的 `reasoning.effort`、Anthropic 的 `output_config.effort`、Gemini 的 `thinkingConfig.thinkingLevel`，覆盖厂商规则给出的默认档。子 Agent 继承同一档位。
- 选择器只在桌面端显示：Web 端 Functions 不识别该字段。
- 能力表之外的兜底：上游以 400 / 422 拒绝档位时去掉强度字段重发并提示，详见 `bug-fix/2026-10-21-agent-silent-stop-and-upstream-errors.md`。
- Ultra 档的轨道带星点闪烁与流星划过动画，只动 `opacity` / `transform`，仅在弹层打开时运行，减少动效偏好下关闭。

## Alternatives considered

- 前端维护一份能力表：与 Rust 侧的厂商规则重复，两边容易漂移；网关本就负责厂商识别与参数改写。
- 对不支持的模型隐藏选择器：用户无法分辨是没加载出来还是模型不支持，禁用并说明更清楚。
- 每档都显示、后端就近取值：会让“极高”“Ultra”在只有三档的模型上静默退化，滑杆只展示模型真实提供的档位。

## Consequences

- 新增型号或厂商开放新取值时，只需更新 `reasoning.rs` 的能力表与对应测试。
- 中途切换档位会改变请求参数，Anthropic 等厂商的消息前缀缓存在下一轮失效一次。
- Agent 运行内档位固定，切换在下一次发送时生效。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（含 `test_reasoning_support_lists_only_verified_levels`、`test_agent_effort_lands_where_each_protocol_expects`、`test_chat_request_accepts_reasoning_effort`、`test_gateway_reports_reasoning_levels`）
- `npm run test:unit`（含 `reasoning-effort.test.ts`、`ReasoningEffortSelect.test.tsx`）
- `npm run typecheck`、`npm run lint`
