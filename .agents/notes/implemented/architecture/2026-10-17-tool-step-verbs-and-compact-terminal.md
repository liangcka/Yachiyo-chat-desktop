# Agent Note: 工具步骤动词化描述与紧凑终端布局

Status: implemented

## Problem

在桌面端对话界面中，工具执行步骤原先直接展示原始工具名（如 `run_command`、`read_file`）与未解析的 JSON 参数预览，视觉呈现带有过多调试性质的徽章（彩色状态胶囊、错误角标等）。此外，工具步骤卡片内部包含大段展开的原始参数，挤占了正文空间，且展开/折叠状态未与流式执行生命周期协同联动。

## Decision

- **动词化呈现契约**：工具步骤统一收敛为单行动词化描述：
  - `read_file` → "读取 <路径>"（日文："<路径> を読み込み"）
  - `list_directory` → "查看 <路径>"（日文："<路径> を表示"）
  - `write_file` → "编辑 <路径>"（日文："<路径> を編集"）
  - `run_command` → "运行 `<命令>`"（日文："`<命令>` を実行"）
  - `web_fetch` → "抓取 <域名>"（日文："<域名> を取得"）
  - `git_status` / `git_diff` → "查看 Git 状态/差异"（日文："Git ステータス/差分を確認"）
  - `todo_write` → "更新任务清单"（日文："タスク一覧を更新"）
  - `mcp__<服务>__<操作>` → "<服务> · <操作>"
  - 纯函数 `formatToolDescription` 提供中日双语支持与边界防御降级。
- **状态表达去徽章化**：
  - 执行中展示紧凑转圈动画（`12px` 微型 Spinner），兼容 `prefers-reduced-motion: reduce`；
  - 失败步骤仅通过描述文字颜色（`var(--danger)`）与图标色进行区分，废弃彩色背景徽章。
- **终端化输出与参数收拢**：
  - 展开卡片后以等宽字体（`var(--ds-font-family-code)`）平铺展示命令输出，内嵌中性复制按钮；
  - 参数 JSON 收拢在"详情"（日文"詳細"）折叠项中，避免长参数干扰命令输出视线；
  - 移除原有内联样式，所有层级均走 `tokens.css` 语义变量（`--yx-alias-markdown-code-block` 等）。
- **生命周期受控折叠**：
  - 连续工具组摘要文案统一为“已运行 N 步”（日文：“N ステップを実行”）；
  - 工具组在流式执行过程中自动展开，执行终态或完成时自动收拢，同时支持用户手动切换。

## Alternatives considered

- 仅隐藏参数 JSON、保留原始英文工具名：仍具有强烈机器指令感，无法融入 Codex/Antigravity 等桌面助手的极简产品语言。
- 每次收到输出时强制重置展开状态：若用户正在查看输出，会被强制折叠打断，因此仅监听 `running` 的起止边缘（running 从 false 到 true，或 true 到 false 时更新）。

## Consequences

- 消息区信息密度提升，工具步骤呈现为流畅的操作动宾列表；
- 明暗主题与减弱动效体验一致；
- 原始工具名及参数依然可在展开后的“详情”中完整查看。

## Verification

- `src/components/tools/tool-description.test.ts`：17 项测试通过，覆盖全量动词映射、中日双语、URL 域名提取与异常降级；
- `src/components/tools/ToolCard.test.tsx`：6 项测试通过，验证动词渲染、运行中转圈、失败文字高亮、输出与参数详情折叠，以及 MCP 无内联样式；
- `npm run typecheck`：通过；
- `npm run lint`：通过；
- `npm run test:unit`：55 个测试文件、437 项测试通过。
