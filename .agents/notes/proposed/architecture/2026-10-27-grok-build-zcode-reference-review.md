# Agent Note: 参照 Grok Build 与 ZCode 的 Agent 网关与过程展示对比

Status: proposed

参照源码：

- Grok Build：`github.com/xai-org/grok-build`，SOURCE_REV `559751fd`（Rust，TUI + Agent 运行时）
- ZCode：`github.com/zai-org/ZCode`，v3.16.2（TypeScript，Electron 桌面端 + `apps/zcode-cli` Agent 运行时）

本文只记录差异与可借鉴点，按收益排序，不含实现。

---

## Problem

本项目桌面端 Agent 网关（`src-tauri/src/gateway`、`src-tauri/src/tools`）与聊天过程展示（`src/components/chat`）已具备：工具并发、循环检测、溢出落盘（spill）、读后写校验、行号前缀剥离、缩进诊断、只保留最新截图、Anthropic 缓存断点、命令分组、文件改动汇总与内联 diff。

对照两个参照项目后，存在一处与缓存目标直接冲突的设计，以及若干缺口。

---

## 一、Agent 网关与工具链

### 1. 【高】微压缩每轮改写历史，抵消 Prompt 缓存

现状：`gateway/agent/runtime.rs:179` 每一轮请求前都调用 `prune_agent_messages`。`pruner.rs:87` 以“倒数第 2 个 Assistant”为界，界前超过 300 字符（`pruner.rs:93`）的只读工具结果折叠为占位符。

问题：边界随每一轮前移，上一轮还完整的工具结果在下一轮被改写。前缀缓存（Anthropic 显式断点、OpenAI/DeepSeek 自动前缀缓存）要求前缀逐字节一致，于是此前写入的消息区缓存条目几乎都失效：每一轮只能命中 system + tools，消息区按缓存写入价（Anthropic 为 1.25 倍）重新计费。这与 `providers/anthropic.rs:302` 注释声明的“运行内历史只追加不改写”相矛盾。另一个副作用是：模型两轮前刚读过、正准备编辑的文件内容被清掉，会诱发重复读取。

参照做法：

- ZCode `core/src/compact/microcompact.ts`：只在两种条件下触发——**token 压力**（达到自动压缩阈值的 90%，或阈值减 2K）或**空闲超时**（距上次回复超过 60 分钟，此时缓存本已过期，清理不再有额外代价）；保留最近 5 个可压缩结果；预计节省不足 256 token 时不动。
- Grok `xai-chat-state/src/actor/request_builder.rs`：上下文占用超过 50% 才修剪；`mutations.rs:338` 的硬清理只在**新的用户消息**进来时做，并按“真实用户轮次”计龄，不按 Agent 内部迭代计龄。
- Grok `image_budget.rs` 的注释写明了原则：低于触发线时一律不动，保持 KV 缓存前缀稳定；一旦触发，清理到低水位线（滞回），只改写一次前缀，之后继续命中缓存。

建议：微压缩改为“压力触发 + 滞回 + 保留最近 N 个结果”；没有压力时历史只追加不改写。

### 2. 【高】单次 Agent 运行没有上下文上限保护

现状：跨轮次有摘要（`compressedUpTo` / `activeSummary`）和 20 条消息上限（`src/app/request-history.ts:6`），但一次运行内部的消息只增不减，除了微压缩之外没有任何按 token 计的上限；网关里也没有识别 “prompt too long / context_length_exceeded” 的分支。长任务越过模型窗口时只会以上游错误结束。

参照做法：

- ZCode `compact/policy.ts`：阈值 = 上下文窗口 − 输出预留（≤21K）− 缓冲 13K；以厂商返回的 usage 为准，本地按“字符数 / 3”估算新增部分；连续失败 3 次后熔断。压缩后的顺序固定为：边界 → 摘要 → 保留的最近消息 → 恢复上下文（最近读过的文件、计划状态等，见 `runtime/helpers/compact-post-reminders.ts`）。
- Grok `xai-grok-agent/src/compaction.rs`：上下文占用 85% 时自动压缩，单次压缩限时 300 秒；压缩前的原文按段落盘（`compaction/INDEX.md` + `segment_N.md`），模型之后可以用 grep / read 找回细节。

建议：运行内按 token 估算，到阈值时用同一模型生成摘要并替换早期轮次；早期原文复用现有 spill 目录落盘。内置厂商没有窗口配置，需要在 `providers/registry.rs` 中补上，自定义模型已有 `contextWindow` 可直接使用。

### 3. 【中】edit_file 只诊断、不容错

现状：`tools/fs.rs` 精确匹配失败后，只自动处理行号前缀（`fs.rs:250`）；空白不一致时只返回诊断（`fs.rs:293`），需要模型再调用一次。

