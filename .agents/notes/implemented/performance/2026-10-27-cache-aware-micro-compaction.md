# Agent Note: 缓存友好的微压缩与缓存用量上报

Status: implemented

## Problem

Agent 循环每一轮请求前都要整理历史。原先的微压缩以“倒数第 2 个 Assistant”为界，把界前超过 300 字符的只读工具结果折叠掉。这个边界每轮前移，上一轮完整发送过的结果下一轮就被改写。前缀缓存要求历史逐字节一致，于是消息区缓存几乎每轮失效，只有 system 和工具定义能命中，其余按缓存写入价重新计费；模型两轮前刚读过的文件内容也会被清掉，诱发重复读取。

同时，缓存读写 token 被合并进 `prompt_tokens`，看不出命中率。另外，Agent 执行器每收到一个带 usage 的流事件就整体覆盖本轮用量，Anthropic 的 `message_start`（输入）被 `message_delta`（输出）覆盖，本轮输入 token 随之丢失。

## Decision

- `TokenUsage` 增加 `cacheReadTokens`、`cacheWriteTokens` 两个可选字段，二者都是 `promptTokens` 的组成部分。解析来源：Anthropic 的 `cache_read_input_tokens` / `cache_creation_input_tokens`；Chat Completions 依次识别 `prompt_tokens_details.cached_tokens`、DeepSeek 的 `prompt_cache_hit_tokens`、Moonshot 的顶层 `cached_tokens`；Responses 的 `input_tokens_details.cached_tokens`；Gemini 的 `cachedContentTokenCount`。没有上报的厂商保持缺省，不当作 0。
- 同一请求的多个流事件用 `TokenUsage::merge_from` 按字段合并，网关普通对话和 Agent 执行器共用这一个方法。整次运行的用量中，提示词与缓存字段一起取自最近一轮，因此两者之比就是最近一次请求的命中率。每一轮的提示词与缓存读写数写入 `tracing::info` 日志（“Agent 轮次用量”）。
- 前端 `ContextMeter` 面板在厂商上报缓存字段时，显示“上次请求缓存命中 X% · N”。
- `pruner::compact_agent_messages` 原地整理循环内的历史：
  - 超长工具结果只做一次确定性的首尾截断。截断结果低于阈值，后续轮次不会再变。
  - 模型可见内容按字符估算，低于高水位（16 万字符）时完全不改写。越过高水位后，从最早的只读结果开始折叠，直到低于低水位（8 万字符）为止。这次改写之后，前缀在很多轮内保持稳定。
  - 最近 5 个只读结果、最后一条 Assistant 之后（模型尚未看过）的结果、错误输出、写入类结果始终保留。

## Alternatives considered

- 按模型窗口比例触发（Grok Build 为 50% 修剪、85% 压缩；ZCode 为自动压缩阈值的 90%）：Rust 侧目前没有内置厂商的窗口表，自定义模型的 `contextWindow` 也只在前端。窗口表留待运行内自动压缩一并接入，本次先用按 128K 窗口留足余量的固定字符水位。
- 空闲超时触发（ZCode：上次回复后 60 分钟，缓存已过期，清理没有额外代价）：网关拿不到跨请求的时间信息，没有采用。
- 每轮清到刚好低于高水位：下一轮又会越线、再次改写前缀。因此一旦触发就清到低水位（滞回）。

## Consequences

- 没有上下文压力的运行中，消息区历史只追加不改写，各轮复用上一轮的前缀缓存。
- 很长的运行中，越线时会有一轮重新写入缓存，之后恢复命中。
- 字符估算对中文偏乐观（约 1.5 字符/token）。如果大量读取中文长文本，越线前就可能接近小窗口模型的上限；运行内自动压缩落地后，由它兜底。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：`pruner` 单测覆盖低于高水位不改写、越线后清到低水位并保持前缀稳定、本轮未读结果不清、最近与错误结果保留、默认截断幂等；`gateway_tests` 覆盖各厂商缓存字段解析与序列化；`agent_tests` 覆盖 Anthropic 一轮内输入、输出用量合并。
- `npx vitest run src/components/ContextMeter.test.tsx src/services`：缓存命中行的显示与隐藏。
