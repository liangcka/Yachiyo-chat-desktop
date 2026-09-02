# Yachiyo IDE 演进差距分析

本文档以"**带 Live2D 看板娘的代码 IDE**"为目标形态（UI 对标 Codex / Claude Code / Antigravity / Trae Work），对仓库当前状态做系统性差距分析，作为后续演进规划的基准。

***

## 1. 目标形态定义

- **产品定位**：面向开发者的 AI 代码 IDE，差异化在于二次元看板娘陪伴与星空玻璃视觉体系。

- **能力基线**（判定"是否达成"的标准）：

  1. Agent 能多步链式完成任务（读 → 改 → 执行 → 验证 → 修复），用户可介入审批；
  2. 用户能看代码、改代码、审阅 Agent 的改动（编辑器 + diff + 逐块采纳）；
  3. 界面是 IDE 骨架（活动栏 / 面板 dock / 状态栏 / 命令面板），而非聊天三栏；
  4. 桌面端有发布流水线与自动更新，可分发给外部用户。

## 2. 现状基线（已有资产）

| 能力                                              | 位置                                          | 成熟度       |
| :---------------------------------------------- | :------------------------------------------ | :-------- |
| 双轨隔离架构（云原生 + 桌面独立）                              | `docs/ARCHITECTURE_ISOLATION.md`            | 已落地       |
| 桌面 Rust 工具沙箱（7 工具 + 工作区白名单）                     | `src-tauri/src/tools/`                      | 可用        |
| 桌面本地网关（Axum + 6 家 Provider 直连）                  | `src-tauri/src/gateway/`                    | 可用        |
| AES-256 本地密钥存储、系统托盘、单实例                         | `src-tauri/src/crypto/`、`lib.rs`            | 可用        |
| 工作区面板（根目录列表 + 命令执行 + git status/diff）           | `src/components/desktop/WorkspacePanel.tsx` | 雏形        |
| 桌面三栏布局 + 快捷键                                    | `src/views/desktop/DesktopLayout.tsx`       | 可用        |
| 联网搜索管道（云端）                                      | `functions/_shared/web-search/`             | 可用        |
| 分层测试体系（unit / functions / desktop / e2e / perf） | `package.json` scripts                      | 健全（覆盖有盲区） |

## 3. 差距清单

严重程度：🔴 致命（不补就无法称为 IDE）／ 🟠 严重（影响可用性）／ 🟡 一般（影响体验或维护）。

### A. Agent 内核层

