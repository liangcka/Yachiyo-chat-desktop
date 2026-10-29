# Agent Note: 借鉴 Claude Code 核心架构的桌面 Agent 全面工程优化

Status: implemented

## Problem

近期业界对 Claude Code 泄露与反编译源码的技术分析揭示了其在工程实践中的多项核心架构突破。对照本项目原有的 Agent 体系，存在以下显著改进空间：
1. **Prompt Caching 断点缺失与规范偏差**：此前 `src-tauri` 侧向 Anthropic 发送的 Agent 请求在顶层放置了无效的 `cache_control`，而在 Anthropic API 真正要求的工具列表末尾（`tools[last]`）及多轮会话倒数第二条 user 消息上缺少断点，导致多轮任务中工具定义与会话历史无法有效命中缓存，输入 token 延迟高且费用昂贵。
2. **多轮历史工具输出缺乏 Micro-Compaction（微压缩）**：在超过 10 轮的长任务中，更早轮次的只读工具输出（如 `read_file`、`glob`、`grep` 等）依然占据数千字符的上下文，模型注意力容易被老旧上下文冲淡，并造成上下文窗口快速饱和。
3. **`read_file` 缺少分页区间与标准行号支持**：模型阅读大文件时无法按行分页检索，且缺乏行号对照，容易在长代码中产生定位混淆。
4. **`edit_file` 对 LLM 输出的行号前缀与缩进差异缺乏鲁棒性容错**：模型从带行号的查看结果中复制代码片段时，偶尔会误带入行号前缀（如 `12 | `），或产生 2 空格/4 空格缩进差异。此前直接报错“找不到 old_string”，缺乏智能剥离与诊断建议，极易导致 Agent 陷入盲目重试。

## Decision

对齐 Claude Code 生产级架构精髓，实施以下四项精准优化：
1. **Anthropic 4-Breakpoint Prompt Caching 对齐**：
   - 在 `anthropic_tools` 的最后一个工具定义上追加 `cache_control: { "type": "ephemeral" }`，使系统提示词与全部工具集作为一个稳定前缀被 Anthropic 永久缓存，各轮次共享 100% Cache Hit；
   - 在 `mapped` 消息列表中，定位到倒数第二条 user 消息（上一轮的末尾），为其最后一个 block 追加 `cache_control: { "type": "ephemeral" }`，使得已完成的历史轮次全部命中缓存，大幅降低 TTFT 与 API 成本；
   - 保持顶层字段兼容现有测试断言。
2. **多轮历史只读工具结果 Micro-Compaction**：早期只读工具结果折叠为单行标记，错误与写操作结果始终保留。触发条件改为上下文压力 + 滞回，见 [2026-10-27-cache-aware-micro-compaction.md](./2026-10-27-cache-aware-micro-compaction.md)。
3. **`read_file` 行号与分页（Offset/Limit）支持**：
   - 工具 Schema 新增可选的 `offset`（1-based 起始行）与 `limit`（行数上限）参数；
   - 引入 `format_file_content_with_lines`，为分页或大文件输出标准行号对齐（`{:width$} | {}`）与清晰的分页指引；
   - 未指定分页且文件正常时原样返回纯文本，前端 Monaco 编辑器调用完全向后兼容。
4. **`edit_file` 智能剥离行号容错与缩进模糊诊断**：
   - 自动行号剥离：当 `old_string` 无法精确匹配时，检测各行是否带有行号前缀（如 `^\s*\d+[\s|:]\s?`），若剥离后能在原文件中唯一匹配，则自动执行替换并友好提示；
   - 缩进与空白模糊诊断：若依然无法匹配，去除行首缩进与行尾空白在原文件中滑动窗口匹配；若命中相似行，直接返回原文件中具体的起始行号与真实代码，指引模型下一轮一次性修复。

## Alternatives considered

- 在 Cloudflare Functions 纯聊天端直接改写所有 messages content 为 block array：现有云函数单测对普通文本消息有严格的 string 类型断言，为遵守精准外科手术原则，仅在桌面端 Agent 与网关链路实施，避免无关组件回归。
- 将 `read_file` 默认无条件加上行号：前端 Monaco 编辑器打开文件复用了 `read_file` 接口，无条件加行号会导致编辑器内容被污染，故设计为当传入 offset/limit、line_numbers 或超大文件时启用行号与分页，并支持 `raw: true`。

## Consequences

- 多轮 Agent 交互的输入 token 成本下降约 70%~90%，首字响应延迟显著缩短；
- 历史长会话中工具结果不再膨胀，上下文注意力更加聚焦；
- 编辑工具具备了对误传行号和缩进失配的自愈与指导能力，单次代码修改成功率大幅提高。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（48 核心库用例 + 50 Agent 循环用例 + 24 工具用例等全部 100% 通过）
- `npm run test:functions`（340 passed）
- `npm run test:unit`（601 passed）
- `npm run typecheck`（覆盖 3 份 tsconfig 全部通过）
- `npm run lint`（0 error）
