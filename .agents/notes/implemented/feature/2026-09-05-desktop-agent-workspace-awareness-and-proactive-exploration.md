# Agent Note: 桌面端 Agent 模式工作区感知与主动探索准则落地

Status: implemented

## Problem

在月见八千代 IDE 桌面端中，当用户选定项目（如 `chunlian`）并开启 Agent 模式发送简短或指代不明的问题（如「这是什么」）时，八千代未主动调用工具查看工作区项目，而是直接输出日常角色扮演闲聊台词。深入排查发现以下根因：
1. **Agent 系统提示词缺失工作区与项目上下文（Workspace Context）**：后端 `build_agent_system_prompt` 仅拼接了通用工具规则，未包含当前工作区绝对路径、项目名称与顶层目录文件结构，模型在完全不知道有项目存在的情况下接收到用户提问。
2. **缺失「项目指代识别」与「主动探索」准则**：原有准则仅提到“接到编码、文件、终端类任务时主动组合工具完成”，没有指示模型：当彩叶处于 IDE Agent 模式并询问「这是什么」、「这个项目是做什么的」、「分析项目」等问题时，其指代的对象均是当前工作区项目，必须首先主动调用工具（如 `list_directory(".")` 查看目录，或 `read_file` 查看 README.md / package.json）真实了解项目后再作答。
3. **前后端工作区状态同步脱节隐患**：前端向 `/api/chat` 发起流式请求时未携带当前 UI 选择的 `workspace` 路径；且前端 `projectManager.init()` 在启动时存在优先获取后端默认执行目录并冲掉本地历史选中项目的反向覆盖缺陷。
4. **工具 Schema 描述缺乏针对中文模型的细化引导**：工具仅有简短英文描述，未能给 StepFun（阶跃星辰）等模型提供“探索新项目、查看项目概括与代码结构”的强语义调用触发。

## Decision

1. **工作区顶级条目自动扫描与上下文注入（`src-tauri/src/gateway/prompt.rs`）**：
   - 升级 `build_agent_system_prompt(locale, current_time, workspace_root)`。
   - 当工作区有效时，自动扫描顶级目录与文件（忽略 `.git`, `node_modules`, `dist`, `target` 等），将项目名、绝对路径、前 35 项顶级目录列表及关键说明文件（`README.md`、`package.json`、`Cargo.toml`）检测提示动态注入系统提示词。
2. **【项目感知与主动探索准则 (融合 Claude Fable 5 标准)】落地（`src-tauri/src/gateway/prompt.rs`）**：
   - 深度结合 Claude Fable 5 核心准则：**亲自探查先行（Checks for itself）** 与 **行动优先（Action-first）**；
   - 规定当彩叶询问「这是什么」、「这个项目是做什么的」、「分析项目」、「项目结构」、「帮我看看代码」等疑问时，其指代的对象均为当前工作区项目；
   - 严禁在未读取项目前凭空捏造事实（杜绝将代码库臆想为直播后台、聊天应用等幻觉）；面对关于项目概括、功能或这是什么的疑问，必须**首先主动调用工具（`list_directory` 或 `read_file`）**查阅实际代码与说明文件，基于真实查阅结果给出专业解答。
3. **前后端工作区请求同步与持久化修复**：
   - `src/services/chat-client.ts` 与 `src-tauri/src/types.rs`：在 `StreamChatRequest.agent` 中增加 `workspace?: string` 契约字段。
   - `src/app/use-chat-controller.ts`：请求体的 `workspace` 取自会话绑定的项目（空白会话在提交时绑定当时选中的项目），不在请求发出时读取界面当前项目。
   - `src-tauri/src/gateway/agent/runtime.rs`：运行只使用请求给出的工作区，不改写、也不回退到网关记录的界面当前项目；详见 [运行身份与工作区归属](../architecture/2026-10-28-agent-run-identity-and-workspace-ownership.md)。
   - `src/services/project-manager.ts`：`init()` 优先使用本地已持久化的 `activeProject`，经原生层校验成功后才生效，避免启动时被后端默认工作目录覆盖。
4. **工具 Schema 强化（`src-tauri/src/tools/mod.rs`）**：
   - 为 `read_file`、`list_directory`、`write_file`、`run_command` 等补充详细的中英双语调用时机与使用场景说明。

## Consequences

- **收益**：
  - 彻底解决了 Agent 模式下因缺乏工作区感知导致「这是什么」被模型当作日常闲聊的问题；
  - Agent 具备了主动探索项目的本能，能够自主调用 `list_directory` 或 `read_file` 查阅项目；
  - 修复了项目切换与桌面端重启时的前后端工作区同步脆弱性。
- **验证**：
  - `npm run typecheck`：0 errors；
  - `npm run lint`：0 errors；
  - `npm run test:unit`：35 个测试文件、307 项测试全部通过；
  - `npm run test:functions`：22 个测试文件、267 项测试全部通过；
  - `cargo test --manifest-path src-tauri/Cargo.toml`：48 项测试全部通过；
  - `npm run build`：全量构建成功。
