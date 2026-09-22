# Agent Note: 桌面端 Agent 终端命令环境探查与解耦工作区执行 (对标 Trae Work)

Status: implemented

## Problem

在用户测试无项目状态下询问「帮我看看C盘有什么」时，与商业 AI IDE（如 Trae Work）直接调用 PowerShell 查看驱动器与列出目录相比，月见八千代出现以下问题：
1. **系统提示词死锁限制**：`src-tauri/src/gateway/prompt.rs` 在无工作区时硬编码注入“若彩叶的指令需要直接读取、修改本地工程文件或执行终端命令，请向彩叶说明需要先在输入框上方选择或打开一个项目工作区”，导致高智能/具备深度思考（CoT）的模型误以为执行任何终端命令都是违规的，并在思考后撒娇拒绝；
2. **后端 Rust 工具门禁强绑定**：`src-tauri/src/tools/mod.rs` 中 `run_command` 硬性校验 `workspace_root.ok_or(...)`，无工作区时直接抛出错误；
3. **前端/Tauri 统一调用点限制**：`src-tauri/src/lib.rs` 的 `execute_agent_tool` 同样直接拦截无工作区请求，使无项目时无法调用任何非工作区强依赖工具。

## Decision

1. **终端命令解绑工作区与默认 CWD 回退机制**：
   - `src-tauri/src/tools/mod.rs`：新增 `get_fallback_cwd()`，在 Windows 下优先使用 `%USERPROFILE%`，Unix 下使用 `$HOME`，兜底当前进程目录；
   - `run_command` 当 `workspace_root` 为 `None` 时，回退到 `get_fallback_cwd()` 执行，使磁盘探查、环境诊断或系统通用命令能够正常执行；
   - 更新 `run_command` schema 描述，明确指出该工具可用于系统环境检测、磁盘查询（如通过 PowerShell 获取盘符与文件信息）或执行诊断脚本，未打开工作区时在默认环境中执行。
2. **`execute_agent_tool` 统一适配 `execute_tool_with_context`**：
   - `src-tauri/src/lib.rs`：移除原本在 command 入口的无条件 `ok_or` 阻断，由 `execute_tool_with_context` 统一按各工具特性进行边界判定（`run_command`, `web_fetch`, `todo_write` 正常运行，`read_file`/`write_file` 软拦截引导）。
3. **系统提示词与行动准则升级**：
   - `src-tauri/src/gateway/prompt.rs`：
     - 更新未绑定工作区时的提示词：明确允许正常思考、分析与技术咨询；当彩叶询问系统环境、磁盘状态（如查看 C 盘或驱动器空间）、硬件网络或运行诊断脚本时，**应当主动使用 `run_command` 执行 PowerShell 探查并汇报真实数据**；
     - 仅当明确需要直接读取、修改特定工程源码文件时，才引导打开工作区；
     - 日语版提示词与双语 `AGENT_TOOLS_INSTRUCTION` 同步升级。

## Consequences

- **收益**：
  - 八千代具备了类似 Trae Work 的系统宿主环境探查与自动化运维能力，面对“帮我看看C盘有什么”等指令时能自如调用 PowerShell 探查汇报，不再机械化拒绝；
  - 维持了工程源码的安全边界与沙箱防护，对危险系统命令保留原有过滤与人工审批机制。
- **验证**：
  - `cargo test --manifest-path src-tauri/Cargo.toml` 新增 `test_run_command_fallback_cwd_without_workspace` 与 `test_loop_without_workspace_run_command_allowed` 验证通过；
  - 全量桌面端测试套件通过。
