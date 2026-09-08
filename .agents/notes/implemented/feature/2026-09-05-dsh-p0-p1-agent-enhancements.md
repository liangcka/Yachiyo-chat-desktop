# Agent Note: 借鉴 DSH 架构落地 P0/P1 能力（Tool Result Pruner、FS Observation Policy、todo_write 与 Spill Policy）

Status: implemented

## Problem

随着 Agent 模式开启多步循环驱动，系统暴露了三方面严重瓶颈：
1. **上下文与 Token 膨胀**：多轮循环中历史超长工具调用结果（如大文件读取、大命令输出）累积占用大量 Prompt 空间，不仅消耗大量 Token 且严重降低上游 KV-Cache 命中率。
2. **写操作破坏性与版本冲突**：模型在自主改写代码时存在“未看先写”和“盲目覆盖”风险，缺乏先读后改的强制防线与文件被外部并发修改时的检测机制。
3. **任务拆解不可见与大输出丢失**：复杂多步任务缺乏透明度，用户无法感知 Agent 正在执行哪一步；当单次命令产生超大输出时，单纯的前截断导致中间关键日志与信息永久丢失。

## Decision

对齐 **DeepSeek Harness (DSH)** 工业级规范，落地 4 项关键能力：

1. **无模型工具结果智能修剪（`gateway/agent/pruner.rs`，对齐 DSH `compaction-tool-result-pruner`）**：
   - 算法规则：当单项工具结果纯文本超过预算（`THRESHOLD = 8192` 字符）时，保留头部 4096 字符与尾部 1024 字符，中间无模型拼接 `\n\n[... 工具输出过长，已省略中间 N 字符以节省上下文 ...]\n\n`。
   - Replay-Safe 保证：数据库存储与前端 `toolSteps` 依旧保留完整结果，UI 展开审阅零失真，仅在向模型请求组装上下文时执行修剪。
2. **文件系统观察守卫（`tools/fs.rs`，对齐 DSH `fs-observation-policy`）**：
   - 引入会话级 `FsObservationTracker`，`read_file_guarded` 读取成功时记录规范路径及其 `mtime`。
   - `write_file_guarded` 拦截已有但未读过的文件写入，返回 `FS_NOT_OBSERVED: edit/overwrite requires reading '<path>' first — read the file, then retry.`。
   - 文件在读取后被外部进程修改时，CAS 校验拦截并返回 `FS_STALE_VERSION: file '<path>' has been modified since it was last read — re-read the file, then retry.`。
3. **任务清单工具与前端 Plan Strip（对齐 DSH `tool-todo`）**：
   - 注册 `todo_write(todos: [{ content, status }])` 工具（`ToolRisk::Read` 自动放行）。
   - 前端增加 `PlanStrip` 组件与 `extractLatestTodos` 状态机投影，在输入框上方提供支持折叠/展开、呼吸灯高亮当前任务与完成度统计的星空玻璃任务进度条。
4. **超大工具输出落地与引导（`tools/mod.rs` `process_tool_output`，对齐 DSH `spill-policy`）**：
   - 工具输出超过上限时（如 `run_command` > 16KB），自动将完整结果落盘至 `.yachiyo/spill/spill-{timestamp}-{tool}.txt`。
   - 返回双向预览与引导提示词，模型可按需使用 `read_file` 或 `grep` 定向检索该落地文件。

## Consequences

- **收益**：
  - 多步循环 Prompt 大幅紧凑化，保护了上游 LLM 的 KV-Cache 命中率与长会话耐久度；
  - 杜绝了模型未读盲写代码与冲突覆盖；
  - 用户可实时感知复杂重构任务的多步执行清单与当前进度；
  - 解决了大日志截断丢失信息的困境。
- **验证**：
  - `cargo test --manifest-path src-tauri/Cargo.toml`：47 项测试全绿（包含新增的 pruner, observation, todo_write, spill 单元测试）；
  - `npm run typecheck`：0 errors；
  - `npm run lint`：0 errors；
  - `npm run test:unit`：32 个测试文件、292 项测试全绿；
  - `npm run test:functions`：22 个测试文件、267 项测试全绿。
