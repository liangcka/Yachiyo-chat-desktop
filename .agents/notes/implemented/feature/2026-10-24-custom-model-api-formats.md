# Agent Note: 自定义模型的 API 格式与高级参数

Status: implemented

## Problem

「自定义模型」只能填 OpenAI 兼容端点、模型名与 Key，所有请求固定走 `/chat/completions`。接入只提供 Anthropic Messages 或 OpenAI Responses 协议的中转、需要按完整地址请求的网关，或需要调整输出预算、思考开关与采样参数的模型时无从配置；工具调用轮数与图片能力也只能沿用全局默认。

## Decision

- **存储**：`LlmSettingsRecord.custom`（`CustomModelSettings`）只随自定义端点（`baseUrl`）保存，存在即表示该配置按「自定义模型」编辑。旧版保存的自定义端点没有 `custom`，按 Chat Completions 处理，编辑后补齐；读取时经 `normalizeCustomModelSettings` 逐字段校验，非法字段丢弃、未知协议回退为 `chat_completions`，无需 Dexie 版本迁移。
- **请求契约**：聊天请求新增可选 `customModel`（`apiFormat`、`fullUrl`、`family`、`maxOutputTokens`、`thinking`、`temperature`、`topP`、`topK`），**必须与 `baseUrl` 同时出现**，否则 Functions 与桌面网关都按 `INVALID_REQUEST` 拒绝；未知字段与越界值整体拒绝（Rust 侧 `deny_unknown_fields`）。展示名、上下文窗口、工具轮数与图片能力只在前端生效，不下发。
- **端点**：`fullUrl` 为真时原样请求；否则剥掉尾部斜杠后按格式补 `/chat/completions`、`/responses` 或 `/messages`。前端 `resolveCustomEndpoint`、Functions `resolveCustomEndpoint`、Rust `custom_model::resolve_endpoint` 规则一致。
- **协议**：Functions 用 `buildCustomModelAdapter` 按格式构造请求、判定请求（联网搜索 judge）与流解析；桌面网关在普通路径（`build_upstream_request`，标题/摘要/连通性测试）与 Agent 执行器（`HttpTurnExecutor.custom_model`）中按格式选择 `WireProtocol`，鉴权头随协议（Anthropic 用 `x-api-key` + `anthropic-version`，不带官方专属的 beta 头），流按协议解析。
- **模型系列**：显式选择的系列优先于端点主机名识别兼容厂商规则（qwen→百炼、glm→智谱、kimi→Moonshot、doubao→方舟、minimax→MiniMax；deepseek 额外启用 DeepSeek 的辅助请求关思考与 Agent 思维链回传），并决定思考开关的写法：GPT 用 `reasoning_effort`（none 为关），千问用 `enable_thinking`，MiniMax 只能 `thinking.disabled`，其余用 `thinking.type`。
- **思考模式**：缺省不发送任何思考字段；「关闭」对所有请求生效并去掉互斥的 `reasoning_effort`；「开启」只作用于聊天与 Agent，标题与摘要保持厂商规则以免耗尽小预算。Responses 开启为 `reasoning.effort=medium` + `summary=auto`、关闭为 `effort=none`；Anthropic 开启用第三方普遍支持的 `budget_tokens`（≥1024 且小于 `max_tokens`），并移除原生构造器按 Claude 5 规则写入的 adaptive 思考、`output_config` 与 `fallbacks`；开启思考时不发送 `temperature` 与 `top_k`。
- **输出预算**：缺省沿用各协议原生路径的默认值（Anthropic 必填：聊天 16000、Agent 32000）；用户上限对聊天与 Agent 直接生效，标题与摘要取两者较小值。GPT 系列用 `max_completion_tokens`。
- **采样参数**：留空不发送；Responses 不发送 `top_k`。
- **工具轮数**：桌面端 Agent 请求的 `agent.maxTurns` 取自定义模型的 `maxToolRounds`（缺省 500）。
- **图片能力**：`supportsImageInput` 对自定义模型按其开关判断，同时决定 Agent 是否下发截图工具。
- **思考档位**：自定义模型选择非 Chat Completions 格式或显式关闭思考时，桌面网关不再附加对话框选择的档位。
- **连通性测试**：保存前以 `mode: "title"` 发起一次真实请求，失败时表单保留并显示原因，不保存。

## Alternatives considered

- **为自定义 Anthropic 端点新开 `claude` 存储槽**：桌面网关的密钥槽与厂商绑定，换槽会让已存 Key 与端点绑定失效且需要迁移；协议由 `apiFormat` 决定、槽仍用 `openai`，改动最小。
- **Anthropic 开启思考沿用 adaptive**：只有官方 Claude 5 支持，第三方兼容端点普遍只认 `budget_tokens`。
- **把上下文窗口用于请求裁剪**：现有请求预算按字符统一控制（Functions 有硬上限），本次只用于界面上下文用量估算，避免与服务端限制冲突。

## Consequences

- Functions 与桌面网关各有一份规则（`functions/_shared/providers/custom-model.ts` 与 `src-tauri/src/gateway/providers/custom_model.rs`），改动任一侧须同步另一侧。
- 默认系列下「开启/关闭思考」发送 `thinking.type`，不认识该字段的严格端点（如 OpenAI 官方）需选择对应系列或保持「跟随默认」。

## Verification

- `npm run typecheck && npm run lint && npm run test:unit && npm run test:functions`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- 新增单测：`functions-tests/_shared/providers/custom-model.test.ts`、`functions-tests/_shared/validation.test.ts`、`functions-tests/api/chat.test.ts`（Anthropic 格式路由）、`src/domain/llm.test.ts`、`src/services/llm-settings.test.ts`、`src/components/LlmSettingsPanel.test.tsx`、`src/app/use-chat-controller.test.tsx`、`src-tauri/tests/gateway_tests.rs`、`src-tauri/tests/agent_tests.rs`
