# Agent Note: 阶段二编辑器三件套（B1 Monaco 编辑器 / B2 diff 审阅 / B3 文件树与 @ 引用）

Status: implemented

## Problem

差距分析（`docs/IDE_GAP_ANALYSIS.md`）指出：全项目无代码编辑器（B1）、无 diff 审阅与逐块采纳（B2）、文件浏览仅一层平铺且无 `@` 文件引用（B3）。`write_file` 只能模型盲写，用户无法查看与审阅 Agent 及自身的改动，"代码 IDE"目标形态缺最重要的可见层。阶段一已落地多步 Agent 循环、原生 function calling 与结构化 `toolSteps`，但审阅能力缺位使这些产出对用户不可见。

## Decision

以"编辑器三件套"在中栏孵化编辑器能力，为阶段三 IDE 骨架铺路：

- **布局**：`DesktopLayout` 中栏顶部新增视图切换条（`chat` ↔ `editor`，`Ctrl+1`/`Ctrl+2`，localStorage 持久化）。编辑器视图首次激活后常驻挂载、以 CSS 隐藏切换，保留 Monaco 实例与 model 缓存；对话区对称隐藏不卸载。

- **B1 编辑器**（`src/components/editor/EditorView.tsx` + `src/app/use-editor-workspace.ts`）：多文件 Tab（dirty 圆点、关闭按钮）、Monaco 单实例 + 每 tab 独立 `ITextModel`、底部状态栏（路径/语言/行列/保存态）、`Ctrl+S` 经 `write_file` 工具写回（Rust 侧自动 checkpoint 备份）。超 1MB 文件只读打开。

- **B2 diff 审阅**（`DiffReviewPanel.tsx` + `diff-merge.ts` 纯函数）：`git status --short` 解析（`parseGitStatusShort`）→ 变更文件列表（M/?/D 徽标）；`jsdiff structuredPatch` 计算 hunk（`toReviewHunks`，丢弃 `\ No newline` 元信息行）；逐 hunk 采纳/拒绝后 `applySelectedHunks` 按原文件行游标合并写回。双模式：hunk 卡片流（操作）+ Monaco DiffEditor 只读（对照）。

- **B3 文件树与 @ 引用**（`FileTree.tsx`）：递归懒加载 + 目录级缓存 + epoch 守卫，刷新经父组件 key 重挂载实现全树重置；hover 显示 `@` 引用按钮把 `@路径` 注入 Composer。`expandFileReferences`（`src/features/file-reference/`）在 `makeRequestMessages` 的 desktop 分支把 `@path` 展开为文件内容块（单文件 32KB 截断），存储与 UI 保留原文。

- **Rust 侧**仅新增两个 UI 专用命令（不进 agent 工具 schema）：`list_workspace_entries`（结构化 `{name, isDir}` 条目，目录优先排序）、`read_head_file`（`git show HEAD:<path>`，无 HEAD/未跟踪统一降级 `present=false`）。

- **Monaco worker**：Vite 8（rolldown）不支持 `?worker` 导入查询，采用官方 `new Worker(new URL("../../../node_modules/monaco-editor/...", import.meta.url), { type: "module" })` 内联字面量形式打包；PWA 侧 `workbox.globIgnores` 将 worker 与 `editor.api` 大 chunk 移出 SW 预缓存。

## Alternatives considered

- **CodeMirror 6 替代 Monaco**：更轻、星空视觉定制更自由，但 DiffEditor 与 diff 合并视图需自建，工程量更大；Monaco 与 VS Code 同源更贴合 IDE 定位，Tauri 本地加载无体积压力。

- **编辑器嵌右面板**：改动面更小，但 280-520px 宽度下大 diff 审阅体验差，且与阶段三 IDE 骨架（编辑器属中央区域）相悖。

- **B4 PTY 终端同批实施**：portable-pty + xterm.js 涉及 Rust 网关事件流改造，改动面与其余三项异构，拆批降低风险。

- **diff 合并用 git apply**：依赖 git 交互式补丁语义，逐块选择需额外维护 index 状态；`applySelectedHunks` 纯函数更可控且可测。

- **`?worker`** **导入**（Vite 传统方案）：rolldown-vite 8 无法解析（实验验证），故用 `new URL` 形式。

## Consequences

- 用户可看、改、审：文件树打开 → 编辑器修改 → `Ctrl+S` 保存（checkpoint 兜底）→ 变更审阅逐块采纳/拒绝，IDE 核心闭环成立。

- `??` 新文件仅查看（无删除工具不回滚）、`D` 删除文件置灰——工具沙箱能力边界如实呈现。

- `use-chat-controller` 的侵入收敛在 `makeRequestMessages` 单点（@ 展开纯函数注入），未扩大 1252 行巨型文件的失控面。

- Monaco 主包与 worker 累计约 11MB 构建产物：桌面端无影响；Web PWA 中编辑器按需在线加载（未预缓存），离线 Web 不可用编辑器属可接受取舍。

- `applySelectedHunks` 的游标算法依赖"jsdiff hunks 不重叠"前提，若上游变更需复核。

- 后续（阶段三）文件树 dirty 徽标、review tab 变更计数徽标、@ 自动补全弹层为增强项。

## Verification

- Rust：`cargo test --manifest-path src-tauri/Cargo.toml` —— 40 通过（含新增 `test_list_workspace_entries_structured`、`test_read_head_file_lifecycle`：无仓库/空仓库/已提交/未跟踪/反斜杠归一化五态）。

- 前端单测：`npm run test:unit` —— 28 文件 258 测试通过（含新增 `diff-merge.test.ts` 11 项、`expand-file-references.test.ts` 9 项）。

- 云函数：`npm run test:functions` —— 261 通过。

- 类型与规范：`npm run typecheck`（三份 tsconfig）+ `npm run lint`（0 error）。

- 生产构建：`npm run build` —— 五个 Monaco worker（editor/json/html/css/ts）均产出、PWA precache 107 条目无报错。

- 桌面端建议人工冒烟：`npm run desktop:dev` 后以仓库自身为工作区验证 打开/编辑/保存/审阅/引用 全链路。

