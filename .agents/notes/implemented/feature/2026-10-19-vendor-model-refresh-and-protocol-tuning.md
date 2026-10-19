# Agent Note: 六家厂商模型清单更新与协议级针对性优化

Status: implemented

## Problem

模型清单落后于各厂商 2026 年 8—10 月的发布：DeepSeek 将 `deepseek-flash` 定为 V4.1 Flash 的正式调用名并原生支持图片，阶跃上线 `step-5-preview`，智谱新增 `glm-5.3-flashx`，OpenAI 发布 GPT-6 系列，Google 发布 `gemini-4-argon` 与 `gemini-3.8-flash`。

请求构造沿用一套通用参数，与各厂商新模型的协议约束不符：

1. **OpenAI**：GPT-5/6 推理模型拒绝 `max_tokens`；GPT-6 Astra 与 GPT-6.1 Sol 的 Chat Completions 不支持工具调用，GPT-6 Sol/Luna 只在 `reasoning_effort: none` 时支持。桌面端每次对话都走 Agent 循环，换用 GPT-6 后工具请求会被上游拒绝。
2. **Claude**：5 系列默认开启 adaptive thinking，思考 token 计入 `max_tokens`。标题只给 128、聊天只给 2048，预算会先被思考耗尽；思考默认 `display: omitted`，前端只收到空思考块。数万字符的角色提示词每次都按全价计费。Agent 循环只重建文本与 `tool_use`，丢掉了带签名的思考块。
3. **Gemini**：Gemini 3 校验当前轮次 functionCall 的 `thoughtSignature`，缺失返回 400。桌面 Agent 重建 functionCall 时没有带签名，第二个模型轮次起请求失败。另外请求未设 `includeThoughts`，思考摘要不会返回。
4. **GLM**：GLM-5.3 系列强制思考，不能传 `thinking.disabled`。GLM-4.7 起支持保留式思考，但 Agent 循环既没有开启，也没有回传 `reasoning_content`。
5. **桌面普通请求**：摘要预算只有 1024，小于 Web 端的 4096，推理模型的思考会挤占正文；StepFun 也没有像 Web 端那样下发 `reasoning_effort`。

## Decision

### 模型清单（`src/domain/llm.ts`、`functions/_shared/providers/*`、`src-tauri/src/gateway/providers/registry.rs` 三处同步）