参照做法：ZCode `core/src/tool/edit-matchers.ts` 按从严到宽的顺序依次尝试：精确 → 引号归一（弯引号 ↔ 直引号）→ 剥离行号 → 转义归一（`\n` `\t` 字面量）→ Unicode 转义归一 → 逐行去首尾空白 → 缩进弹性 → 首尾行锚定加中间行相似度 ≥ 0.8。只有候选**唯一**时才应用；`replace_all` 不使用后三种宽松策略；匹配成功后用 `preserveQuoteStyle` 让新文本沿用文件原有的引号风格。Grok `search_replace/mod.rs:409` 失败时额外给出“最近匹配行”，并在文件含智能引号、破折号等易混字符时明确指出是哪几行。

与本项目的相关性：角色提示词、i18n 文案和中文注释里大量使用 `“”` `「」` `——` 等全角字符，模型输出的却经常是 ASCII 引号，引号归一这一步收益最大。

建议：在 `edit_file_guarded` 中加入引号归一、逐行去空白、缩进弹性三级容错（要求唯一命中），并把命中的策略写进返回文本，方便模型和用户知情。

### 4. 【中】缓存命中情况不可观测

现状：`providers/anthropic.rs:423` 把 `cache_read_input_tokens` 与 `cache_creation_input_tokens` 合并进 `prompt_tokens`，前端无法看到命中率；第 1 条的问题因此一直没有暴露。

参照做法：ZCode 的 `AutoCompactTokenOverride` 分别记录 `cacheReadTokens` / `cacheWriteTokens`，用于压缩决策和日志。

建议：在 `TokenUsage` 中增加缓存读、写两个可选字段（OpenAI 兼容接口对应 `prompt_tokens_details.cached_tokens`），`ContextMeter` 或调试日志中显示命中率。这一项最好先于第 1 条落地，用来验证第 1 条的效果。

### 5. 【低】可按需参考，暂不建议照搬

- Grok 的 hashline 锚点编辑（`grok_build_hashline/`）：read_file 输出每行带短哈希，编辑时按锚点定位并校验新鲜度。需要同时改造读写协议和提示词，与现有 old_string 方案并存的成本较高；目前仍处于 benchmark 阶段（源码内带三种候选方案）。
- ZCode 的 bash 只读命令白名单（`bash-readonly-policy-*`）：逐条解析 argv，判定只读命令后免审批。本项目 `run_command` 统一走审批，若后续嫌审批过多再参考。

---

## 二、聊天界面与过程展示

本项目已有思考折叠与计时、命令分组、改动文件汇总、内联 diff、审批卡片，覆盖了 ZCode 的大部分基础能力。可借鉴的差异如下：

1. **改动汇总带增删行数**：ZCode `ToolCallBlocks/fileSummaries.ts` 为每个文件统计 `+N −M`，并区分新建、修改、删除。本项目 `FileChangeSummary.tsx` 只列出路径。数据可以从现有 `EditFileDiff` 的计算中复用。
2. **探索类步骤聚合（可选）**：ZCode `renderers/explore.tsx` 把连续的读取、搜索、列目录聚合为一行（例如“已探索 3 个文件、2 次搜索”），展开后显示明细。本项目 `MessageContent.tsx:68` 目前的约定是只把 `run_command` 收进分组，其他步骤逐行显示，理由是标题本身已经说明了做了什么。只有在一次读几十个文件、过程区过长成为实际问题时，才值得改这个约定。
3. **压缩边界可见**：落地第 2 条后，需要在时间线上标出“此前内容已压缩为摘要”（ZCode 对应 `tui/src/app-compact-timeline.ts` 与 `CompactBoundary`），否则用户会以为模型忘了前文。

---

## Proposal

建议按以下顺序推进，每一步都可以单独提交：

1. ~~缓存读写 token 分开上报（一、4）~~——已落地，见 [cache-aware-micro-compaction](../../implemented/performance/2026-10-27-cache-aware-micro-compaction.md)。
2. ~~微压缩改为压力触发 + 滞回（一、1）~~——已落地，同上。
3. edit_file 三级容错（一、3）。
4. 运行内自动压缩 + 时间线压缩边界（一、2 + 二、3）——改动面最大，需要单独设计 Agent Note。
5. 改动汇总增删行数（二、1）。

## Alternatives considered

- 直接删掉微压缩：上下文压力只能靠第 4 步兜底，第 4 步落地前长任务风险更高，因此不采用。
- 整体移植 ZCode 的 compact 状态机（boundary / summary / preserved segment / hooks / rewind）：本项目没有 rewind、hooks 等配套能力，按需裁剪即可。

## Acceptance criteria

- 连续 10 轮以上、包含多次 read_file 的 Agent 运行中，第 3 轮起 Anthropic `cache_read_input_tokens` 覆盖此前全部消息前缀（可在日志中核对）。
- 运行内 token 超过阈值时自动压缩并继续执行，不再以上游上下文超限错误结束。
- `cargo test --manifest-path src-tauri/Cargo.toml` 与 `npm run test:unit` 通过。

## Risks

- 压力触发阈值依赖窗口大小；内置厂商需要维护各模型的窗口表，估算偏差会导致过早或过晚压缩。
- 宽松匹配可能命中错误位置；必须坚持唯一命中，并在返回文本中写明使用了哪种策略。
- 摘要质量直接决定长任务的连续性，需要专门的摘要提示词，并保留最近 N 轮原文。
