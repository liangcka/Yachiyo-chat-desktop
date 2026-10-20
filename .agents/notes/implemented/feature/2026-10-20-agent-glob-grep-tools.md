# Agent Note: 原生 glob 与 grep 检索工具

Status: implemented

## Problem

Agent 只有 `read_file` 与 `list_directory` 两种读取手段，定位文件或符号时只能逐层列目录，或借 `run_command` 调用 `dir`、`findstr`、`Select-String` 等命令。前者轮次多、上下文开销大；后者属于写风险工具，每次都要审批，且输出格式随平台变化。

## Decision

- 新增 `glob(pattern, path?)` 与 `grep(pattern, path?, glob?, output_mode?, case_insensitive?, context?, head_limit?)`，实现在 `src-tauri/src/tools/search.rs`，参数与输出形态对齐 ripgrep 的常见用法：`files_with_matches`（默认）、`content`（`文件:行号:内容`，上下文行用 `-` 分隔）、`count`。
- glob 由内部翻译为锚定正则，支持 `**`、`*`、`?`、`[...]`、`[!...]`、`{a,b}`；不含 `/` 的模式匹配任意层级。结果按修改时间倒序，最多 200 条。
- 两个工具都归入 Read 风险，自动放行，只读模式仍可用。必须已选择项目；起点路径经 `resolve_tool_path` 校验，拒绝越界与检查点私有存储。
- 遍历复用 `SEARCH_IGNORE_DIRS`（含 `.git`、`node_modules`、`target`、`.yachiyo` 等），单次最多扫描 20000 个文件；grep 跳过大于 2MB 或前 8KB 含 NUL 的文件，文本解码复用 `decode_file_bytes`。
- 系统提示词与 `run_command` 描述明确禁止用 shell 命令检索文件，引导模型改用这两个工具，并允许同一轮并行发起相互独立的读取与检索。
- 正则引擎使用已在依赖树中的 `regex` crate，设定编译体积上限，避免病态模式占用内存。

## Alternatives considered

- 引入 `ignore` / `globset` crate 以支持 `.gitignore`：新增依赖与下载体积，当前忽略目录表已覆盖主要场景。
- 调用系统 `rg`：Windows 用户通常未安装，且需走命令执行审批。
- 扩展 `search_workspace_files`：该函数服务于 `@` 引用的模糊匹配，评分语义与精确检索不同。

## Consequences

工具名、参数与输出格式成为新的模型可见契约；前端 `formatToolDescription` 与工具卡图标随之扩展。未遵循 `.gitignore`，被忽略但不在默认忽略表中的目录仍会被检索。

## Verification

- `npm run test:desktop`：全部通过，新增 5 项用例覆盖 glob 翻译、忽略目录、越界与检查点拒绝、三种输出模式、上下文与 head_limit。
- `npm run test:unit`：66 个文件、524 项测试通过，含工具描述的中日文映射。
- `npm run typecheck`：通过。
- `npm run lint`：通过；保留 `ConversationView.tsx` 现有的 `react-hooks/incompatible-library` 警告。