- StepFun 新增 `step-5-preview`（支持图片），默认仍为 `step-3.7-flash`。
- DeepSeek 默认改为 `deepseek-flash`；`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 已由 V4.1 Flash 承接，保留在白名单里供已保存的配置继续使用。三者都列入图片白名单。厂商卡片移除即将下线的 `deepseek-chat`、`deepseek-reasoner`。
- GLM 新增 `glm-5.3-flashx`（原生多模态）。
- OpenAI 新增 `gpt-6-astra`、`gpt-6.1-sol`、`gpt-6-sol`、`gpt-6-luna`，默认改为 `gpt-6-luna`。
- Gemini 新增 `gemini-4-argon`、`gemini-3.8-flash`，默认改为 `gemini-3.8-flash`；`gemini-3.7-flash`、`gemini-3.5-flash` 已被上游路由到新版本，保留在白名单末尾。
- 通过自定义 baseUrl 接入的第三方厂商卡片（火山、MiniMax、Kimi 等）只提供预设标签，模型名由用户填写，不在本次更新范围内。

### OpenAI

- Web：`OpenAICompatConfig.openaiOfficialRules` 只在未自定义 baseUrl 时生效：输出预算改用 `max_completion_tokens`；GPT-5/6 推理模型下发 `reasoning_effort`（聊天 `low`、带图 `medium`、辅助请求 `low`）。`buildOpenAICompatBody` 改为接收由 adapter 解析出的选项对象。
- 桌面普通请求：同样改用 `max_completion_tokens`，推理模型下发 `reasoning_effort`。
- 桌面 Agent：OpenAI 改走 Responses API（`openai_responses.rs`）。`store: false`，推理模型附带 `include: ["reasoning.encrypted_content"]`，本运行内的输出项（推理、消息、函数调用）原样回传；客户端历史中的轮次重建为 `function_call` / `function_call_output`。流内的 `response.failed` 转为轮次错误。

### Claude

- 除 Haiku 4.5（仍是 `budget_tokens` 协议）外，所有模型都发送 `thinking: adaptive`：聊天带 `display: "summarized"` 以产出思考流；聊天、标题、摘要与联网判定使用 `effort: low`。Agent 沿用模型默认档位。
- 预算：标题 1024、摘要 4096、聊天 16000、联网判定 1024、Agent 64000。
- 缓存：system 在 `\n\n<runtime>` 处切成两段，前段（角色提示词）打 `cache_control` 断点；Agent 额外设置顶层自动缓存，让断点随只追加的运行内历史前移。`input_tokens` 只统计未命中缓存的部分，用量上报时加上缓存写入与读取。
- 拒答回退：`claude-fable-5-1`、`claude-opus-5-5`、`claude-opus-5`、`claude-sonnet-5-5` 发送 `fallbacks: "default"` 与 `anthropic-beta: server-side-fallback-2026-07-01`。联网判定不发送。
- 桌面 Agent：`AnthropicTurnCollector` 按 content block index 还原完整内容块（思考文本、签名、工具参数），下一轮原样回传。遇到 `fallback` 边界时，按回传规则丢弃边界之前的思考块与工具调用，只保留文本块；工具调用改为从内容块中提取。

### Gemini

- 聊天与 Agent 设置 `includeThoughts: true`；标题、摘要与联网判定不设。
- 桌面 Agent：`GeminiTurnCollector` 收集需要回传的 parts，正文合并为一个 text part，functionCall part 连同 `thoughtSignature` 原样保留，思考摘要不回传。

### GLM

- `glm-5*`、`glm-4.7*` 的 Agent 请求发送 `thinking: { type: "enabled", clear_thinking: false }`，assistant 消息按原文回传非空的 `reasoning_content`。不为没有思维链的历史轮次补写空串，这一点与 DeepSeek 不同。`glm-4.6`、`glm-4v-flash` 等混合或非思考模型不发送该开关。辅助请求不关闭思考，因为 GLM-5.3 系列强制思考。

### 回传通道

`AgentMessage::Assistant` 与 `TurnOutcome` 新增 `native: Vec<serde_json::Value>`，保存本轮的厂商原生输出。它只在同一运行内存在，客户端历史中的轮次为空，构造请求时回退到按文本与工具调用重建。运行内历史只追加，工具结果修剪是确定性的，回传块所绑定的前缀保持不变。

## Alternatives considered

- **OpenAI Agent 保留 Chat Completions，对 GPT-6 Sol/Luna 发送 `reasoning_effort: none`**：GPT-6 Astra 与 GPT-6.1 Sol 不接受 `none`，在 Chat Completions 下也没有工具调用能力，仍需第二条路径，而 Responses 能覆盖全部 OpenAI 模型。
- **Responses 请求附带 `reasoning.summary` 以展示思考摘要**：部分组织需要先完成验证才能请求推理摘要，未验证时会被拒绝，因此暂不开启。
- **Claude 聊天也使用顶层自动缓存**：`<runtime>` 段每分钟变化，自动断点落在其后，每次请求只会付缓存写入溢价而读不回来；只给稳定的角色提示词打断点才有收益。
- **GLM 辅助请求像 DeepSeek 一样关闭思考**：GLM-5.3 系列强制思考，在 Chat Completions 下传 `disabled` 会报错。
- **按回传规则只保留思考块、仍从流式聚合器取工具调用**：拒答回退边界之前的 `tool_use` 不应执行。从还原后的内容块提取工具调用，可以和回传内容保持一致。

## Consequences

- 桌面 Agent 在 GPT-6、Gemini 3/4 与 Claude 5 系列上的多轮工具调用符合各自的回传约束；Claude 与 GPT 的推理在工具轮次之间得以延续。
- Claude 角色提示词按缓存读取计费，Agent 循环每轮复用上一轮的前缀缓存。缓存 TTL 为 5 分钟，超过间隔的对话会重新写入。
- Claude 与 Gemini 聊天会流出思考摘要，前端 ThinkingBlock 沿用既有展示路径。
- 回退目标模型、各厂商默认档位与输出上限由上游决定；上游调整（例如 GPT-6 在 Chat Completions 下开放工具调用，或 Claude 改动 `fallbacks` 的 beta 头）时需要同步修改。
- 桌面网关仍不支持自定义 baseUrl，OpenAI 规则在桌面端对所有请求生效。

## Verification

- `npm run typecheck`：通过。
- `npm run lint`：0 errors（唯一的 warning 来自既有的 `ConversationView.tsx`）。
- `npm run test:unit`：全部通过。
- `npm run test:functions`：全部通过，新增 `OpenAI official endpoint rules` 用例组，以及 Claude 缓存分段、思考档位、拒答回退、缓存用量和 Gemini 思考摘要用例。
- `cargo test --manifest-path src-tauri/Cargo.toml`：全部通过，新增 Responses 请求体与流解析、Claude 内容块收集与回退边界、Gemini 签名回传、GLM 保留式思考、桌面普通请求预算与思考档位等用例。
