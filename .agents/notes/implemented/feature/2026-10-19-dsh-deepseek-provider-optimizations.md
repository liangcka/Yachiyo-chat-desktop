# Agent Note: 移植 DSH 的 DeepSeek 专属请求优化（思维链回传、辅助请求关闭思考、Agent 输出预算）

Status: implemented

## Problem

DeepSeek 在 Web（Cloudflare Pages Functions）与桌面端（Tauri 网关）均通过 OpenAI 兼容端点 `/v1/chat/completions` 调用，沿用与 StepFun、GLM、OpenAI 相同的通用请求体，缺少 DeepSeek 协议层面的三项约束：

1. **思维链未回传**：DeepSeek V4 默认开启思考模式，要求后续请求中的 assistant 消息携带 `reasoning_content`，工具调用轮次缺失时上游直接以 400 拒绝。桌面端 Agent 循环只把思考流转发给前端展示，不写入循环历史，第二个模型轮次起即违反该约束；客户端重放的历史工具轮次同样没有该字段。
2. **辅助请求被思考耗尽**：思考 token 计入 `max_tokens`。标题（512）、摘要（Web 4096 / 桌面 1024）与联网判定（512）的预算很小，默认开启的思考可能先耗尽预算，导致正文为空或被截断。
3. **Agent 输出预算依赖服务端默认值**：Agent 请求不携带 `max_tokens`，长文件写入或深度推理受未公开的服务端默认上限约束，工具参数 JSON 可能被截断。

## Decision

参照 DeepSeek Harness（DSH）`packages/llm/llm-deepseek` 适配器的协议规则，以及其 pi-ai 孪生适配器对 DeepSeek 的兼容声明（`thinkingFormat: deepseek`、`requiresReasoningContentOnAssistantMessages`），仅在 DeepSeek provider 上生效：

1. **思维链回传（对齐 DSH `2026-08-19-deepseek-reasoning-passback-every-turn`）**：
   - `AgentMessage::Assistant` 新增 `reasoning` 字段；`HttpTurnExecutor` 累积本轮 `reasoning_content` 流到 `TurnOutcome.reasoning`，循环写入下一轮历史。
   - `build_openai_agent_body` 接收 `ProviderId`，DeepSeek 下每条 assistant 消息都携带 `reasoning_content`：本次运行内的轮次回传原文，客户端重放的历史轮次回传空串。其他 provider 的请求体不变。
2. **辅助请求关闭思考（对齐 DSH 辅助调用的 `thinking: { type: "disabled" }`）**：
   - Web：`OpenAICompatConfig.deepseekThinking` 标记 DeepSeek 格式的思考开关，标题、摘要与联网判定请求发送 `thinking: { type: "disabled" }`。
   - 桌面：`build_openai_compat_body` 对 DeepSeek 的标题与摘要请求同样关闭思考。
   - 普通对话与 Agent 请求保持服务端默认思考强度。
3. **Agent 输出预算（对齐 DSH `2026-07-30-adapter-owned-max-token-defaults`）**：DeepSeek Agent 请求显式发送 `max_tokens: 256000`（`DEEPSEEK_AGENT_MAX_TOKENS`），不超过 `deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp` 公布的单次输出上限。

## Alternatives considered

- **改用 DSH 当前的 Anthropic Messages 端点（`https://api.deepseek.com/anthropic`）**：可获得思考签名、Files 图片上传与 in-history system 更新，但需重写两端的序列化、流解析与错误分类，Web 自定义 `baseUrl` 网关也只承诺 OpenAI 兼容格式。本次只移植在 OpenAI 兼容端点上同样成立的规则。
- **只在工具调用轮次回传 `reasoning_content`**：DSH 曾采用该策略，后因转发网关依赖思维链重建会话而改为每个推理轮次回传；pi-ai 对 DeepSeek 亦要求每条 assistant 消息带该字段。该字段在不需要的轮次上被忽略，统一回传更稳妥。
- **前端历史持久化并回传思维链**：DeepSeek 对新一轮用户提问之前的思维链不作要求，回传空串即可满足协议，无需扩展前端存储与请求契约。
- **暴露思考强度（off/low/high/max）设置项**：属于新的用户可见功能，需要配套设置界面与持久化，不在本次范围内。
- **DSH 遥测类字段（`dsh_session_log`、`dsh_plugin_packages`、`x-deepseek-harness-*` 请求头）**：属于 DSH 产品自身的归因与日志上传，不适用于本项目。

## Consequences

- DeepSeek Agent 多轮工具调用不再因缺少 `reasoning_content` 被拒绝；回传的思维链计入后续请求的输入 token，但位于固定位置，前缀在运行内保持稳定，不影响 KV Cache 复用。
- 标题、摘要与联网判定在 DeepSeek 上不再产生思考 token，延迟与成本下降，输出不再被思考挤占。
- Agent 请求的输出预算由本项目显式决定；若 DeepSeek 后续下调单次输出上限，需要同步调整 `DEEPSEEK_AGENT_MAX_TOKENS`。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：全部通过，新增 `test_deepseek_agent_body_replays_reasoning_and_sets_output_budget`、`test_loop_carries_turn_reasoning_into_next_request`、`test_deepseek_auxiliary_requests_disable_thinking`。
- `npm run test:functions`：全部通过，新增 `DeepSeek thinking toggle` 用例组。
- `npm run typecheck`、`npm run lint`：0 errors。
