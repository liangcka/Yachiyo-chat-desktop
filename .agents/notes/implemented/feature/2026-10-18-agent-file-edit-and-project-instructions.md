# Agent Note: 片段编辑、项目指令与消息修改汇总

Status: implemented

## Problem

文件局部修改需要明确的片段匹配契约，避免模型为少量改动重写整个文件。Agent 还需要在每个请求中取得项目约定，并在回复结束后给用户一个稳定的修改审阅入口。

## Decision

- `edit_file(path, old_string, new_string, replace_all = false)` 用于已有文件的局部修改；`write_file` 用于新建或整体重写。空原文不允许编辑，默认要求唯一匹配；全量替换仍要求至少一处匹配。
- 编辑复用 `FsObservationTracker` 的先读后写与版本校验，并通过现有原子写入落盘。输入片段的换行与文件保持一致，未匹配部分保持原样。文件工具读取同一轮写入后的版本观察继续有效。
- `edit_file` 使用 Write 风险、相同路径的 `approval_key` 和现有轮次检查点机制；未选择项目时拒绝写入，批准不绕过版本保护。
- 每次构造 Agent 系统提示词时读取项目根目录的 `AGENTS.md` 与 `CLAUDE.md`，各自最多注入 8192 字节，按字符边界截断并标注。不存在或无法读取的文件不注入，路径沿用工作区保护。项目指令放在工作区概览之后，低于平台安全及授权规则，高于默认习惯。
- 工具卡和审批卡共用片段行级 diff，行号相对于片段；`replace_all` 单独标明，避免预览被误读为完整文件改动。
- 纯函数从已完成的助手消息提取成功的 `write_file` / `edit_file` 路径，统一路径分隔符并去重。汇总卡在最终回答之后显示，通过桌面布局提供的上下文打开现有右侧代码审阅标签。卡片统计工具报告的成功写入文件，不计算最终净差异。
- 权限提交接口返回成功状态；请求失败时权限卡恢复按钮并提示重试，不同请求通过 `requestId` 隔离提交状态。编辑器的审阅入口与汇总卡打开同一个右侧标签，文件树跟随当前选中项目。

## Alternatives considered

- 继续用整文件写入处理局部修改：模型需重复未改动内容，片段意图也不便审批。
- 单独实现编辑授权与备份：会使两种写入工具的权限范围和恢复语义分叉。
- 缓存项目指令：项目文件变化后无法在下一次请求立即生效。
- 逐层传递审阅回调：增加对话列表和消息组件的布局耦合，使用桌面入口上下文即可复用现有审阅面板。

## Consequences

工具名称、参数和提示词形成新的模型可见契约。两种文件写入工具共享同一路径授权；用户批准其中一种的长期路径授权也适用于另一种。项目指令读取不建立文件工具的读取观察，模型编辑指令文件前仍须调用 `read_file`。汇总沿用消息已有的工具记录，不新增持久化字段或依赖。

## Verification

- `npm run typecheck`：通过。
- `npm run lint`：通过；保留 `ConversationView.tsx` 现有的 `react-hooks/incompatible-library` 警告。
- `npm run test:unit`：61 个文件、502 项测试通过。
- `npm run test:desktop`：109 项测试通过，覆盖片段匹配、版本保护、审批、检查点回滚和项目指令读取。
- `npm run dev:mock`：浏览器验证工具 diff、审批 diff、汇总卡、审阅入口与日文文案；浅色和深色主题、960px 和 640px 宽度均无新增页面错误或横向溢出。截图为 `agent-core-light.png`、`agent-core-dark.png`、`agent-permission-light.png`、`agent-permission-dark.png`。
