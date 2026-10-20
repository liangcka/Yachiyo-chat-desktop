# Agent Note: 回复正文排版与输入区浮层统一

Status: implemented

## Problem

模型回复里的 `#` 标题、`---` 分隔线和表格以原文显示，满屏 `##` 与竖线。代码块前后的空行各自生成间隙，与容器间距叠加，代码块上下留白过大。代码块（深色海军蓝底、蓝边）、引用块（蓝条、蓝底、斜体）、列表圆点与序号沿用品牌蓝，和"强调色只用于焦点、选中态与发送按钮"的中性灰阶基调冲突。输入区周围的加号菜单、技能面板、模型菜单、项目菜单与 `@`、`/` 选择器各用一套底色、边框、圆角与阴影。

## Decision

- `MarkdownContent` 支持 `#`～`######` 标题、`---`/`***`/`___` 分隔线与 GFM 表格。表格以"含竖线的表头行 + 含竖线的分隔行"成立，分隔行的冒号决定列对齐（`data-align`），行内格式在单元格内照常解析，宽表在容器内横向滚动。连续 `>` 行合并为一个引用块。
- 文本段首尾的空行不渲染，段内连续空行只保留一个间隙，标题后的空行不再占位。
- 正文样式全部取中性 tokens：代码块用 `--yx-alias-markdown-code-block` 底、`--border-l1` 边，语言标签与复制按钮与代码同底；引用块为灰条、次级文字、非斜体；列表圆点与序号用 `--text-dim`/`--text-muted`；加粗用 `--text-primary`。
- 输入区浮层统一为 `--dsw-specific-menu` 底、`--dsw-alias-border-l2` 边、14px 圆角、`--dsw-shadow-lv3` 阴影，条目 8px 圆角。没有最近项目时，项目菜单顶部的孤立分隔线隐藏。
- 用户消息旁的复制/编辑按钮与助手消息一致，平时无底色，悬停才显示。命令面板正文 14px、结果行 13px。

## Alternatives considered

- 引入 `react-markdown` + `remark-gfm`：覆盖面更全，但会新增依赖并替换现有的八千代动作标签解析，超出排版修整的范围。
- 只用 CSS 隐藏多余的 `.markdown-spacer`：无法区分段首尾空行与段内空行，仍需在解析阶段处理。

## Consequences

不支持的 Markdown 语法（链接、图片、嵌套列表、任务列表）仍按原文显示。表格要求分隔行含竖线，单列且无竖线的分隔写法会被当作普通段落与分隔线。

## Verification

- `npm run typecheck`：通过。
- `npm run lint`：通过，仅保留 `ConversationView.tsx` 既有的 `react-hooks/incompatible-library` 警告。
- `npm run test:unit`：67 个文件、528 项测试通过，新增 `MarkdownContent.test.tsx` 覆盖标题、分隔线、表格对齐、引用合并与空行收敛。
- `npx playwright test --project=desktop-1440`：19 项通过。
- `npm run dev:mock`：1440×860 下浅色与深色主题的对话正文、加号菜单、项目菜单、模型菜单、`/` 选择器与命令面板均已截图核对。