| #  | 严重度 | 差距                                                                                                                           | 证据                                                                      |
| :- | :-- | :--------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| A1 | 🔴  | **无多步 Agent 循环**。当前仅支持"流结束后解析单个工具调用 → 执行一次 → 第二轮汇报"，无法链式完成多步任务                                                               | `src-tauri/src/gateway/mod.rs` L361-L393                                |
| A2 | 🔴  | **非原生 function calling**。工具调用依赖正则解析  ` ```tool_call`  ` 文本协议；`get\_agent\_tools\_schema()`生成了标准 schema 却未通过 API`tools\` 字段下发 | `src-tauri/src/gateway/mod.rs` L23-L54、`src-tauri/src/tools/mod.rs` L54 |
| A3 | 🔴  | **工具结果走四层手写协议**（Rust 塞 markdown 代码块 → SSE → 前端正则解析渲染），契约脆弱，任一层变动全链路断裂                                                        | `src/components/MessageBubble.tsx` L29                                  |
| A4 | 🔴  | **无权限确认门 / 无 checkpoint 回滚**。写文件、执行命令前无人工审批；无法回滚 Agent 破坏性操作                                                                 | `src-tauri/src/tools/mod.rs`（`execute_tool` 直通执行）                       |
| A5 | 🟠  | **无任务规划与待办体系**。对标 Claude Code plan 模式 / Trae Work 任务面板，缺少可暂停、可审阅的任务结构                                                        | 全局缺失                                                                    |
| A6 | 🟠  | **云端路径零工具能力**。请求模型无 tool 字段，Web/移动端为纯聊天                                                                                      | `functions/_shared/validation.ts` L26-L38                               |

### B. IDE UI 层

| #  | 严重度 | 差距                                                                            | 证据                                              |
| :- | :-- | :---------------------------------------------------------------------------- | :---------------------------------------------- |
| B1 | 🔴  | **无代码编辑器**。全项目无 Monaco/CodeMirror，无文件打开/查看/编辑 UI；`write_file` 只能模型盲写，用户无法审阅修改 | `src/components/desktop/` 仅 2 个组件               |
| B2 | 🔴  | **无 diff 审阅**。`git_diff` 原始文本倒入日志区；无行级 diff、无逐块 accept/reject                 | `WorkspacePanel.tsx` L86-L92                    |
| B3 | 🟠  | **文件浏览仅一层平铺**。只列根目录，无递归树、无工作区搜索、无 `@` 文件引用                                    | `WorkspacePanel.tsx` L29                        |
| B4 | 🟠  | **终端非 PTY**。为"日志窗 + 单命令输入"，交互式命令不可用，无会话保持与命令历史                                | `WorkspacePanel.tsx` L63-L76                    |
| B5 | 🟠  | **布局是聊天应用三栏，非 IDE 骨架**。缺活动栏、面板 dock 体系、状态栏、命令面板（Ctrl+K/Ctrl+P）                | `src/views/desktop/DesktopLayout.tsx` L196-L281 |
| B6 | 🟡  | **Live2D 看板娘零集成**。`index.html` 静态脚本注入、固定右侧定位，与 React 布局无通信，无法随任务状态联动          | `index.html` L15-L16                            |

### C. 架构债（IDE 化的承载瓶颈）

| #  | 严重度 | 差距                                                                                                         | 证据                                            |
| :- | :-- | :--------------------------------------------------------------------------------------------------------- | :-------------------------------------------- |
| C1 | 🟠  | **巨型文件**：`use-chat-controller.ts` 1252 行、`SettingsModal.tsx` 1008 行、`App.tsx` 651 行。向现有结构叠加编辑器/终端/面板会率先失控  | `src/app/use-chat-controller.ts` 等            |
| C2 | 🟡  | **设置体系新旧并存**：`LlmSettingsPanel.tsx`（637 行）同时被 MobileLayout、DesktopRightPane、SettingsModal 引用，模型管理存在两个入口未收口 | `src/components/LlmSettingsPanel.tsx` 及 4 处引用 |
| C3 | 🟡  | **云端 provider 分支重复**：自带 key 与 StepFun fallback 两分支的错误映射与流代理逻辑高度相似                                          | `functions/api/chat.ts` L172-L285             |
| C4 | 🟡  | **消息管道三层并存**：云端 SSE 事件、桌面网关 SSE 事件、markdown 假协议，`MessageBubble` 同时承担解析器职责                                  | `src/components/MessageBubble.tsx`            |

### D. 发布就绪度

| #  | 严重度 | 差距                                                               | 证据                                                 |
| :- | :-- | :--------------------------------------------------------------- | :------------------------------------------------- |
| D1 | 🔴  | **CI 不含桌面端**：无 `cargo test` / `tauri build`，无 release 流水线，不产出安装包 | `.github/workflows/ci.yml`                         |
| D2 | 🟠  | **无自动更新**：无 `tauri-plugin-updater`，发布后用户无法升级                     | `src-tauri/Cargo.toml`                             |
| D3 | 🟠  | **CSP 为 null**：桌面端无内容安全策略，IDE 化后加载本地/远程内容风险放大                    | `src-tauri/tauri.conf.json`（`security.csp = null`） |
| D4 | 🟡  | **E2E 不覆盖桌面端**：Playwright 仅测 Web，Rust 网关与工具沙箱无端到端验证              | `package.json` `test:e2e`                          |
| D5 | 🟡  | **无崩溃上报 / 诊断通道**                                                 | 全局缺失                                               |

## 4. 演进路线建议（分期）

```
阶段一 内核（地基）        阶段二 编辑器（看得见）     阶段三 IDE 化（骨架）        阶段四 发布（可分发）
─────────────────      ─────────────────        ─────────────────         ─────────────────
A1 多步 Agent 循环      B1 Monaco 编辑器          B5 IDE 布局/dock 体系        D1 桌面 CI + release
A2 原生 function call    B2 diff 审阅+逐块采纳      C1 巨型文件拆分             D2 自动更新
A3 结构化工具协议        B3 递归文件树+@引用        B6 Live2D React 集成        D3 CSP 收紧
A4 权限门+checkpoint     B4 PTY 终端               C2 设置体系收口             D4 桌面 E2E
  （顺带拆 C3/C4）                                  A5 任务规划面板             D5 崩溃上报
```

**依赖关系**：

- 阶段一是其余一切的前提——没有多步循环与结构化协议，编辑器与 diff 审阅没有数据来源；

- C1（拆巨型文件）应与阶段一、三同步进行，单独重构无意义；

- D1 可与任意阶段并行（独立、低风险、越早越收益）；

- 阶段二与阶段三可部分并行（编辑器组件可先在现布局中孵化）。

## 5. 关键设计决策（待定项）

进入实施前需要确定的技术选型：

1. **Agent 循环位置**：循环放 Rust 网关侧（贴近工具沙箱、断线可续）还是前端控制器侧（贴近 UI 状态机）？
2. **工具协议**：全量切换原生 function calling，还是保留文本协议作为不支持 tools 的 Provider 的降级路径？
3. **编辑器选型**：Monaco（重、VS Code 同源）vs CodeMirror 6（轻、可定制星空视觉）？
4. **权限门粒度**：每次工具调用确认 vs 写操作确认 vs 会话级白名单？
5. **Live2D 集成方式**：封装为 React 组件接入布局系统，还是保留独立挂件层 + 事件总线通信？

